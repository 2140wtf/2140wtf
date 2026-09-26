/**
 * Liquid-testnet holding wallet core — client-side, non-custodial.
 *
 * Owner decision (2026-09-22, docs/WALLET-RAILS-PORT-PLAN.md): full
 * confidential support. The wallet derives the markets-parity key material
 * (same seed → same keys as bao.markets' LiquidUserKeys, so the two apps
 * share one wallet), receives on the confidential (`tlq1…`) and
 * unconfidential (`tex1…`) pair, unblinds confidential UTXOs in the browser
 * (secp256k1-zkp via liquidjs-lib's `Confidential`), and sends explicit
 * outputs with the mandatory Elements fee output.
 *
 * Deliberate divergence from bao.markets: no server calls hold keys or build
 * transactions. Address generation, unblinding, PSET construction and
 * signing all happen here; only Esplora reads the chain.
 *
 * Sends blind confidential destinations (`tlq1…`): the amount/asset
 * commitments, range proof and surjection proof are produced in-browser with
 * secp256k1-zkp (`ZKPGenerator`/`Blinder`/`ZKPValidator`), while change and
 * the mandatory Elements fee output stay explicit. The ZKP context is
 * resolved through the injectable factory seam (`LiquidSendOptions.zkpFactory`
 * — default: the shared lazy loader, never a global mutation). An unavailable
 * context refuses with the typed `blinding_unavailable` error: an output is
 * never sent unblinded to a confidential address and proofs are never
 * fabricated.
 */
import {
  address as liquidAddress,
  Blinder,
  confidential,
  Creator,
  Extractor,
  Finalizer,
  networks,
  payments,
  script as liquidScript,
  Transaction,
  Updater,
  ZKPGenerator,
  ZKPValidator,
  type TxOutput,
} from 'liquidjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
  LIQUID_TESTNET_ESPLORA_BASE,
  LIQUID_TESTNET_NATIVE_ASSET_ID,
  validateLiquidTestnetAddress,
} from '../../lib/liquidTestnetRail';
import { broadcastTx, feeForVsize, selectCoins, type Utxo } from '../angorPatterns';

/** Markets-parity label scheme (bao.markets `LiquidUserKeys.ts`) — frozen. */
export const LIQUID_USER_KEY_LABEL = 'bao/liquid/user/1';
export const LIQUID_BLINDING_KEY_LABEL = 'bao/liquid/blinding/1';

export const LIQUID_TESTNET_DUST_SATS = 546;
/** Liquid testnet relay fee floor is ~0.1 sat/vB; we never go below it. */
export const LIQUID_TESTNET_FEE_RATE_SAT_VB = 0.1;

export interface LiquidTestnetAccount {
  readonly spendPrivateKey: Uint8Array;
  readonly spendPublicKey: Uint8Array;
  readonly blindingPrivateKey: Uint8Array;
  readonly blindingPublicKey: Uint8Array;
  readonly confidentialAddress: string;
  readonly unconfidentialAddress: string;
  readonly index: number;
  /**
   * The 32-byte rail seed this account was derived from. Kept so scan/send
   * can derive the OTHER receive-chain indexes on demand (receive rotation);
   * secret material, same handling as the private keys, never logged.
   */
  readonly seed: Uint8Array;
}

/**
 * The account at a receive/change-chain index, derived from the seed the
 * caller already holds. The account at its own index is returned as-is, so
 * the common single-index path never re-derives.
 */
function accountAt(account: LiquidTestnetAccount, index: number): LiquidTestnetAccount {
  if (index === account.index) return account;
  return deriveLiquidTestnetAccountFromSeed(account.seed, index);
}

function privateKeyFromLabel(label: string, seed: Uint8Array, index: number): Uint8Array {
  const labelBytes = new TextEncoder().encode(label);
  const input = new Uint8Array(labelBytes.length + seed.length + 4);
  input.set(labelBytes, 0);
  input.set(seed, labelBytes.length);
  new DataView(input.buffer).setUint32(labelBytes.length + seed.length, index >>> 0, true);
  return sha256(input);
}

