import type { NostrSigner } from '@nostrify/types';
import { NSecSigner, NBrowserSigner, NConnectSigner } from '@nostrify/nostrify';
import type { NConnectSignerOpts } from '@nostrify/nostrify';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { pubSchnorr, taprootTweakPrivKey } from '@scure/btc-signer/utils.js';

import {
  signPsbtLocal,
  signPsbtLocalHd,
  validateAndDecodeSilentPaymentAddress,
  type PsbtRecipient,
  type PsbtSigningOptions,
} from '@/lib/bitcoin';

export type { PsbtSigningOptions };
import {
  encodePsbtV2,
  extractTxFromSignedPsbtV2,
  parsePsbtV2,
  type PsbtV2Output,
  type PsbtV2Input,
} from '@/lib/psbtV2';
import {
  aggregateSenderPrivateKey,
  computeBip375EcdhShare,
  deriveSilentPaymentOutputs,
  p2trScriptPubKey,
  type SilentPaymentAddress,
  type SilentPaymentInput,
  type SilentPaymentRecipient,
} from '@/lib/silentPayments';
import { generateDLEQProof } from '@/lib/dleq';
import { bitcoinWalletNodeFromNsec } from '@/lib/hdWallet';

/**
 * Cheap sniff: does the hex string contain at least one `PSBT_IN_TAP_BIP32_DERIVATION`
 * row? Used to route legacy single-key PSBTs to `signPsbtLocal` and HD PSBTs to
 * `signPsbtLocalHd`. A full parse follows only when the cheap check matches.
 */
function hasTapBip32Derivation(psbtHex: string): boolean {
  // Look for the input-level tapBip32Derivation key prefix.
  // @scure/btc-signer uses keytype 0x16 for tapBip32Derivation, with a
  // 32-byte x-only pubkey as the keydata => key length 0x21.
  return /2116/i.test(psbtHex);
}

// ---------------------------------------------------------------------------
// BtcSigner interface
// ---------------------------------------------------------------------------

/**
 * A Nostr signer extended with Bitcoin PSBT signing capability.
 *
 * Implementations receive a hex-encoded unsigned PSBT, sign all Taproot
 * inputs whose `tapInternalKey` matches the signer's key, and return the
 * hex-encoded signed (but not finalized) PSBT.
 */
export interface BtcSigner extends NostrSigner {
  signPsbt(psbtHex: string, options?: PsbtSigningOptions): Promise<string>;
}

/** Runtime check for whether a signer supports `signPsbt`. */
export function hasBtcSigning(signer: NostrSigner): signer is BtcSigner {
  return typeof (signer as BtcSigner).signPsbt === 'function';
}

// ---------------------------------------------------------------------------
// NSecSignerBtc — local nsec signing
// ---------------------------------------------------------------------------

/**
 * Extends `NSecSigner` with local Taproot PSBT signing.
 *
 * `NSecSigner` stores the secret key in a JS `#private` field that subclasses
 * cannot access. To work around this, the constructor accepts the raw secret
 * key bytes, passes them to `super()`, and keeps its own copy in a true
 * runtime-private `#secretKeyBytes` field so the key is not reachable via
 * property enumeration or reflection on the instance.
 *
 * **BIP-375 / silent payments.** The popup signs BIP-375 PSBT v2s by
 * detecting `PSBT_OUT_SP_V0_INFO` outputs, deriving the per-recipient
 * BIP-341 taproot output locally (we own the private key, so we can do the
 * full BIP-352 sender derivation without needing an external signer), then
 * proxying to the existing PSBT v0 signing path. We assume the input set
 * is entirely the sender's own P2TR outputs (which is the only shape this
 * wallet produces) — that lets us skip the BIP-375 input-eligibility
 * matrix and treat every UTXO as a BIP-352 eligible input.
 */
export class NSecSignerBtc extends NSecSigner implements BtcSigner {
  readonly #secretKeyBytes: Uint8Array;

  constructor(secretKey: Uint8Array) {
    super(secretKey);
    this.#secretKeyBytes = new Uint8Array(secretKey);
  }

