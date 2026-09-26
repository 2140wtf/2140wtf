// src/lib/cashu/escrowSwapComplete.ts
//
// Client half of the two-phase Cashu escrow settlement (court verdicts).
//
// The Fund API initiates a NUT-11 SIG_ALL swap over the escrowed proofs: the
// oracle signature is already attached and the swap pays the project (release)
// or the donor (refund). The party completes it by adding its OWN witness
// signature over the exact same SIG_ALL digest and posting the swap back to
// `/release/complete` or `/refund/complete`. The API re-validates both
// signatures, executes the swap at the mint and only then records the
// settlement.
//
// Signing is the money-authorizing step, so every field the digest binds is
// re-validated here BEFORE the key is used:
//   - the swap's mint must be the expected mint, one keyset throughout;
//   - every input must be a SIG_ALL 2-of-N escrow lock containing BOTH the
//     oracle and the signing party;
//   - the oracle's signature must verify over the digest on every input;
//   - the outputs must pay exactly the expected payout/fee keys and amounts -
//     no output may be locked to anyone else, and no amount may drift.
// A hostile or broken API response therefore fails closed instead of getting
// a signature that authorizes a wrong payout.
//
// The SIG_ALL digest is the exact algorithm the API's cashu-ts uses
// (`buildP2PKSigAllMessage`): inputs' secret+C concatenated with the outputs'
// amount+B_ (no separators), sha256'd, then BIP-340 signed.
//
// Why this is still implemented here after the cashu-ts 3.7.2 bump: 3.x ships
// `buildP2PKSigAllMessage` only as a RUNTIME export - api-extractor marks it
// "Excluded from this release type", so it is absent from the public .d.ts
// (importing it fails `tsc`). Adopting it would mean an untyped cast in the
// money-authorizing path; the local mirror is six lines, is verified
// byte-for-byte against the installed runtime implementation by
// escrowSwapComplete.test.ts ("parity with the runtime builder"), and keeps
// the signing inputs fully typed. The same reasoning keeps
// `signSigAllDigest`/`verifySigAllSignature` on the shared noble primitives:
// `signP2PKProofs(..., message)` requires Proof objects and witness
// extraction, which is strictly more machinery than signing the digest once.

import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { normalizeMultisigPubkey, parseMultisigLockSecret } from './escrowMultisig';
import { fundFetch } from '../fundHttp';
import type { SignerLike } from '../baoFundraising';

/** One blinded output on the wire (the API's SerializedSwapOutputData). */
export interface EscrowSwapOutputWire {
  blindedMessage: { amount: number; B_: string; id: string };
  /** 64-char hex blinding factor. */
  blindingFactor: string;
  /** Hex of the UTF-8 NUT-10 secret bytes. */
  secret: string;
}

/** One input proof on the wire (cashu Proof with an optional witness). */
export interface EscrowSwapInputWire {
  id: string;
  amount: number;
  secret: string;
  C: string;
  witness?: unknown;
}

/** The API's SerializedEscrowSwap. */
export interface EscrowSwapWire {
  mint: string;
  inputs: EscrowSwapInputWire[];
  outputs: EscrowSwapOutputWire[];
}

/** What the caller knows about the swap before signing it. */
export interface EscrowSwapExpectation {
  /** The escrow's recorded mint; when omitted, the swap's mint must merely be a valid https mint URL. */
  mint?: string | null;
  /** Expected keyset id when known; outputs and inputs must all share one. */
  keysetId?: string | null;
  /** Who the swap must pay: the project (release) or the donor (refund). */
  payoutPubkey: string;
  /** Exact sats the swap must lock to `payoutPubkey`. */
  payoutSats: number;
  /** Verifier fee output key (release swaps); null/omitted for refunds. */
  feePubkey?: string | null;
  /** Exact sats the swap must lock to `feePubkey`. */
  feeSats?: number;
  /** Mint input fee when the initiate response declares it. */
  mintFeeSats?: number | null;
  /** The signing party; must be a lock key of every input. */
  partyPubkey: string;
  /**
   * The oracle key expected to have signed every input. When omitted (the
   * refund initiate response does not carry it), the oracle is INFERRED as
   * the one non-party lock key whose signature verifies over the digest on
   * every input - exactly one candidate is accepted.
   */
  oraclePubkey?: string | null;
}

/** Parsed + validated swap, ready to sign. */
export interface ParsedEscrowSwap {
  wire: EscrowSwapWire;
  /** The SIG_ALL message the digest is computed over. */
  message: string;
  inputTotalSats: number;
  outputTotalSats: number;
}