/** Derive the markets-parity Liquid key pair + address pair for an index. */
export function deriveLiquidTestnetAccountFromSeed(seed: Uint8Array, index = 0): LiquidTestnetAccount {
  if (seed.length !== 32) throw new Error('liquid account: seed must be exactly 32 bytes');
  if (!Number.isSafeInteger(index) || index < 0) throw new Error(`liquid account: bad index ${index}`);
  const spendPrivateKey = privateKeyFromLabel(LIQUID_USER_KEY_LABEL, seed, index);
  const blindingPrivateKey = privateKeyFromLabel(LIQUID_BLINDING_KEY_LABEL, seed, index);
  const spendPublicKey = secp256k1.getPublicKey(spendPrivateKey, true);
  const blindingPublicKey = secp256k1.getPublicKey(blindingPrivateKey, true);
  const payment = payments.p2wpkh({
    pubkey: Buffer.from(spendPublicKey),
    blindkey: Buffer.from(blindingPublicKey),
    network: networks.testnet,
  });
  if (!payment.address || !payment.confidentialAddress) {
    throw new Error('liquid account: derivation produced no address pair');
  }
  return {
    spendPrivateKey,
    spendPublicKey,
    blindingPrivateKey,
    blindingPublicKey,
    confidentialAddress: payment.confidentialAddress,
    unconfidentialAddress: payment.address,
    index,
    seed: new Uint8Array(seed),
  };
}

/** Same derivation from the signed-in identity secret hex (markets parity). */
export function deriveLiquidTestnetAccount(secretHex: string, index = 0): LiquidTestnetAccount {
  if (!/^[0-9a-f]{64}$/.test(secretHex)) {
    throw new Error('liquid account: identity secret must be 64 lowercase hex characters');
  }
  return deriveLiquidTestnetAccountFromSeed(hexToBytes(secretHex), index);
}

/**
 * 32-byte rail seed for a created/imported mnemonic wallet: the BIP-39 seed
 * (`mnemonicToSeed`, PBKDF2-HMAC-SHA512, empty passphrase) compressed with
 * sha256. The label derivation below is the FROZEN markets-parity one and
 * takes exactly 32 bytes, so the mnemonic gets its own deterministic key
 * space instead of reinterpreting the 64-byte BIP-39 seed.
 */
export function liquidTestnetSeedFromMnemonic(mnemonic: string): Uint8Array {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('Invalid mnemonic - check the words and their order');
  }
  return sha256(mnemonicToSeedSync(normalized));
}

/**
 * Import a BIP-39 mnemonic (12/15/18/21/24 words) as a Liquid-testnet wallet.
 * The phrase is expanded with `mnemonicToSeed` and run through the frozen
 * markets-parity label derivation (`deriveLiquidTestnetAccountFromSeed`), so
 * the same phrase always restores the same address pair. The mnemonic stays
 * caller-side; nothing is logged.
 */
export function importLiquidTestnetAccountFromMnemonic(mnemonic: string, index = 0): LiquidTestnetAccount {
  return deriveLiquidTestnetAccountFromSeed(liquidTestnetSeedFromMnemonic(mnemonic), index);
}

/** Generate a fresh mnemonic for a new Liquid-testnet wallet (BIP-39). */
export function generateLiquidTestnetMnemonic(strength: 12 | 24 = 12): string {
  return generateMnemonic(wordlist, strength === 12 ? 128 : 256);
}

// ── unblinding ───────────────────────────────────────────────────────────────

export interface LiquidUnblindResult {
  valueSats: number;
  /** Display-order (reversed) asset id, as used by explorers. */
  assetId: string;
  /** 32-byte wire-order asset id (no confidential prefix). */
  asset: Uint8Array;
  /** 32-byte asset blinding factor (ZERO for explicit outputs). */
  assetBlindingFactor: Uint8Array;
  /** 32-byte value blinding factor (ZERO for explicit outputs). */
  valueBlindingFactor: Uint8Array;
}

export type LiquidUnblindFn = (output: TxOutput, blindingKey: Uint8Array) => Promise<LiquidUnblindResult>;

let zkpPromise: Promise<unknown> | null = null;
let confidentialPromise: Promise<InstanceType<typeof confidential.Confidential>> | null = null;

/**
 * Resolve the zkp wasm factory across module interop shapes: the CJS module
 * can surface the factory as `default` (bundlers) or as `default.default`
 * (raw Node ESM interop). Either way a missing factory fails closed.
 */
