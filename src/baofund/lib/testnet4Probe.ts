/**
 * Testnet4 rail step 3b - Esplora confirmation probe (docs/TESTNET4-RAIL-
 * DESIGN.md §6 step 3, §2, §3.3).
 *
 * Reads ONLY. Talks to the public testnet4 Esplora (mempool.space by
 * default, owner call 4; a sovereign node is a base-URL swap behind the
 * same interface). Honesty rules:
 *
 *   - Network failure / non-2xx / malformed body → status `unavailable`
 *     with the HTTP detail. NEVER `confirmed` by absence of failure, never
 *     a guess from a cached value.
 *   - Chain identity (§2 honest limit): `tb` addresses cannot distinguish
 *     several test networks, so every probe pins the testnet4 GENESIS hash -
 *     the block at height 0 returned by THIS API must equal the constant.
 *     A mismatch (wrong chain, lying proxy) fails typed `network_mismatch`.
 *   - Reorg-aware: confirmations come from the tip delta, and the block
 *     hash the tx was included in is echoed back so callers can re-verify
 *     after reorgs.
 *   - Every result carries the evidence record (§2): genesis anchor, query
 *     URL, observed tip height, and the time of observation (injected -
 *     the probe never reads the wall clock; callers pass `nowSeconds`).
 */
import {
  BTC_TESTNET4_GENESIS_HASH,
  TESTNET4_ESPLORA_BASE,
  validateTestnet4Txid,
} from './testnet4Rail';

export class Testnet4ProbeError extends Error {
  readonly code: 'network_mismatch' | 'bad_response' | 'bad_config';
  readonly detail: string;
  constructor(code: 'network_mismatch' | 'bad_response' | 'bad_config', detail: string) {
    super(`testnet4 probe: ${code}: ${detail}`);
    this.name = 'Testnet4ProbeError';
    this.code = code;
    this.detail = detail;
  }
}

export interface ProbeConfig {
  /** Esplora base WITHOUT trailing slash, e.g. https://mempool.space/testnet4/api */
  readonly esploraBase: string;
  /** Minimum confirmations for `confirmed` (owner call 2: 1 on testnet4). */
  readonly minConfirmations: number;
  /** Expected genesis hash - pins the chain (§2). */
  readonly genesisHash: string;
  /** Injected fetch so tests never hit the network and callers can proxy. */
  readonly fetchImpl: typeof fetch;
}

export const DEFAULT_PROBE_CONFIG: ProbeConfig = {
  esploraBase: TESTNET4_ESPLORA_BASE,
  minConfirmations: 1, // owner call 2 (§7) - mainnet parity MUST raise + re-review
  genesisHash: BTC_TESTNET4_GENESIS_HASH,
  fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
};

export type ProbeStatus =
  | 'confirmed'        // ≥ minConfirmations on the genesis-pinned chain
  | 'pending'          // seen in mempool / < minConfirmations
  | 'not_found'        // the API knows the chain but not this txid
  | 'unavailable';     // probe could not complete - NO claim either way

/** The evidence record every probe result carries (design §2). */
export interface ConfirmationEvidence {
  readonly rail: 'btc-testnet4';
  readonly txid: string;
  readonly status: ProbeStatus;
  /** Confirmations as reported by the API (0 for mempool/unavailable). */
  readonly confirmations: number;
  /** Block the tx was included in, when known - reorg re-verification anchor. */
  readonly blockHash?: string;
  readonly blockHeight?: number;
  /** Observed tip at probe time (reorg detection for later re-probes). */
  readonly observedTipHeight?: number;
  /** The genesis hash observed by THIS probe - must equal the constant. */
  readonly genesisHashObserved: string;
  /** Exact query URL for audit replay. */
  readonly queryUrl: string;
  /** Injected observation time (unix seconds) - no wall-clock reads here. */
  readonly observedAtSeconds: number;
  /** Honest failure detail when status === 'unavailable'. */
  readonly unavailableReason?: string;
}

interface EsploraTxShape {
  status?: {
    confirmed?: boolean;
    block_height?: number;
    block_hash?: string;
  };
  [k: string]: unknown;
}

/** Fetch the block hash at height 0 and pin it against the constant. */
async function assertGenesisPin(cfg: ProbeConfig): Promise<string> {
  const url = `${cfg.esploraBase}/block-height/0`;
  let res: Response;
  try {
    res = await cfg.fetchImpl(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    throw new Testnet4ProbeError('bad_response', `genesis probe fetch failed: ${reason(e)}`);
  }
  if (!res.ok) {
    throw new Testnet4ProbeError('bad_response', `genesis probe HTTP ${res.status}`);
  }
  const body = await res.text();
  const hash = body.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Testnet4ProbeError('bad_response', `genesis probe returned non-hash body: ${truncate(body)}`);
  }
  if (hash !== cfg.genesisHash) {
    throw new Testnet4ProbeError(
      'network_mismatch',
      `block 0 is ${hash}, expected the testnet4 genesis ${cfg.genesisHash} - this is NOT the pinned chain`,
    );
  }
  return hash;
}

/**
 * Probe a deposit txid for confirmations. Fail-closed: any transport,
 * HTTP, or shape failure yields `unavailable` (never `pending`, never a
 * silent swallow - the reason is recorded). A network whose genesis does
 * not match throws typed `network_mismatch` - the result must not be
 * interpretable as evidence from the wrong chain.
 */
