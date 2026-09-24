/**
 * testnet4 on-chain holding wallet — markets-parity account core.
 *
 * Ported from bao.markets' `TestnetOnChainWallet.ts` (WP6, Angor patterns)
 * with the owner decision recorded in docs/WALLET-RAILS-PORT-PLAN.md:
 *
 *   - SESSION derivation is FROZEN cross-app: the same identity derives the
 *     same BIP-84 account in bao.markets and here. Do not migrate it to the
 *     baofund-kdf labels — that would split one wallet into two.
 *   - The pure decision layer (fees, coin selection, pending-spent,
 *     broadcast error mapping) is the existing `src/wallet/angorPatterns.ts`
 *     — this module only adds the account/address/PSBT layer on top.
 *   - Signing uses `@scure/btc-signer` (already a fund dependency), not
 *     bitcoinjs-lib; the behavioral contract is the markets wallet's, locked
 *     by parity vectors in `testnet4Account.test.ts`.
 *
 * Non-custodial: keys are derived in the browser from the signed-in seed
 * identity (or an imported mnemonic held in memory for the session). The
 * network never sees a secret — only addresses and txids.
 */
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { p2wpkh, TEST_NETWORK, Transaction } from '@scure/btc-signer';
import { hex } from '@scure/base';
import { TESTNET4_ESPLORA_BASE, validateTestnet4Address } from '../../lib/testnet4Rail';
import {
  broadcastTx,
  feeForVsize,
  feeRateFor,
  fetchRecommendedFees,
  selectCoins,
  type BroadcastOutcome,
  type PendingSpentTracker,
  type Utxo,
} from '../angorPatterns';

/** Frozen cross-app KDF tag — see module header and the plan doc's table. */
export const TESTNET4_SESSION_KDF_TAG = 'bao-testnet4-wallet-v1';

/** BIP-84 testnet account 0: chain 0 = receive, chain 1 = change. */
export const TESTNET4_ACCOUNT_PATH = "m/84'/1'/0'" as const;

export type Testnet4FeeTier = 'fastest' | 'halfHour' | 'hour' | 'economy';
export type Testnet4AccountSource = 'session' | 'imported';

export interface Testnet4Account {
  /** BIP-32 account node, in memory only — never serialized. */
  readonly node: HDKey;
  readonly path: typeof TESTNET4_ACCOUNT_PATH;
  readonly source: Testnet4AccountSource;
}

export interface Testnet4Utxo extends Utxo {
  readonly address: string;
  readonly chain: 0 | 1;
  readonly index: number;
  /** ScriptPubKey for PSBT building (derived from the account, not decoded). */
  readonly script: Uint8Array;
}

/** Derive the session account from the signed-in identity secret (markets parity). */
export function deriveTestnet4Account(secretKeyHex: string): Testnet4Account {
  if (!/^[0-9a-f]{64}$/.test(secretKeyHex)) {
    throw new Error('testnet4 account: identity secret must be 64 lowercase hex characters');
  }
  const seed = sha256(utf8ToBytes(`${TESTNET4_SESSION_KDF_TAG}:${secretKeyHex}`));
  return {
    node: HDKey.fromMasterSeed(seed).derive(TESTNET4_ACCOUNT_PATH),
    path: TESTNET4_ACCOUNT_PATH,
    source: 'session',
  };
}

/** Import a BIP-39 mnemonic (12/24 words). The mnemonic stays caller-side. */
export function importTestnet4AccountFromMnemonic(mnemonic: string): Testnet4Account {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('Invalid mnemonic - check the words and their order');
  }
  return {
    node: HDKey.fromMasterSeed(mnemonicToSeedSync(normalized)).derive(TESTNET4_ACCOUNT_PATH),
    path: TESTNET4_ACCOUNT_PATH,
    source: 'imported',
  };
}

/** Generate a fresh mnemonic for a new testnet4 wallet. */
export function generateTestnet4Mnemonic(strength: 12 | 24 = 12): string {
  return generateMnemonic(wordlist, strength === 12 ? 128 : 256);
}

/** Address (P2WPKH) at a chain/index with its script and derivation path. */
export function testnet4AddressAt(
  account: Testnet4Account,
  chain: 0 | 1,
  index: number,
): { address: string; pubkey: Uint8Array; script: Uint8Array; path: string } {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error(`testnet4 account: bad index ${index}`);
  const child = account.node.deriveChild(chain).deriveChild(index);
  const pubkey = child.publicKey;
  if (!pubkey) throw new Error('testnet4 account: derivation produced no public key');
  const payment = p2wpkh(pubkey, TEST_NETWORK);
  if (!payment.address) throw new Error('testnet4 account: derivation produced no address');
  return {
    address: payment.address,
    pubkey,
    script: payment.script,
    path: `${TESTNET4_ACCOUNT_PATH}/${chain}/${index}`,
  };
}