function resolveZkpFactory(mod: unknown): (() => Promise<unknown>) | null {
  const outer = (mod as { default?: unknown })?.default;
  if (typeof outer === 'function') return outer as () => Promise<unknown>;
  const inner = (outer as { default?: unknown } | undefined)?.default;
  if (typeof inner === 'function') return inner as () => Promise<unknown>;
  return null;
}

/** The shared secp256k1-zkp interface (unblinding + output blinding). */
export async function getLiquidZkp(): Promise<unknown> {
  if (!zkpPromise) {
    zkpPromise = (async () => {
      const factory = resolveZkpFactory(await import('@vulpemventures/secp256k1-zkp'));
      if (!factory) throw new Error('liquid account: secp256k1-zkp factory unavailable');
      return factory();
    })();
  }
  return zkpPromise;
}

async function loadConfidential(): Promise<InstanceType<typeof confidential.Confidential>> {
  if (!confidentialPromise) {
    confidentialPromise = (async () => new confidential.Confidential((await getLiquidZkp()) as never))();
  }
  return confidentialPromise;
}

/** Production unblinder: secp256k1-zkp ECDH + Pedersen commitment opening. */
export const unblindLiquidOutput: LiquidUnblindFn = async (output, blindingKey) => {
  const conf = await loadConfidential();
  const unblinded = conf.unblindOutputWithKey(output, Buffer.from(blindingKey));
  const asset = new Uint8Array(unblinded.asset);
  return {
    valueSats: parseInt(unblinded.value, 10),
    assetId: Buffer.from(asset).reverse().toString('hex'),
    asset,
    assetBlindingFactor: new Uint8Array(unblinded.assetBlindingFactor),
    valueBlindingFactor: new Uint8Array(unblinded.valueBlindingFactor),
  };
};

// ── chain reads ──────────────────────────────────────────────────────────────

export interface LiquidUtxo extends Utxo {
  /** Receive-chain index of the address that owns this output. */
  readonly index: number;
  readonly address: string;
  readonly confidential: boolean;
  readonly script: Uint8Array;
  /** Exact CT-framed prevout fields for the PSET witnessUtxo. */
  readonly valueCommitment: Uint8Array;
  readonly assetCommitment: Uint8Array;
  readonly nonce: Uint8Array;
  /** 32-byte wire-order asset id (no confidential prefix). */
  readonly assetWire: Uint8Array;
  /** Blinding factors for output blinding (ZERO for explicit outputs). */
  readonly assetBlindingFactor: Uint8Array;
  readonly valueBlindingFactor: Uint8Array;
}

const ZERO32 = new Uint8Array(32);

interface EsploraLiquidUtxo {
  txid: string;
  vout: number;
  status: { confirmed: boolean; block_height?: number | null };
}