export async function probeConfirmation(
  txid: string,
  cfg: ProbeConfig = DEFAULT_PROBE_CONFIG,
  nowSeconds: number,
): Promise<ConfirmationEvidence> {
  const validTxid = validateTestnet4Txid(txid);
  if (!Number.isInteger(cfg.minConfirmations) || cfg.minConfirmations < 1) {
    throw new Testnet4ProbeError('bad_config', `minConfirmations must be an integer ≥ 1, got ${cfg.minConfirmations}`);
  }
  const txUrl = `${cfg.esploraBase}/tx/${validTxid}`;

  // Chain pin FIRST: no tx evidence is meaningful from an unpinned chain.
  let genesisHashObserved: string;
  try {
    genesisHashObserved = await assertGenesisPin(cfg);
  } catch (e) {
    if (e instanceof Testnet4ProbeError && e.code === 'network_mismatch') throw e;
    return unavailable(validTxid, txUrl, nowSeconds, `genesis pin: ${reason(e)}`);
  }

  let res: Response;
  try {
    res = await cfg.fetchImpl(txUrl, { headers: { accept: 'application/json' } });
  } catch (e) {
    return unavailable(validTxid, txUrl, nowSeconds, `tx fetch failed: ${reason(e)}`);
  }

  if (res.status === 400 || res.status === 404) {
    // Esplora's documented "no such tx" answers - the API is healthy and
    // the tx is simply absent (mempool prunes / never saw it).
    return {
      rail: 'btc-testnet4',
      txid: validTxid,
      status: 'not_found',
      confirmations: 0,
      genesisHashObserved,
      queryUrl: txUrl,
      observedAtSeconds: nowSeconds,
    };
  }
  if (!res.ok) {
    return unavailable(validTxid, txUrl, nowSeconds, `tx probe HTTP ${res.status}`);
  }

  let tx: EsploraTxShape;
  try {
    tx = (await res.json()) as EsploraTxShape;
  } catch (e) {
    return unavailable(validTxid, txUrl, nowSeconds, `tx body was not JSON: ${reason(e)}`);
  }

  const st = tx.status ?? {};
  if (!st.confirmed) {
    return {
      rail: 'btc-testnet4',
      txid: validTxid,
      status: 'pending',
      confirmations: 0,
      genesisHashObserved,
      queryUrl: txUrl,
      observedAtSeconds: nowSeconds,
    };
  }

  const blockHeight = st.block_height;
  const blockHash = st.block_hash;
  if (typeof blockHeight !== 'number' || !Number.isInteger(blockHeight) || blockHeight < 0) {
    return unavailable(validTxid, txUrl, nowSeconds, `confirmed tx reported bad block_height: ${String(blockHeight)}`);
  }
  if (typeof blockHash !== 'string' || !/^[0-9a-f]{64}$/.test(blockHash)) {
    return unavailable(validTxid, txUrl, nowSeconds, `confirmed tx reported bad block_hash: ${truncate(String(blockHash))}`);
  }

  // Confirmations = tip − height + 1. Fetch the tip; failure → unavailable
  // (we could lower-bound from the block height alone, but an honest count
  // needs the tip, and §3.3 says honest states over convenient ones).
  let tip: number;
  try {
    tip = await fetchTipHeight(cfg);
  } catch (e) {
    return unavailable(validTxid, txUrl, nowSeconds, `tip probe failed: ${reason(e)}`);
  }
  if (tip < blockHeight) {
    // Tip BELOW the inclusion height = reorg in progress; report honestly.
    return unavailable(validTxid, txUrl, nowSeconds, `tip ${tip} < inclusion height ${blockHeight} (reorg in flight?)`);
  }
  const confirmations = tip - blockHeight + 1;

  return {
    rail: 'btc-testnet4',
    txid: validTxid,
    status: confirmations >= cfg.minConfirmations ? 'confirmed' : 'pending',
    confirmations,
    blockHash,
    blockHeight,
    observedTipHeight: tip,
    genesisHashObserved,
    queryUrl: txUrl,
    observedAtSeconds: nowSeconds,
  };
}

async function fetchTipHeight(cfg: ProbeConfig): Promise<number> {
  const res = await cfg.fetchImpl(`${cfg.esploraBase}/blocks/tip/height`, { headers: { accept: 'text/plain' } });
  if (!res.ok) throw new Testnet4ProbeError('bad_response', `tip probe HTTP ${res.status}`);
  const body = (await res.text()).trim();
  if (!/^\d+$/.test(body)) throw new Testnet4ProbeError('bad_response', `tip probe returned non-numeric body: ${truncate(body)}`);
  return parseInt(body, 10);
}

function unavailable(txid: string, url: string, nowSeconds: number, why: string): ConfirmationEvidence {
  return {
    rail: 'btc-testnet4',
    txid,
    status: 'unavailable',
    confirmations: 0,
    genesisHashObserved: BTC_TESTNET4_GENESIS_HASH,
    queryUrl: url,
    observedAtSeconds: nowSeconds,
    unavailableReason: why,
  };
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function truncate(s: string): string {
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

// ── State transition applied to a pending deposit ────────────────────────────

/**
 * Fold a probe result into a pending deposit's status. Pure. The rule set:
 *   - `confirmed` → 'confirmed' (amount match is the CALLER's ledger check;
 *     the probe proves chain inclusion, not pledge bookkeeping)
 *   - `pending` / `not_found` → stays 'broadcast'
 *   - `unavailable` → stays 'broadcast' (no claim either way - §3.3)
 * A mismatched txid never folds (typed error) - evidence must match the
 * registered deposit.
 */
export function applyProbeToDeposit(
  depositTxid: string,
  evidence: ConfirmationEvidence,
): 'confirmed' | 'broadcast' {
  if (evidence.txid !== depositTxid) {
    throw new Testnet4ProbeError('bad_response', `evidence txid ${evidence.txid} does not match deposit ${depositTxid}`);
  }
  return evidence.status === 'confirmed' ? 'confirmed' : 'broadcast';
}