/** Signing key at a chain/index (memory-only; never serialized). */
export function testnet4KeyAt(account: Testnet4Account, chain: 0 | 1, index: number): Uint8Array {
  const child = account.node.deriveChild(chain).deriveChild(index);
  if (!child.privateKey) throw new Error(`testnet4 account: no private key at ${chain}/${index}`);
  return child.privateKey;
}

interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number | null };
}

/** UTXOs at one address; dust-ish inputs (<1000 sats) are ignored (markets parity). */
export async function fetchTestnet4Utxos(
  address: string,
  fetchFn: typeof fetch = fetch,
  baseUrl = TESTNET4_ESPLORA_BASE,
): Promise<Utxo[]> {
  const res = await fetchFn(`${baseUrl}/address/${address}/utxo`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`testnet4 utxo fetch HTTP ${res.status}`);
  const raw = (await res.json()) as EsploraUtxo[];
  return raw
    .filter((u) => u.value >= 1000)
    .map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, status: u.status }));
}

/**
 * Scan the receive/change address windows (markets window sizes) and tag each
 * UTXO with the address, chain/index and script that must sign it.
 */
export async function scanTestnet4Utxos(
  account: Testnet4Account,
  opts: { receiveIndex: number; changeIndex: number; fetchFn?: typeof fetch; baseUrl?: string },
): Promise<Testnet4Utxo[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const baseUrl = opts.baseUrl ?? TESTNET4_ESPLORA_BASE;
  const receiveCount = Math.max(opts.receiveIndex + 5, 5);
  const changeCount = Math.max(opts.changeIndex + 5, 3);

  const targets: Array<{ chain: 0 | 1; index: number; address: string; script: Uint8Array }> = [];
  for (let i = 0; i < receiveCount; i++) {
    const a = testnet4AddressAt(account, 0, i);
    targets.push({ chain: 0, index: i, address: a.address, script: a.script });
  }
  for (let i = 0; i < changeCount; i++) {
    const a = testnet4AddressAt(account, 1, i);
    targets.push({ chain: 1, index: i, address: a.address, script: a.script });
  }

  const perAddress = await Promise.all(
    targets.map(async (t) => {
      const utxos = await fetchTestnet4Utxos(t.address, fetchFn, baseUrl);
      return utxos.map((u): Testnet4Utxo => ({ ...u, address: t.address, chain: t.chain, index: t.index, script: t.script }));
    }),
  );
  return perAddress.flat();
}

/** Conservative P2WPKH vsize estimate: 11 overhead + 68/input + outputs. */
export function estimateTestnet4Vsize(inputCount: number, opts: { destinationVsize: number; withChange: boolean }): number {
  const outputs = opts.destinationVsize + (opts.withChange ? 31 : 0);
  return 11 + 68 * inputCount + outputs;
}

/** Output vsize from the validated witness version (P2TR 43, P2WPKH 31). */
function outputVsizeFor(address: string): number {
  const { version } = validateTestnet4Address(address);
  return version === 0 ? 31 : 43;
}

export type Testnet4SendFailureCode =
  | 'invalid_address'
  | 'invalid_amount'
  | 'fee_estimate_failed'
  | 'utxo_scan_failed'
  | 'insufficient_funds'
  | 'build_failed'
  | 'broadcast_failed';

export interface Testnet4SendSuccess {
  ok: true;
  txid: string;
  feeSats: number;
  rawTx: string;
  usedInputs: string[];
  changeAddress: string | null;
}
export type Testnet4SendFailure = { ok: false; code: Testnet4SendFailureCode; message: string };
export type Testnet4SendOutcome = Testnet4SendSuccess | Testnet4SendFailure;

export interface Testnet4SendOptions {
  to: string;
  sats: number;
  feeTier?: Testnet4FeeTier;
  receiveIndex: number;
  changeIndex: number;
  /** Pre-scanned UTXOs (tests / a caller that already refreshed). */
  utxos?: Testnet4Utxo[];
  /** Session reservation store; selected inputs are marked after broadcast. */
  reserved?: PendingSpentTracker;
  allowUnconfirmed?: boolean;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  nowSeconds?: number;
}