/** Witness signatures from a cashu Proof's witness (string JSON or object). */
export function witnessSignatures(witness: unknown): string[] {
  if (!witness) return [];
  if (typeof witness === 'string') {
    try {
      const parsed = JSON.parse(witness) as { signatures?: unknown };
      return Array.isArray(parsed?.signatures) ? parsed.signatures.filter((s): s is string => typeof s === 'string') : [];
    } catch {
      return [];
    }
  }
  if (typeof witness === 'object') {
    const sigs = (witness as { signatures?: unknown }).signatures;
    return Array.isArray(sigs) ? sigs.filter((s): s is string => typeof s === 'string') : [];
  }
  return [];
}

/** The SIG_ALL message for a swap (mirrors cashu-ts buildP2PKSigAllMessage). */
export function buildSigAllMessage(inputs: EscrowSwapInputWire[], outputs: EscrowSwapOutputWire[]): string {
  const parts: string[] = [];
  for (const input of inputs) parts.push(input.secret, input.C);
  for (const output of outputs) parts.push(String(output.blindedMessage.amount), output.blindedMessage.B_);
  return parts.join('');
}

/** BIP-340 signature over sha256(message), hex. */
export function signSigAllDigest(privateKeyHex: string, message: string): string {
  const digest = sha256(new TextEncoder().encode(message));
  return bytesToHex(schnorr.sign(digest, hexToBytes(privateKeyHex)));
}