  async signPsbt(psbtHex: string, options?: PsbtSigningOptions): Promise<string> {
    // BIP-375 silent payment path first — it resolves SP outputs to concrete
    // P2TR scripts before signing.
    if (hasBip375SpOutputs(psbtHex)) {
      const paymentIntent = options?.paymentIntents?.[0];
      return signBip375PsbtV2Locally(
        psbtHex,
        hex.encode(this.#secretKeyBytes),
        this.#secretKeyBytes,
        paymentIntent,
      );
    }

    // HD wallet path: inputs carry tapBip32Derivation metadata. Derive the
    // account node from the nsec and sign each input with its per-address key.
    if (hasTapBip32Derivation(psbtHex)) {
      const accountNode = bitcoinWalletNodeFromNsec(this.#secretKeyBytes);
      return signPsbtLocalHd(psbtHex, accountNode, this.#secretKeyBytes, options);
    }

    // Legacy single-key path: every input shares the Nostr-derived Taproot key.
    return signPsbtLocal(psbtHex, hex.encode(this.#secretKeyBytes), options);
  }
}

/**
 * Cheap sniff: does the hex string contain at least one `PSBT_OUT_SP_V0_INFO`
 * row? Used to decide whether to take the BIP-375 fast path. A full parse
 * follows only when the cheap version check matches, keeping us off the parser
 * hot path for the common PSBT v0 case.
 */
function hasBip375SpOutputs(psbtHex: string): boolean {
  // PSBT v2 only — peek at the version global. We look for the byte pattern
  // `0x01 0xfb 0x04 0x02 0x00 0x00 0x00` (key-len=1, keytype=0xfb VERSION,
  // val-len=4, value=2). If this isn't a v2 PSBT we can skip BIP-375 entirely.
  if (!/01fb0402000000/i.test(psbtHex)) return false;

  // Hardened check: parse the v2 PSBT and look for an output-level unknown
  // field with keytype 0x09 (PSBT_OUT_SP_V0_INFO) and the exact 67-byte value
  // shape (1 version + 33 scan pubkey + 33 spend pubkey). This avoids false
  // positives where the byte sequence `0109` happened to appear inside unrelated
  // PSBT data.
  try {
    const psbt = parsePsbtV2(psbtHex);
    return psbt.outputs.some((out) =>
      out.unknown.some(
        (u) => u.keyType === 0x09 && u.keyData.length === 0 && u.value.length === 67,
      ),
    );
  } catch {
    return false;
  }
}

/**
 * Resolve BIP-375 silent payment outputs in a PSBT v2 to concrete P2TR
 * outputs, build a finalized PSBT v2 (script written in, signatures
 * present), and return its hex. Assumes every input is the sender's own
 * P2TR — which is the only shape 2140.wtf's wallet produces.
 */
function signBip375PsbtV2Locally(
  psbtHex: string,
  privateKeyHex: string,
  secretKeyBytes: Uint8Array,
  paymentIntent?: PsbtRecipient,
): string {
  const psbt = parsePsbtV2(psbtHex);
  if (psbt.inputs.length === 0) throw new Error('NSecSignerBtc: PSBT has no inputs.');
  if (psbt.outputs.length === 0) throw new Error('NSecSignerBtc: PSBT has no outputs.');

  // Re-derive the sender's taproot internal pubkey from the private key —
  // every input's `tapInternalKey` is expected to match.
  const internalPubkey = pubSchnorr(secretKeyBytes);
  const senderPayment = btc.p2tr(internalPubkey, undefined, btc.NETWORK);
  const senderScript = senderPayment.script;

  // Derive the BIP-341 *tweaked* private key — the same scalar the wallet
  // uses to sign each P2TR input — and feed it into the BIP-352 sender
  // derivation as the input's contribution.
  const tweakedPrivKey = taprootTweakPrivKey(secretKeyBytes);

  // Pre-signing safety inspection: every input must be a witness UTXO from
  // the sender's own P2TR address, must not request a non-standard sighash,
  // and outputs must not exceed inputs.
  let inputSum = 0n;
  for (let i = 0; i < psbt.inputs.length; i++) {
    const inp = psbt.inputs[i];
    if (!inp.witnessUtxo) {
      throw new Error(`NSecSignerBtc: input ${i} is missing witnessUtxo.`);
    }
    if (inp.witnessUtxo.amount <= 0n) {
      throw new Error(`NSecSignerBtc: input ${i} has a zero or negative value.`);
    }
    if (!bytesEqual(inp.witnessUtxo.script, senderScript)) {
      throw new Error('NSecSignerBtc: input is not from the sender (script mismatch).');
    }
    if (
      inp.sighashType !== undefined &&
      inp.sighashType !== btc.SigHash.DEFAULT &&
      inp.sighashType !== btc.SigHash.ALL
    ) {
      throw new Error(`NSecSignerBtc: input ${i} requests a non-standard sighash type (${inp.sighashType}).`);
    }
    inputSum += inp.witnessUtxo.amount;
  }

  let outputSum = 0n;
  for (let i = 0; i < psbt.outputs.length; i++) {
    outputSum += psbt.outputs[i].amount;
  }
  if (outputSum > inputSum) {
    throw new Error('NSecSignerBtc: PSBT outputs exceed inputs.');
  }

  // SP outputs are identified by an `unknown` row with keytype 0x09 (the
  // BIP-375 PSBT_OUT_SP_V0_INFO field number).
  const O_SP_V0_INFO = 0x09;

  // Resolve every SP output once, since the wallet uses every UTXO and the
  // derivation depends on the full input set's outpoints (BIP-352 picks the
  // lex-smallest outpoint for `input_hash`).
  const allOutpoints = psbt.inputs.map((i) => ({ txid: i.txid, vout: i.vout }));

  // Every input is owned by the same sender key, so each contributes the
  // same tweaked private key to the BIP-352 aggregate `a`.
  const eligibleInputs: SilentPaymentInput[] = psbt.inputs.map((inp) => ({
    txid: inp.txid,
    vout: inp.vout,
    privateKey: tweakedPrivKey,
    isTaproot: true,
  }));

  // Collect all SP recipients up-front so `deriveSilentPaymentOutputs` can
  // group them by scan key and assign `k = 0, 1, …` per group. The PSBT-
  // output order is preserved alongside so we can re-pair derived xonly
  // keys with the right `PsbtV2Output` after derivation.
  const spRecipientIndex: number[] = [];
  const spRecipients: SilentPaymentRecipient[] = [];
  const resolvedOutputs: PsbtV2Output[] = psbt.outputs.map((out, idx) => {
    if (out.script) {
      // In 2140.wtf's BIP-375 PSBTs, the only script output is the sender's
      // change. Reject any other script output so a malicious PSBT can't
      // trick the user into paying a non-SP recipient they didn't review.
      if (!bytesEqual(out.script, senderScript)) {
        throw new Error('NSecSignerBtc: non-silent-payment output is not a change output to the sender.');
      }
      return { type: 'script', amount: out.amount, script: out.script };
    }
    const spInfo = out.unknown.find((u) => u.keyType === O_SP_V0_INFO && u.keyData.length === 0);
    if (!spInfo) {
      throw new Error('NSecSignerBtc: output is missing both PSBT_OUT_SCRIPT and PSBT_OUT_SP_V0_INFO.');
    }
    // value = 1-byte version || 33-byte scan key || 33-byte spend key
    if (spInfo.value.length !== 67) {
      throw new Error('NSecSignerBtc: invalid PSBT_OUT_SP_V0_INFO length.');
    }
    const version = spInfo.value[0];
    if (version !== 0) {
      throw new Error(`NSecSignerBtc: silent payment version ${version} is not supported by the local signer.`);
    }
    const spAddress: SilentPaymentAddress = {
      hrp: 'sp',
      network: 'mainnet',
      version: 0,
      scanPubKey: spInfo.value.slice(1, 34),
      spendPubKey: spInfo.value.slice(34, 67),
    };
    spRecipientIndex.push(idx);
    spRecipients.push({ address: spAddress });
    // Placeholder; filled in after the batch derivation below.
    return { type: 'script', amount: out.amount, script: new Uint8Array(0) };
  });

  if (spRecipients.length > 0) {
    const derived = deriveSilentPaymentOutputs(eligibleInputs, spRecipients, {
      allOutpoints,
      network: 'mainnet',
    });
    // `deriveSilentPaymentOutputs` returns outputs grouped by scan key, in
    // recipient-input order within each group. Walk the result and match
    // each derived xonly back to its original PSBT output by reference-
    // equality on the recipient object — that's how we threaded the
    // PSBT-output index through.
    for (const out of derived) {
      const i = spRecipients.indexOf(out.recipient);
      if (i < 0) throw new Error('NSecSignerBtc: derived SP output has no matching recipient.');
      const psbtIdx = spRecipientIndex[i];
      const script = p2trScriptPubKey(out.xOnlyPubKey);
      resolvedOutputs[psbtIdx] = {
        type: 'script',
        amount: psbt.outputs[psbtIdx].amount,
        script,
      };
    }
  }

  // Compute the BIP-375 global ECDH share + DLEQ proof per recipient scan
  // key. Per BIP-375 §"Computing the ECDH Shares and DLEQ Proofs", a single
  // signer that owns every eligible input should emit one global share per
  // scan key — which is exactly our case (all inputs are P2TR owned by the
  // sender). We attach these to the finalized PSBT v2 so an external
  // BIP-375 verifier can re-derive the output scripts without trusting us.
  const spGlobals: { scanPubKey: Uint8Array; ecdhShare: Uint8Array; dleqProof: Uint8Array }[] = [];
  if (spRecipients.length > 0) {
    const agg = aggregateSenderPrivateKey(eligibleInputs, allOutpoints);
    // Group recipient scan keys, deduplicating so we emit one share per
    // unique scan key (multiple SP outputs to the same recipient share).
    const seen = new Map<string, Uint8Array>();
    for (const r of spRecipients) {
      const hex = bytesToHexLocal(r.address.scanPubKey);
      if (!seen.has(hex)) seen.set(hex, r.address.scanPubKey);
    }
    for (const scanPubKey of seen.values()) {
      const ecdhShare = computeBip375EcdhShare(agg.aggregateScalar, scanPubKey);
      const auxRand = new Uint8Array(32);
      crypto.getRandomValues(auxRand);
      const { proof } = generateDLEQProof({ a: agg.aggregateScalar, B: scanPubKey, auxRand });
      spGlobals.push({ scanPubKey, ecdhShare, dleqProof: proof });
    }
  }

  // Re-encode as a regular (script-only) PSBT v2 so we can hand it off to
  // the @scure/btc-signer PSBT v0 signing path. We emit v2 → convert to v0
  // by leveraging the library's PSBT version handling: the easiest route
  // is to use `Transaction` directly because we control every input/output.
  const tx = new btc.Transaction();
  for (const inp of psbt.inputs) {
    if (!inp.witnessUtxo) {
      throw new Error('NSecSignerBtc: input is missing witnessUtxo.');
    }
    // Verify the witness UTXO's script matches the sender's address — we
    // shouldn't be asked to sign anyone else's UTXOs.
    if (!bytesEqual(inp.witnessUtxo.script, senderScript)) {
      throw new Error('NSecSignerBtc: input is not from the sender (script mismatch).');
    }
    tx.addInput({
      txid: inp.txid,
      index: inp.vout,
      sequence: inp.sequence,
      witnessUtxo: {
        script: inp.witnessUtxo.script,
        amount: inp.witnessUtxo.amount,
      },
      tapInternalKey: internalPubkey,
    });
  }
  for (const out of resolvedOutputs) {
    if (out.type !== 'script') throw new Error('unreachable: SP output left unresolved');
    tx.addOutput({ amount: out.amount, script: out.script });
  }

  const signed = tx.sign(secretKeyBytes, [btc.SigHash.DEFAULT, btc.SigHash.ALL]);
  if (signed === 0) {
    throw new Error('NSecSignerBtc: no inputs were signed.');
  }
  tx.finalize();

  if (paymentIntent) {
    verifyBip375OutputMatchesIntent(tx, paymentIntent, eligibleInputs, allOutpoints, senderScript);
  }

  // Round-trip back to a finalized PSBT v2 with the resolved scripts plus
  // the input-level final witnesses and any BIP-375 global ECDH shares +
  // DLEQ proofs. The caller's `extractTxFromSignedPsbtV2` will pull out the
  // raw transaction hex from this.
  return finalizedTxToPsbtV2(tx, psbt.inputs, resolvedOutputs, spGlobals);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Verify a finalized BIP-375 transaction against the user-approved silent
 * payment intent. Derives the expected P2TR output from the approved SP address
 * and the input set, then confirms the transaction contains that exact output
 * (amount + scriptPubKey) and that every other output is change to the sender.
 */
function verifyBip375OutputMatchesIntent(
  tx: btc.Transaction,
  paymentIntent: PsbtRecipient,
  eligibleInputs: SilentPaymentInput[],
  allOutpoints: { txid: string; vout: number }[],
  senderScript: Uint8Array,
): void {
  const spAddress = validateAndDecodeSilentPaymentAddress(paymentIntent.address);
  if (!spAddress) {
    throw new Error('NSecSignerBtc: payment intent is not a valid silent payment address.');
  }
  const expectedAmount = BigInt(paymentIntent.amountSats);

  const derived = deriveSilentPaymentOutputs(eligibleInputs, [{ address: spAddress }], {
    allOutpoints,
    network: 'mainnet',
  });
  if (derived.length !== 1) {
    throw new Error('NSecSignerBtc: expected exactly one derived silent payment output.');
  }
  const expectedScript = p2trScriptPubKey(derived[0].xOnlyPubKey);

  let foundSp = false;
  for (let i = 0; i < tx.outputsLength; i++) {
    const out = tx.getOutput(i);
    if (!out.script || out.script.length === 0) {
      throw new Error('NSecSignerBtc: BIP-375 transaction output has no script.');
    }
    if (out.amount === expectedAmount && bytesEqual(out.script, expectedScript)) {
      foundSp = true;
      continue;
    }
    if (!bytesEqual(out.script, senderScript)) {
      throw new Error('NSecSignerBtc: unexpected output in BIP-375 transaction.');
    }
  }

  if (!foundSp) {
    throw new Error('NSecSignerBtc: approved silent payment output is missing.');
  }
}

function bytesToHexLocal(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

/**
 * Serialize a fully-signed `@scure/btc-signer` `Transaction` back into the
 * PSBT v2 wire format with `finalScriptWitness` set on each input and
 * resolved scripts on each output. The library's own `tx.toPSBT(2)` would
 * be simpler but strips unknown fields and brings in v0/v2 hybrid
 * plumbing we don't need — re-emitting through our typed encoder, which
 * knows about `finalScriptWitness` natively, is straightforward.
 */
function finalizedTxToPsbtV2(
  tx: btc.Transaction,
  inputs: { txid: string; vout: number; sequence: number; witnessUtxo?: { amount: bigint; script: Uint8Array } }[],
  outputs: PsbtV2Output[],
  silentPaymentGlobals?: { scanPubKey: Uint8Array; ecdhShare: Uint8Array; dleqProof: Uint8Array }[],
): string {
  const psbtInputs: PsbtV2Input[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const txInp = tx.getInput(i);
    const finalWitness = (txInp.finalScriptWitness ?? []) as Uint8Array[];
    const orig = inputs[i];
    if (!orig.witnessUtxo) {
      throw new Error('finalizedTxToPsbtV2: missing witness UTXO on input.');
    }
    psbtInputs.push({
      txid: orig.txid,
      vout: orig.vout,
      sequence: orig.sequence,
      witnessUtxo: orig.witnessUtxo,
      finalScriptWitness: finalWitness.length > 0 ? finalWitness : undefined,
    });
  }

  return encodePsbtV2({
    inputs: psbtInputs,
    outputs,
    silentPaymentGlobals: silentPaymentGlobals && silentPaymentGlobals.length > 0
      ? silentPaymentGlobals
      : undefined,
    // Once we've resolved every SP output script and signed, BIP-375
    // requires `PSBT_GLOBAL_TX_MODIFIABLE` to be 0.
    txModifiable: silentPaymentGlobals && silentPaymentGlobals.length > 0 ? 0 : undefined,
  });
}

// Re-export so callers can do `extractTxFromSignedPsbtV2` next to the signer
// without a separate import path.
export { extractTxFromSignedPsbtV2 };

// ---------------------------------------------------------------------------
// NBrowserSignerBtc — NIP-07 extension signing
// ---------------------------------------------------------------------------

/**
 * Extends `NBrowserSigner` with NIP-07 `window.nostr.signPsbt()` support.
 *
 * Calls the extension's `signPsbt` method if available. If the extension does
 * not expose `signPsbt`, an error is thrown with a user-friendly message.
 */
export class NBrowserSignerBtc extends NBrowserSigner implements BtcSigner {
  constructor(opts?: { timeout?: number }) {
    super(opts);
  }

  async signPsbt(psbtHex: string, _options?: PsbtSigningOptions): Promise<string> {
    // `awaitNostr` is TypeScript-private but JavaScript-public at runtime.
    const nostr = await (this as unknown as { awaitNostr(): Promise<Record<string, unknown>> }).awaitNostr();

    if (typeof nostr.signPsbt !== 'function') {
      throw new Error(
        "Your browser extension doesn't support sending Bitcoin. Try a different extension, or log in with your secret key.",
      );
    }

    const signPsbt = nostr.signPsbt as (hex: string) => Promise<string>;
    return signPsbt(psbtHex);
  }
}

// ---------------------------------------------------------------------------
// NConnectSignerBtc — NIP-46 remote signer
// ---------------------------------------------------------------------------

/**
 * Heuristics for detecting whether a NIP-46 `sign_psbt` error reflects a
 * missing-capability rejection (e.g. "method not supported", "unknown
 * command") versus a transient operational failure (network, user rejection,
 * malformed input). We have to match on strings because NIP-46 errors are
 * plain strings without structured codes.
 */
const CAPABILITY_ERROR_PATTERNS = [
  /unknown\s+(method|command)/i,
  /not\s+(implemented|supported|found)/i,
  /unsupported\s+method/i,
  /method\s+not\s+found/i,
  /invalid\s+method/i,
  /no\s+such\s+method/i,
];

function looksLikeCapabilityError(msg: string): boolean {
  return CAPABILITY_ERROR_PATTERNS.some((re) => re.test(msg));
}

/**
 * Extends `NConnectSigner` with NIP-46 `sign_psbt` RPC support.
 *
 * Sends a `sign_psbt` command over the NIP-46 relay channel. The remote
 * signer handles the TapTweak and Schnorr signing internally.
 *
 * NIP-46 returns unstructured string errors, so we use pattern matching to
 * distinguish capability failures (the signer doesn't know the method) from
 * operational failures (network, user rejection, bad input). Only capability
 * failures are re-wrapped with the "doesn't support sending Bitcoin" message
 * that flips the UI into the unsupported state; everything else propagates
 * unchanged so the caller can surface the real error.
 */
export class NConnectSignerBtc extends NConnectSigner implements BtcSigner {
  constructor(opts: NConnectSignerOpts) {
    super(opts);
  }

  async signPsbt(psbtHex: string, _options?: PsbtSigningOptions): Promise<string> {
    // `cmd` is TypeScript-private but JavaScript-public at runtime.
    const cmd = (this as unknown as { cmd(method: string, params: string[]): Promise<string> }).cmd;
    try {
      return await cmd.call(this, 'sign_psbt', [psbtHex]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (looksLikeCapabilityError(msg)) {
        // Keep the original signer message out of the user-facing error in
        // case it contains the PSBT hex or other wallet data. Log it for
        // debugging instead.
        console.warn('NIP-46 signer capability error:', msg);
        throw new Error(
          "Your remote signer doesn't support sending Bitcoin. Update your signer, or log in with your secret key.",
        );
      }
      // Not a capability failure — propagate the original error so the user
      // sees the actual reason (timeout, rejection, malformed PSBT, etc.).
      throw error;
    }
  }
}