/**
 * Build, sign and broadcast a P2WPKH send. Fail-closed: every validation and
 * broadcast failure is a typed outcome; inputs are marked pending-spent only
 * after the explorer returns a well-formed txid.
 */
export async function sendTestnet4(
  account: Testnet4Account,
  opts: Testnet4SendOptions,
): Promise<Testnet4SendOutcome> {
  if (!Number.isSafeInteger(opts.sats) || opts.sats <= 0) {
    return { ok: false, code: 'invalid_amount', message: 'Enter a whole number of sats greater than zero' };
  }
  try {
    validateTestnet4Address(opts.to);
  } catch (e) {
    return { ok: false, code: 'invalid_address', message: e instanceof Error ? e.message : 'invalid testnet4 address' };
  }

  const fetchFn = opts.fetchFn ?? fetch;
  const baseUrl = opts.baseUrl ?? TESTNET4_ESPLORA_BASE;
  const reserved = opts.reserved;

  const fees = await fetchRecommendedFees(fetchFn, baseUrl);
  if (!fees) {
    return { ok: false, code: 'fee_estimate_failed', message: 'Could not fetch a fee estimate from the testnet4 explorer - retry shortly' };
  }
  const rate = feeRateFor(opts.feeTier ?? 'hour', fees, 1);

  let utxos: Testnet4Utxo[];
  try {
    utxos = opts.utxos
      ?? (await scanTestnet4Utxos(account, { receiveIndex: opts.receiveIndex, changeIndex: opts.changeIndex, fetchFn, baseUrl }));
  } catch (e) {
    return { ok: false, code: 'utxo_scan_failed', message: e instanceof Error ? e.message : 'could not load wallet UTXOs' };
  }

  const destinationVsize = outputVsizeFor(opts.to);
  const target = opts.sats;
  let selected: Testnet4Utxo[] = [];
  let feeSats = 0;
  let change = 0;
  let dustChange = false;

  // Fee depends on the input count and the input count depends on the fee:
  // iterate to a fixed point (markets selects with the same accumulate loop).
  let inputCountEstimate = 1;
  for (let attempt = 0; attempt < 10; attempt++) {
    feeSats = feeForVsize(estimateTestnet4Vsize(inputCountEstimate, { destinationVsize, withChange: true }), rate);
    const result = selectCoins(utxos, target, feeSats, {
      allowUnconfirmed: opts.allowUnconfirmed,
      ...(reserved ? { pendingSpent: reserved.reservedSet() } : {}),
    });
    if (result.error) return { ok: false, code: 'insufficient_funds', message: result.error };
    selected = result.selected as Testnet4Utxo[];
    change = result.change;
    dustChange = Boolean(result.dustChange);
    if (selected.length === inputCountEstimate) break;
    inputCountEstimate = Math.max(1, selected.length);
  }

  // Dust change cannot be spent: roll it into the fee (change output dropped).
  if (dustChange || (change > 0 && change < 546)) {
    const total = selected.reduce((s, u) => s + u.value, 0);
    feeSats = total - target;
    change = 0;
  }

  let tx: Transaction;
  let changeAddress: string | null = null;
  try {
    tx = new Transaction();
    for (const u of selected) {
      tx.addInput({
        txid: u.txid,
        index: u.vout,
        witnessUtxo: { amount: BigInt(u.value), script: u.script },
      });
    }
    tx.addOutputAddress(opts.to, BigInt(target), TEST_NETWORK);
    if (change >= 546) {
      const changeAt = testnet4AddressAt(account, 1, opts.changeIndex);
      changeAddress = changeAt.address;
      tx.addOutputAddress(changeAt.address, BigInt(change), TEST_NETWORK);
    }
    selected.forEach((u, i) => {
      tx.signIdx(testnet4KeyAt(account, u.chain, u.index), i);
    });
    tx.finalize();
  } catch (e) {
    return { ok: false, code: 'build_failed', message: e instanceof Error ? e.message : 'could not build the transaction' };
  }

  const rawTx = hex.encode(tx.extract());
  const outcome: BroadcastOutcome = await broadcastTx(fetchFn, rawTx, baseUrl);
  if (!outcome.ok) return { ok: false, code: 'broadcast_failed', message: outcome.message };

  if (reserved) {
    const at = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    for (const u of selected) reserved.mark(`${u.txid}:${u.vout}`, outcome.txid, at);
  }

  return {
    ok: true,
    txid: outcome.txid,
    feeSats,
    rawTx,
    usedInputs: selected.map((u) => `${u.txid}:${u.vout}`),
    changeAddress,
  };
}