/** Verify a hex Schnorr signature over sha256(message) for an x-only/compressed pubkey. */
export function verifySigAllSignature(pubkey: string, message: string, signatureHex: string): boolean {
  const normalized = normalizeMultisigPubkey(pubkey);
  if (!normalized || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  try {
    const digest = sha256(new TextEncoder().encode(message));
    return schnorr.verify(hexToBytes(signatureHex.toLowerCase()), digest, hexToBytes(normalized));
  } catch {
    return false;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

function isOutputShape(value: unknown): value is EscrowSwapOutputWire {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  const bm = o.blindedMessage as Record<string, unknown> | undefined;
  return (
    !!bm && typeof bm === 'object'
    && Number.isSafeInteger(bm.amount) && (bm.amount as number) > 0
    && typeof bm.B_ === 'string' && bm.B_.length > 0
    && typeof bm.id === 'string' && bm.id.length > 0
    && typeof o.blindingFactor === 'string' && HEX64.test(o.blindingFactor)
    && typeof o.secret === 'string' && o.secret.length > 0 && o.secret.length % 2 === 0 && /^[0-9a-f]+$/i.test(o.secret)
  );
}

function isInputShape(value: unknown): value is EscrowSwapInputWire {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' && p.id.length > 0
    && Number.isSafeInteger(p.amount) && (p.amount as number) > 0
    && typeof p.secret === 'string' && p.secret.length > 0
    && typeof p.C === 'string' && p.C.length > 0
  );
}

/** Decode an output's NUT-10 secret to the single payout key it locks to. */
function outputPayoutKey(output: EscrowSwapOutputWire): string | null {
  let secret: string;
  try {
    secret = new TextDecoder().decode(hexToBytes(output.secret.toLowerCase()));
  } catch {
    return null;
  }
  const lock = parseMultisigLockSecret(secret);
  if (!lock) return null;
  // Payout outputs are clean 1-of-1 locks: exactly one key, no refund keys.
  if (lock.lockKeys.length !== 1 || lock.requiredSignatures !== 1) return null;
  if (lock.refundKeys.length !== 0) return null;
  return lock.lockKeys[0];
}

/** The `sigflag` tag of a NUT-10 secret, or null when unparseable. */
function lockSigFlag(secret: string): string | null {
  try {
    const parsed = JSON.parse(secret) as unknown;
    if (!Array.isArray(parsed) || parsed[0] !== 'P2PK') return null;
    const body: unknown = parsed[1];
    const tags = body && typeof body === 'object' && !Array.isArray(body)
      ? ((body as { tags?: unknown }).tags ?? [])
      : parsed.slice(2);
    if (!Array.isArray(tags)) return null;
    for (const tag of tags) {
      if (Array.isArray(tag) && tag[0] === 'sigflag' && typeof tag[1] === 'string') return tag[1];
    }
    return 'SIG_INPUTS';
  } catch {
    return null;
  }
}

/**
 * Validate a serialized initiate swap against the expectation and return the
 * SIG_ALL message to sign. Throws a typed Error on ANY shape drift - never a
 * partial result, because the signature authorizes the whole payout.
 */
export function parseEscrowSwapForCompletion(wire: unknown, expectation: EscrowSwapExpectation): ParsedEscrowSwap {
  const swap = wire as EscrowSwapWire;
  if (!swap || typeof swap !== 'object') throw new Error('Escrow swap is not an object');
  if (typeof swap.mint !== 'string' || !swap.mint) throw new Error('Escrow swap has no mint');
  if (expectation.mint) {
    if (swap.mint.replace(/\/+$/, '').toLowerCase() !== expectation.mint.replace(/\/+$/, '').toLowerCase()) {
      throw new Error('Escrow swap mint does not match the expected escrow mint');
    }
  } else {
    let mintUrl: URL;
    try {
      mintUrl = new URL(swap.mint);
    } catch {
      throw new Error('Escrow swap mint is not a valid URL');
    }
    const local = mintUrl.hostname === 'localhost' || mintUrl.hostname === '127.0.0.1' || mintUrl.hostname === '[::1]';
    if (mintUrl.protocol !== 'https:' && !(mintUrl.protocol === 'http:' && local)) {
      throw new Error('Escrow swap mint is not https');
    }
  }
  if (!Array.isArray(swap.inputs) || swap.inputs.length === 0 || !swap.inputs.every(isInputShape)) {
    throw new Error('Escrow swap inputs are malformed');
  }
  if (!Array.isArray(swap.outputs) || swap.outputs.length === 0 || !swap.outputs.every(isOutputShape)) {
    throw new Error('Escrow swap outputs are malformed');
  }

  // Single keyset throughout: a swap cannot mix keysets.
  const inputKeyset = swap.inputs[0].id;
  if (!swap.inputs.every((p) => p.id === inputKeyset)) throw new Error('Escrow swap inputs mix keysets');
  const outputKeyset = swap.outputs[0].blindedMessage.id;
  if (!swap.outputs.every((o) => o.blindedMessage.id === outputKeyset)) throw new Error('Escrow swap outputs mix keysets');
  if (inputKeyset !== outputKeyset) throw new Error('Escrow swap input and output keysets differ');
  if (expectation.keysetId && inputKeyset !== expectation.keysetId) {
    throw new Error('Escrow swap keyset does not match the expected escrow keyset');
  }

  const party = normalizeMultisigPubkey(expectation.partyPubkey);
  if (!party) throw new Error('Escrow party pubkey is invalid');
  const expectedOracle = expectation.oraclePubkey ? normalizeMultisigPubkey(expectation.oraclePubkey) : null;
  if (expectation.oraclePubkey && !expectedOracle) throw new Error('Escrow oracle pubkey is invalid');

  // Every input: SIG_ALL 2-of-N escrow lock containing the signing party.
  const candidates = new Set<string>();
  for (const input of swap.inputs) {
    if (lockSigFlag(input.secret) !== 'SIG_ALL') {
      throw new Error('Escrow swap input is not SIG_ALL-locked - the outputs are not bound by the signature');
    }
    const lock = parseMultisigLockSecret(input.secret);
    if (!lock) throw new Error('Escrow swap input is not a P2PK lock');
    if (lock.lockKeys.length < 2 || lock.requiredSignatures < 2) {
      throw new Error('Escrow swap input is not a multisig escrow lock');
    }
    if (!lock.lockKeys.includes(party)) throw new Error('The signing key is not an escrow lock key');
    for (const key of lock.lockKeys) if (key !== party) candidates.add(key);
    if (expectedOracle && !lock.lockKeys.includes(expectedOracle)) {
      throw new Error('Escrow swap input does not include the oracle key');
    }
  }

  const message = buildSigAllMessage(swap.inputs, swap.outputs);

  // The oracle must already have signed EVERY input over this exact digest.
  // Without a declared oracle key, the signer is inferred from the locks:
  // exactly one non-party key must verify on every input.
  const verifiedOracle = [...candidates].filter((key) => swap.inputs.every((input) =>
    witnessSignatures(input.witness).some((sig) => verifySigAllSignature(key, message, sig))));
  if (expectedOracle) {
    if (!verifiedOracle.includes(expectedOracle)) {
      throw new Error('Escrow swap is missing the oracle signature over the swap digest');
    }
  } else if (verifiedOracle.length !== 1) {
    throw new Error(verifiedOracle.length === 0
      ? 'Escrow swap is missing the oracle signature over the swap digest'
      : 'Escrow swap has ambiguous oracle signatures - refusing to sign');
  }

  // Outputs: only the expected payout/fee keys, exact expected amounts.
  const feePubkey = expectation.feePubkey ? normalizeMultisigPubkey(expectation.feePubkey) : null;
  let payoutTotal = 0;
  let feeTotal = 0;
  for (const output of swap.outputs) {
    const key = outputPayoutKey(output);
    if (!key) throw new Error('Escrow swap output is not a clean 1-of-1 P2PK payout');
    // Only the declared payout key and (release swaps) the declared fee key
    // may appear - any other beneficiary fails the signature on principle.
    if (key === normalizeMultisigPubkey(expectation.payoutPubkey)) {
      payoutTotal += output.blindedMessage.amount;
    } else if (feePubkey && key === feePubkey) {
      feeTotal += output.blindedMessage.amount;
    } else {
      throw new Error('Escrow swap pays an unexpected key');
    }
  }
  if (payoutTotal !== expectation.payoutSats) {
    throw new Error(`Escrow swap pays ${payoutTotal} sats to the payout key, expected ${expectation.payoutSats}`);
  }
  const expectedFee = expectation.feeSats ?? 0;
  if (feeTotal !== expectedFee) {
    throw new Error(`Escrow swap pays ${feeTotal} sats in fees, expected ${expectedFee}`);
  }

  const inputTotalSats = swap.inputs.reduce((sum, p) => sum + p.amount, 0);
  const outputTotalSats = payoutTotal + feeTotal;
  if (expectation.mintFeeSats !== undefined && expectation.mintFeeSats !== null) {
    if (inputTotalSats - outputTotalSats !== expectation.mintFeeSats) {
      throw new Error('Escrow swap input/output totals do not match the declared mint fee');
    }
  } else if (outputTotalSats > inputTotalSats) {
    throw new Error('Escrow swap outputs exceed its inputs');
  }

  return { wire: swap, message, inputTotalSats, outputTotalSats };
}

/**
 * Add the party's witness signature over the swap digest to every input.
 * Returns a new wire object; the inputs/outputs are otherwise untouched so the
 * digest still matches. Verifies the signature landed on every input (a wrong
 * key would otherwise sign nothing and the API would reject opaquely).
 */
export function signEscrowSwapForParty(
  parsed: ParsedEscrowSwap,
  privateKeyHex: string,
): EscrowSwapWire {
  if (!/^[0-9a-f]{64}$/i.test(privateKeyHex)) throw new Error('Escrow signing key is malformed');
  const signature = signSigAllDigest(privateKeyHex, parsed.message);
  const party = schnorr.getPublicKey(hexToBytes(privateKeyHex.toLowerCase()));
  if (!verifySigAllSignature(bytesToHex(party), parsed.message, signature)) {
    throw new Error('Escrow signing produced an unverifiable signature');
  }
  const inputs = parsed.wire.inputs.map((input) => ({
    ...input,
    witness: { signatures: [...witnessSignatures(input.witness), signature] },
  }));
  for (const input of inputs) {
    if (!witnessSignatures(input.witness).includes(signature)) {
      throw new Error('Escrow signature did not attach to every input');
    }
  }
  return { mint: parsed.wire.mint, inputs, outputs: parsed.wire.outputs };
}

/** Complete a milestone release with the project-signed swap. */
export async function completeEscrowRelease(opts: {
  signer: SignerLike;
  frId: string;
  milestoneId: string;
  swap: EscrowSwapWire;
  proofEventId?: string;
}): Promise<{ milestoneStatus: string; releasedSats: number }> {
  const body = await fundFetch<{ data?: Record<string, unknown> }>(
    `/v1/fundraisers/${encodeURIComponent(opts.frId)}/milestones/${encodeURIComponent(opts.milestoneId)}/release/complete`,
    {
      method: 'POST',
      body: { swap: opts.swap, ...(opts.proofEventId ? { proof_event_id: opts.proofEventId } : {}) },
      signer: opts.signer,
    },
  );
  const data = body?.data;
  const milestone = data?.milestone as { status?: unknown } | undefined;
  const releasedSats = data?.released_sats;
  if (!data || typeof data !== 'object'
    || !milestone || typeof milestone !== 'object' || typeof milestone.status !== 'string'
    || typeof releasedSats !== 'number') {
    throw new Error('The Fund API did not confirm the release swap - the milestone was NOT settled');
  }
  return { milestoneStatus: milestone.status, releasedSats };
}

/** Complete a contribution refund with the donor-signed swap. */
export async function completeEscrowRefund(opts: {
  signer: SignerLike;
  frId: string;
  contributionId: string;
  swap: EscrowSwapWire;
}): Promise<{ refundSats: number }> {
  const body = await fundFetch<{ data?: Record<string, unknown> }>(
    `/v1/fundraisers/${encodeURIComponent(opts.frId)}/contributions/${encodeURIComponent(opts.contributionId)}/refund/complete`,
    { method: 'POST', body: { swap: opts.swap }, signer: opts.signer },
  );
  const data = body?.data;
  const refundSats = data?.refund_sats;
  if (!data || typeof data !== 'object' || data.refunded !== true
    || String(data.contribution_id) !== String(opts.contributionId)
    || typeof refundSats !== 'number') {
    throw new Error('The Fund API did not confirm the refund swap - the contribution was NOT refunded');
  }
  return { refundSats };
}