async function esploraJson<T>(fetchFn: typeof fetch, url: string): Promise<T> {
  const res = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`liquid esplora ${url} HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function fetchTxHex(fetchFn: typeof fetch, baseUrl: string, txid: string): Promise<Transaction> {
  const res = await fetchFn(`${baseUrl}/tx/${txid}/hex`, { headers: { accept: 'text/plain' } });
  if (!res.ok) throw new Error(`liquid esplora tx ${txid} HTTP ${res.status}`);
  const hex = (await res.text()).trim();
  if (!/^[0-9a-f]+$/i.test(hex)) throw new Error(`liquid esplora tx ${txid} returned non-hex body`);
  return Transaction.fromHex(hex);
}

/**
 * Scan the account's receive chain for LBTC UTXOs: every derivation index
 * from 0..`receiveIndex` (default: the account's own index), confidential +
 * unconfidential address of each. Discovery comes from the address endpoint,
 * but every UTXO is re-derived from the funding transaction itself: txid,
 * script and asset must match, or the scan fails loudly (an explorer cannot
 * make us sign a foreign output). Each UTXO carries its derivation `index`,
 * which the send path uses to pick the right signing key.
 */
export async function scanLiquidTestnetUtxos(
  account: LiquidTestnetAccount,
  opts: { fetchFn?: typeof fetch; baseUrl?: string; unblind?: LiquidUnblindFn; receiveIndex?: number } = {},
): Promise<LiquidUtxo[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const baseUrl = opts.baseUrl ?? LIQUID_TESTNET_ESPLORA_BASE;
  const unblind = opts.unblind ?? unblindLiquidOutput;
  const receiveIndex = opts.receiveIndex ?? account.index;
  if (!Number.isSafeInteger(receiveIndex) || receiveIndex < 0) {
    throw new Error(`liquid scan: bad receive index ${receiveIndex}`);
  }

  const found: LiquidUtxo[] = [];
  const txCache = new Map<string, Transaction>();
  // A confidential output's scriptPubKey IS the unconfidential one (the
  // blinding lives in the address), so Esplora lists the same outpoint under
  // BOTH address forms. Deduplicate by outpoint or the balance (and UTXO
  // count) doubles for every confidential receive — caught live 2026-09-22.
  const seenOutpoints = new Set<string>();

  for (let index = 0; index <= receiveIndex; index++) {
    const scoped = accountAt(account, index);
    for (const [address, isConfidential] of [
      [scoped.confidentialAddress, true],
      [scoped.unconfidentialAddress, false],
    ] as const) {
      const listed = await esploraJson<EsploraLiquidUtxo[]>(fetchFn, `${baseUrl}/address/${address}/utxo`);
      for (const entry of listed) {
        const txid = entry.txid.toLowerCase();
        const outpoint = `${txid}:${entry.vout}`;
        if (seenOutpoints.has(outpoint)) continue;
        seenOutpoints.add(outpoint);
        let tx = txCache.get(txid);
        if (!tx) {
          tx = await fetchTxHex(fetchFn, baseUrl, txid);
          if (tx.getId().toLowerCase() !== txid) {
            throw new Error(`liquid scan: funding tx ${txid} parses to ${tx.getId()} - refusing`);
          }
          txCache.set(txid, tx);
        }
        const output = tx.outs[entry.vout];
        if (!output) throw new Error(`liquid scan: tx ${txid} has no output ${entry.vout}`);
        const expectedScript = liquidAddress.toOutputScript(address, networks.testnet);
        if (Buffer.from(output.script).toString('hex') !== Buffer.from(expectedScript).toString('hex')) {
          throw new Error(`liquid scan: ${txid}:${entry.vout} script does not match ${address} - refusing`);
        }
        const confidentialOutput = Boolean(output.rangeProof && output.rangeProof.length > 0);
        let valueSats: number;
        let assetId: string;
        let assetWire: Uint8Array;
        let assetBlindingFactor: Uint8Array = ZERO32;
        let valueBlindingFactor: Uint8Array = ZERO32;
        if (confidentialOutput) {
          const unblinded = await unblind(output, scoped.blindingPrivateKey);
          valueSats = unblinded.valueSats;
          assetId = unblinded.assetId;
          assetWire = unblinded.asset;
          assetBlindingFactor = unblinded.assetBlindingFactor;
          valueBlindingFactor = unblinded.valueBlindingFactor;
        } else {
          valueSats = confidential.confidentialValueToSatoshi(output.value);
          assetWire = new Uint8Array(output.asset).slice(1);
          assetId = Buffer.from(assetWire).reverse().toString('hex');
        }
        if (assetId.toLowerCase() !== LIQUID_TESTNET_NATIVE_ASSET_ID.toLowerCase()) continue;
        if (valueSats < LIQUID_TESTNET_DUST_SATS) continue;
        found.push({
          txid,
          vout: entry.vout,
          value: valueSats,
          status: entry.status,
          index: scoped.index,
          address,
          confidential: isConfidential && confidentialOutput,
          script: new Uint8Array(output.script),
          valueCommitment: new Uint8Array(output.value),
          assetCommitment: new Uint8Array(output.asset),
          nonce: new Uint8Array(output.nonce),
          assetWire,
          assetBlindingFactor,
          valueBlindingFactor,
        });
      }
    }
  }
  return found;
}

// ── send ─────────────────────────────────────────────────────────────────────

export type LiquidSendFailureCode =
  | 'invalid_address'
  | 'invalid_amount'
  | 'invalid_index'
  | 'utxo_scan_failed'
  | 'insufficient_funds'
  | 'blinding_unavailable'
  | 'build_failed'
  | 'broadcast_failed';

export interface LiquidSendSuccess {
  ok: true;
  txid: string;
  feeSats: number;
  rawTx: string;
  usedInputs: string[];
  changeAddress: string | null;
}
export type LiquidSendFailure = { ok: false; code: LiquidSendFailureCode; message: string };
export type LiquidSendOutcome = LiquidSendSuccess | LiquidSendFailure;

export interface LiquidSendOptions {
  to: string;
  sats: number;
  feeRateSatVb?: number;
  utxos?: LiquidUtxo[];
  /** How many receive-chain indexes to consider (default: account index). */
  receiveIndex?: number;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  unblind?: LiquidUnblindFn;
  /**
   * Injectable secp256k1-zkp factory seam for output blinding (tests and
   * callers with their own loader). Defaults to the shared lazy
   * `getLiquidZkp()`. A factory that rejects or resolves to nothing makes a
   * confidential send fail closed with `blinding_unavailable`; it never
   * touches the module-global cache.
   */
  zkpFactory?: () => Promise<unknown>;
}

/** Conservative vsize: 11 overhead + 68/input + 43/output + fee output. */
export function estimateLiquidVsize(inputCount: number, outputCount: number): number {
  return 11 + 68 * inputCount + 43 * outputCount;
}

/** One ephemeral blinding key pair for a confidential output. */
function randomEphemeralKeyPair(): { publicKey: Buffer; privateKey: Buffer } {
  const privateKey = secp256k1.utils.randomSecretKey();
  return {
    privateKey: Buffer.from(privateKey),
    publicKey: Buffer.from(secp256k1.getPublicKey(privateKey, true)),
  };
}

/**
 * Build, sign and broadcast a Liquid send. Inputs may be confidential (spent
 * via their real commitments, never the unblinded value) and the destination
 * may be a confidential `tlq1…` address (blinded in-browser with
 * secp256k1-zkp range + surjection proofs). Fail-closed throughout: a
 * confidential destination with no usable blinding context is refused with
 * `blinding_unavailable`, never sent as an unblinded output.
 */
export async function sendLiquidTestnet(
  account: LiquidTestnetAccount,
  opts: LiquidSendOptions,
): Promise<LiquidSendOutcome> {
  if (!Number.isSafeInteger(opts.sats) || opts.sats <= 0) {
    return { ok: false, code: 'invalid_amount', message: 'Enter a whole number of sats greater than zero' };
  }
  const receiveIndex = opts.receiveIndex ?? account.index;
  if (!Number.isSafeInteger(receiveIndex) || receiveIndex < 0) {
    return { ok: false, code: 'invalid_index', message: 'Invalid receive-chain index' };
  }

  // Confidential destinations are decoded with their blinding pubkey; every
  // other destination must pass the unconfidential rail validator (which also
  // rejects mainnet/bitcoin prefixes).
  const isConfidentialDestination = /^(tlq1|lq1)/i.test(opts.to);
  let destination: { script: Uint8Array; blindingKey: Uint8Array | null };
  if (isConfidentialDestination) {
    try {
      const decoded = liquidAddress.fromConfidential(opts.to);
      destination = {
        script: decoded.scriptPubKey ?? liquidAddress.toOutputScript(decoded.unconfidentialAddress, networks.testnet),
        blindingKey: new Uint8Array(decoded.blindingKey),
      };
    } catch (e) {
      return { ok: false, code: 'invalid_address', message: e instanceof Error ? e.message : 'invalid confidential address' };
    }
  } else {
    try {
      validateLiquidTestnetAddress(opts.to);
      destination = { script: liquidAddress.toOutputScript(opts.to, networks.testnet), blindingKey: null };
    } catch (e) {
      return { ok: false, code: 'invalid_address', message: e instanceof Error ? e.message : 'invalid liquid address' };
    }
  }

  // A confidential destination needs output blinding (Pedersen commitments +
  // range/surjection proofs). Resolve the ZKP context through the injectable
  // factory seam (or the shared lazy loader) BEFORE any network or signing
  // work, so an unavailable wasm/context refuses with a typed, actionable
  // error instead of sending an unblinded output or fabricating proofs.
  // Explicit destinations never touch the factory.
  let zkp: unknown = null;
  if (destination.blindingKey) {
    try {
      zkp = await (opts.zkpFactory ?? getLiquidZkp)();
    } catch (e) {
      return {
        ok: false,
        code: 'blinding_unavailable',
        message: `Confidential sends need the secp256k1-zkp blinding context, which failed to load: ${e instanceof Error ? e.message : 'unknown error'}`,
      };
    }
    if (zkp === null || zkp === undefined) {
      return {
        ok: false,
        code: 'blinding_unavailable',
        message: 'Confidential sends need the secp256k1-zkp blinding context, but the factory returned nothing - refusing to send an unblinded output',
      };
    }
  }

  const fetchFn = opts.fetchFn ?? fetch;
  const baseUrl = opts.baseUrl ?? LIQUID_TESTNET_ESPLORA_BASE;

  let utxos: LiquidUtxo[];
  try {
    utxos = opts.utxos ?? (await scanLiquidTestnetUtxos(account, { fetchFn, baseUrl, receiveIndex, ...(opts.unblind ? { unblind: opts.unblind } : {}) }));
  } catch (e) {
    return { ok: false, code: 'utxo_scan_failed', message: e instanceof Error ? e.message : 'could not scan the wallet' };
  }

  const rate = opts.feeRateSatVb ?? LIQUID_TESTNET_FEE_RATE_SAT_VB;
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, code: 'invalid_amount', message: 'invalid fee rate' };
  }

  let selected: LiquidUtxo[] = [];
  let inputCountEstimate = 1;
  for (let attempt = 0; attempt < 10; attempt++) {
    // 3 outputs: destination + change + the mandatory fee output.
    const feeGuess = Math.max(1, feeForVsize(estimateLiquidVsize(inputCountEstimate, 3), rate));
    const result = selectCoins(utxos, opts.sats, feeGuess);
    if (result.error) return { ok: false, code: 'insufficient_funds', message: result.error };
    selected = result.selected as LiquidUtxo[];
    if (selected.length === inputCountEstimate) break;
    inputCountEstimate = Math.max(1, selected.length);
  }

  const total = selected.reduce((sum, u) => sum + u.value, 0);

  /**
   * Build at a given fee. The fee is an explicit output, so the ONLY inputs
   * are the selection, the destination amount and the change policy (dust
   * change rolls into the fee). Blinding + signing happen here; callers may
   * rebuild with a corrected fee (see the loop below).
   */
  const buildAtFee = async (fee: number, changeAmount: number): Promise<{ rawTx: string; changeAddress: string | null }> => {
    let changeAddress: string | null = null;
    const pset = Creator.newPset();
    const updater = new Updater(pset);
    for (const u of selected) {
      // PSET sanity rule: explicitValue/explicitAsset may ONLY be set when the
      // prevout carries commitments (33-byte value commitment). The sighash
      // for a confidential prevout commits the EXPLICIT amount/asset, not the
      // blinding factors - without these fields the node rejects the
      // signature ("Signature must be zero for failed CHECK(MULTI)SIG").
      const isConfidentialPrevout = u.valueCommitment.length > 9;
      updater.addInputs([{
        txid: u.txid,
        txIndex: u.vout,
        sighashType: 0x01,
        witnessUtxo: {
          script: Buffer.from(u.script),
          value: Buffer.from(u.valueCommitment),
          asset: Buffer.from(u.assetCommitment),
          nonce: Buffer.from(u.nonce),
        },
        ...(isConfidentialPrevout
          ? { explicitValue: u.value, explicitAsset: Buffer.from(u.assetWire) }
          : {}),
      }]);
    }
    updater.addOutputs([{
      script: Buffer.from(destination.script),
      amount: opts.sats,
      asset: LIQUID_TESTNET_NATIVE_ASSET_ID,
      // PSET v2 wants the output to name the input whose owner blinds it;
      // every input here belongs to the sender, so 0 is the honest choice.
      ...(destination.blindingKey ? { blindingPublicKey: Buffer.from(destination.blindingKey), blinderIndex: 0 } : {}),
    }]);
    if (changeAmount >= LIQUID_TESTNET_DUST_SATS) {
      // Change returns to the CURRENT receive address (highest used index),
      // so the next scan (0..receiveIndex) finds it without gap management.
      const changeAccount = accountAt(account, receiveIndex);
      changeAddress = changeAccount.unconfidentialAddress;
      updater.addOutputs([{
        script: liquidAddress.toOutputScript(changeAccount.unconfidentialAddress, networks.testnet),
        amount: changeAmount,
        asset: LIQUID_TESTNET_NATIVE_ASSET_ID,
      }]);
    }
    // Elements requires an explicit fee output (empty script, LBTC).
    updater.addOutputs([{
      script: Buffer.alloc(0),
      amount: fee,
      asset: LIQUID_TESTNET_NATIVE_ASSET_ID,
    }]);

    // Blinding must precede signing: the sighash commits output commitments.
    // `zkp` was resolved (and validated) before any build work.
    if (destination.blindingKey) {
      const ownedInputs = selected.map((u, index) => ({
        index,
        value: String(u.value),
        asset: Buffer.from(u.assetWire),
        assetBlindingFactor: Buffer.from(u.assetBlindingFactor),
        valueBlindingFactor: Buffer.from(u.valueBlindingFactor),
      }));
      const generator = new ZKPGenerator(zkp as never, ZKPGenerator.WithOwnedInputs(ownedInputs));
      const validator = new ZKPValidator(zkp as never);
      const blindedIndexes = pset.outputs
        .map((output, index) => (output.needsBlinding() ? index : -1))
        .filter((index) => index >= 0);
      const outputBlindingArgs = generator.blindOutputs(pset, randomEphemeralKeyPair, blindedIndexes);
      new Blinder(pset, ownedInputs, validator, generator).blindLast({ outputBlindingArgs });
    }

    for (let i = 0; i < pset.inputs.length; i++) {
      // Inputs were added in selection order; each input signs with the key
      // of the receive-chain index that owns its address (rotation-safe).
      const utxo = selected[i];
      if (!utxo) throw new Error('liquid send: input/selection mismatch');
      const signer = accountAt(account, utxo.index);
      const preimage = pset.getInputPreimage(i, 0x01);
      // prehash:false — the preimage IS the sighash; noble v2 would otherwise
      // sha256 it again (tiny-secp256k1/markets sign the hash directly).
      const signature = secp256k1.sign(new Uint8Array(preimage), signer.spendPrivateKey, { prehash: false });
      updater.addInPartialSignature(i, {
        pubkey: Buffer.from(signer.spendPublicKey),
        signature: liquidScript.signature.encode(Buffer.from(signature), 0x01),
      }, () => true);
    }
    new Finalizer(pset).finalize();
    return { rawTx: Extractor.extract(pset).toHex(), changeAddress };
  };

  // Confidential outputs carry kilobyte-scale range/surjection proofs, so the
  // naive base-size estimate is far below the real (weight) vsize. Build,
  // measure the ACTUAL transaction, and rebuild with the required fee when
  // the node minimum demands more (live-caught: "fee below the node minimum").
  let feeSats = Math.max(1, feeForVsize(estimateLiquidVsize(selected.length, 3), rate));
  let built: { rawTx: string; changeAddress: string | null } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const changeCandidate = total - opts.sats - feeSats;
    if (changeCandidate < 0) {
      return { ok: false, code: 'insufficient_funds', message: 'fee correction exhausted the wallet balance - add funds or send less' };
    }
    const changeForBuild = changeCandidate >= LIQUID_TESTNET_DUST_SATS ? changeCandidate : 0;
    const effectiveFee = total - opts.sats - changeForBuild;
    try {
      built = await buildAtFee(effectiveFee, changeForBuild);
    } catch (e) {
      return { ok: false, code: 'build_failed', message: e instanceof Error ? e.message : 'could not build the transaction' };
    }
    const parsed = Transaction.fromHex(built.rawTx);
    // discountCT=false: never rely on the node discounting confidential data.
    const required = Math.max(1, Math.ceil(parsed.virtualSize(false) * rate));
    if (effectiveFee >= required) {
      feeSats = effectiveFee;
      break;
    }
    feeSats = required;
    built = null;
  }
  if (!built) {
    return { ok: false, code: 'build_failed', message: 'could not converge on a fee that satisfies the node minimum' };
  }
  const rawTx = built.rawTx;
  const changeAddress = built.changeAddress;

  const outcome = await broadcastTx(fetchFn, rawTx, baseUrl);
  if (!outcome.ok) return { ok: false, code: 'broadcast_failed', message: outcome.message };

  return {
    ok: true,
    txid: outcome.txid,
    feeSats,
    rawTx,
    usedInputs: selected.map((u) => `${u.txid}:${u.vout}`),
    changeAddress,
  };
}
