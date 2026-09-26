/**
 * Liquid-testnet rail step 2 - Elements Esplora confirmation probe
 * (sibling of src/lib/testnet4Probe.ts; docs/TESTNET4-RAIL-DESIGN.md §6
 * step 3 pattern applied to the Elements sidechain).
 *
 * Reads ONLY. Talks to the public liquid-testnet Esplora
 * (blockstream.info by default - owner call 4 twin; a sovereign Elements
 * node is a base-URL swap behind the same interface). Honesty rules are
 * the Testnet4 probe's, with ONE Elements-specific addition:
 *
 *   - Chain identity: every probe pins the liquid-testnet GENESIS hash -
 *     the block at height 0 returned by THIS API must equal the constant.
 *     Mismatch fails typed `network_mismatch` (wrong chain / lying proxy).
 *   - ASSET identity (the Elements rule bitcoin never needs): a confirmed
 *     tx must actually move the NATIVE LBTC asset (LIQUID_TESTNET_NATIVE_
 *     ASSET_ID). A tx whose outputs are all OTHER assets (issuances,
 *     USDT-class tokens, garbage) is `wrong_asset` - on Liquid a txid
 *     alone does NOT name what moved. Recorded honestly; not confirmed.
 *   - Network/transport/shape failure → `unavailable` with the reason.
 *     NEVER `confirmed` by absence of failure.
 *   - Reorg-aware: confirmations from the tip delta; block hash echoed
 *     for re-verification. Liquid has no PoW reorg economics (federated
 *     blocks every ~60s per CLiquidTestNetParams) but the same honest
 *     tip < height check is kept - the probe never claims what it
 *     cannot see.
 *   - Injected clock (`nowSeconds`) and injected `fetchImpl` - no wall
 *     clock, no network in tests.
 *
 * Confidential-transfer note (design §6 step 7): confidential outputs
 * hide value/asset, so a tx mixing confidential outputs CANNOT be
 * asset-verified here. Unblinded outputs that name the native asset
 * pass; all-confidential is `unavailable` (honest: cannot verify), never
 * confirmed.
 */
import {
  LIQUID_TESTNET_GENESIS_HASH,
  LIQUID_TESTNET_NATIVE_ASSET_ID,
  LIQUID_TESTNET_ESPLORA_BASE,
  validateLiquidTestnetTxid,
} from './liquidTestnetRail';

export class LiquidTestnetProbeError extends Error {
  readonly code: 'network_mismatch' | 'bad_response' | 'bad_config';
  readonly detail: string;
  constructor(code: 'network_mismatch' | 'bad_response' | 'bad_config', detail: string) {
    super(`liquid-testnet probe: ${code}: ${detail}`);
    this.name = 'LiquidTestnetProbeError';
    this.code = code;
    this.detail = detail;
  }
}

export interface LiquidProbeConfig {
  /** Esplora base WITHOUT trailing slash, e.g. https://blockstream.info/liquidtestnet/api */
  readonly esploraBase: string;
  /** Minimum confirmations for `confirmed` (≥1; 1 matches the owner's testnet4 call). */
  readonly minConfirmations: number;
  /** Expected genesis hash - pins the chain (§2). */
  readonly genesisHash: string;
  /** The asset a contribution must actually move (native LBTC on this rail). */
  readonly nativeAssetId: string;
  /** Injected fetch so tests never hit the network and callers can proxy. */
  readonly fetchImpl: typeof fetch;
}

export const DEFAULT_LIQUID_PROBE_CONFIG: LiquidProbeConfig = {
  esploraBase: LIQUID_TESTNET_ESPLORA_BASE,
  minConfirmations: 1,
  genesisHash: LIQUID_TESTNET_GENESIS_HASH,
  nativeAssetId: LIQUID_TESTNET_NATIVE_ASSET_ID,
  fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
};

export type LiquidProbeStatus =
  | 'confirmed'        // ≥ minConfirmations on the genesis-pinned chain, native asset seen unblinded
  | 'pending'          // seen in mempool / < minConfirmations
  | 'not_found'        // the API knows the chain but not this txid
  | 'wrong_asset'      // confirmed, but moves OTHER assets only - recorded, never confirmed
  | 'unavailable';     // probe could not complete / confidential-only outputs - NO claim

/** The evidence record every probe result carries (design §2 pattern). */
export interface LiquidConfirmationEvidence {
  readonly rail: 'liquid-testnet';
  readonly txid: string;
  readonly status: LiquidProbeStatus;
  /** Confirmations as reported by the API (0 unless confirmed/pending on-chain). */
  readonly confirmations: number;
  /** Block the tx was included in, when known - reorg re-verification anchor. */
  readonly blockHash?: string;
  readonly blockHeight?: number;
  /** Observed tip at probe time. */
  readonly observedTipHeight?: number;
  /** The genesis hash observed by THIS probe - must equal the constant. */
  readonly genesisHashObserved: string;
  /** Asset ids seen in the tx's unblinded outputs (audit evidence). */
  readonly assetsSeen: readonly string[];
  /** True when every output was confidential - value/asset unverifiable. */
  readonly confidentialOnly: boolean;
  /** Exact query URL for audit replay. */
  readonly queryUrl: string;
  /** Injected observation time (unix seconds) - no wall-clock reads here. */
  readonly observedAtSeconds: number;
  /** Honest failure detail when status === 'unavailable'. */
  readonly unavailableReason?: string;
}

interface EsploraLiquidTxShape {
  status?: {
    confirmed?: boolean;
    block_height?: number;
    block_hash?: string;
  };
  vout?: Array<{
    asset?: unknown;
    value?: unknown;
  }>;
  [k: string]: unknown;
}

const NULL_ASSET = '0'.repeat(64);

/** Fetch the block hash at height 0 and pin it against the constant. */
async function assertGenesisPin(cfg: LiquidProbeConfig): Promise<string> {
  const url = `${cfg.esploraBase}/block-height/0`;
  let res: Response;
  try {
    res = await cfg.fetchImpl(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    throw new LiquidTestnetProbeError('bad_response', `genesis probe fetch failed: ${reason(e)}`);
  }
  if (!res.ok) {
    throw new LiquidTestnetProbeError('bad_response', `genesis probe HTTP ${res.status}`);
  }
  const body = await res.text();
  const hash = body.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new LiquidTestnetProbeError('bad_response', `genesis probe returned non-hash body: ${truncate(body)}`);
  }
  if (hash !== cfg.genesisHash) {
    throw new LiquidTestnetProbeError(
      'network_mismatch',
      `block 0 is ${hash}, expected the liquid-testnet genesis ${cfg.genesisHash} - this is NOT the pinned chain`,
    );
  }
  return hash;
}

/**
 * Probe a liquid-testnet txid for confirmations AND native-asset movement.
 * Fail-closed: transport/HTTP/shape failures yield `unavailable`; a
 * genesis mismatch throws typed `network_mismatch`; a confirmed tx that
 * moves no unblinded native asset is `wrong_asset` (recorded, never
 * confirmed); all-confidential outputs are `unavailable` (honest: the
 * blinding hides what we would need to see).
 */
export async function probeLiquidConfirmation(
  txid: string,
  cfg: LiquidProbeConfig = DEFAULT_LIQUID_PROBE_CONFIG,
  nowSeconds: number,
): Promise<LiquidConfirmationEvidence> {
  const validTxid = validateLiquidTestnetTxid(txid);
  if (!Number.isInteger(cfg.minConfirmations) || cfg.minConfirmations < 1) {
    throw new LiquidTestnetProbeError('bad_config', `minConfirmations must be an integer ≥ 1, got ${cfg.minConfirmations}`);
  }
  if (!/^[0-9a-f]{64}$/.test(cfg.nativeAssetId)) {
    throw new LiquidTestnetProbeError('bad_config', `nativeAssetId must be 64-hex, got ${truncate(cfg.nativeAssetId)}`);
  }
  const txUrl = `${cfg.esploraBase}/tx/${validTxid}`;

  // Chain pin FIRST: no tx evidence is meaningful from an unpinned chain.
  let genesisHashObserved: string;
  try {
    genesisHashObserved = await assertGenesisPin(cfg);
  } catch (e) {
    if (e instanceof LiquidTestnetProbeError && e.code === 'network_mismatch') throw e;
    return unavailable(validTxid, txUrl, nowSeconds, `genesis pin: ${reason(e)}`, cfg.nativeAssetId);
  }

  let res: Response;
  try {
    res = await cfg.fetchImpl(txUrl, { headers: { accept: 'application/json' } });
  } catch (e) {
    return unavailable(validTxid, txUrl, nowSeconds, `tx fetch failed: ${reason(e)}`, cfg.nativeAssetId);
  }

  if (res.status === 400 || res.status === 404) {
    // Esplora's documented "no such tx" answers - API healthy, tx absent.
    return {
      rail: 'liquid-testnet',
      txid: validTxid,
      status: 'not_found',
      confirmations: 0,
      genesisHashObserved,
      assetsSeen: [],
      confidentialOnly: false,
      queryUrl: txUrl,
      observedAtSeconds: nowSeconds,
    };
  }
  if (!res.ok) {
    return unavailable(validTxid, txUrl, nowSeconds, `tx probe HTTP ${res.status}`, cfg.nativeAssetId);
  }

  let tx: EsploraLiquidTxShape;
  try {
    tx = (await res.json()) as EsploraLiquidTxShape;
  } catch (e) {
    return unavailable(validTxid, txUrl, nowSeconds, `tx body was not JSON: ${reason(e)}`, cfg.nativeAssetId);
  }

  const st = tx.status ?? {};
  if (!st.confirmed) {
    return {
      rail: 'liquid-testnet',
      txid: validTxid,
      status: 'pending',
      confirmations: 0,
      genesisHashObserved,
      assetsSeen: assetsSeenOf(tx),
      confidentialOnly: confidentialOnlyOf(tx),
      queryUrl: txUrl,
      observedAtSeconds: nowSeconds,
    };
  }

  const blockHeight = st.block_height;
  const blockHash = st.block_hash;
  if (typeof blockHeight !== 'number' || !Number.isInteger(blockHeight) || blockHeight < 0) {
    return unavailable(validTxid, txUrl, nowSeconds, `confirmed tx reported bad block_height: ${String(blockHeight)}`, cfg.nativeAssetId);
  }
  if (typeof blockHash !== 'string' || !/^[0-9a-f]{64}$/.test(blockHash)) {
    return unavailable(validTxid, txUrl, nowSeconds, `confirmed tx reported bad block_hash: ${truncate(String(blockHash))}`, cfg.nativeAssetId);
  }

  let tip: number;
  try {
    tip = await fetchTipHeight(cfg);
  } catch (e) {
    return unavailable(validTxid, txUrl, nowSeconds, `tip probe failed: ${reason(e)}`, cfg.nativeAssetId);
  }
  if (tip < blockHeight) {
    return unavailable(validTxid, txUrl, nowSeconds, `tip ${tip} < inclusion height ${blockHeight} (reorg in flight?)`, cfg.nativeAssetId);
  }
  const confirmations = tip - blockHeight + 1;

  // Elements asset check: a confirmed tx "counts" only if it moves the
  // native asset in an UNBLINDED output. Confidential outputs hide the
  // asset id - all-confidential is honestly unverifiable, not confirmed.
  const seen = assetsSeenOf(tx);
  const confOnly = confidentialOnlyOf(tx);
  if (seen.length === 0 && confOnly) {
    return unavailable(
      validTxid, txUrl, nowSeconds,
      'all outputs confidential - asset/value unverifiable without blinding support (design §6 step 7)',
      cfg.nativeAssetId,
      { blockHash, blockHeight, tip, assetsSeen: seen, confidentialOnly: true },
    );
  }
  const movesNative = seen.includes(cfg.nativeAssetId);
  if (!movesNative) {
    return {
      rail: 'liquid-testnet',
      txid: validTxid,
      status: 'wrong_asset',
      confirmations,
      blockHash,
      blockHeight,
      observedTipHeight: tip,
      genesisHashObserved,
      assetsSeen: seen,
      confidentialOnly: confOnly,
      queryUrl: txUrl,
      observedAtSeconds: nowSeconds,
    };
  }

  return {
    rail: 'liquid-testnet',
    txid: validTxid,
    status: confirmations >= cfg.minConfirmations ? 'confirmed' : 'pending',
    confirmations,
    blockHash,
    blockHeight,
    observedTipHeight: tip,
    genesisHashObserved,
    assetsSeen: seen,
    confidentialOnly: confOnly,
    queryUrl: txUrl,
    observedAtSeconds: nowSeconds,
  };
}

function assetsSeenOf(tx: EsploraLiquidTxShape): string[] {
  const out: string[] = [];
  for (const v of tx.vout ?? []) {
    if (typeof v.asset === 'string' && /^[0-9a-f]{64}$/.test(v.asset) && v.asset !== NULL_ASSET && !out.includes(v.asset)) {
      out.push(v.asset);
    }
  }
  return out;
}

function confidentialOnlyOf(tx: EsploraLiquidTxShape): boolean {
  const vouts = tx.vout ?? [];
  if (vouts.length === 0) return false;
  // An output is unblinded iff it carries a well-formed asset id we can read.
  return vouts.every((v) => !(typeof v.asset === 'string' && /^[0-9a-f]{64}$/.test(v.asset) && v.asset !== NULL_ASSET));
}

async function fetchTipHeight(cfg: LiquidProbeConfig): Promise<number> {
  const res = await cfg.fetchImpl(`${cfg.esploraBase}/blocks/tip/height`, { headers: { accept: 'text/plain' } });
  if (!res.ok) throw new LiquidTestnetProbeError('bad_response', `tip probe HTTP ${res.status}`);
  const body = (await res.text()).trim();
  if (!/^\d+$/.test(body)) throw new LiquidTestnetProbeError('bad_response', `tip probe returned non-numeric body: ${truncate(body)}`);
  return parseInt(body, 10);
}

function unavailable(
  txid: string,
  url: string,
  nowSeconds: number,
  why: string,
  nativeAssetId: string,
  extra: { blockHash?: string; blockHeight?: number; tip?: number; assetsSeen?: readonly string[]; confidentialOnly?: boolean } = {},
): LiquidConfirmationEvidence {
  return {
    rail: 'liquid-testnet',
    txid,
    status: 'unavailable',
    confirmations: 0,
    ...(extra.blockHash !== undefined ? { blockHash: extra.blockHash } : {}),
    ...(extra.blockHeight !== undefined ? { blockHeight: extra.blockHeight } : {}),
    ...(extra.tip !== undefined ? { observedTipHeight: extra.tip } : {}),
    genesisHashObserved: LIQUID_TESTNET_GENESIS_HASH,
    assetsSeen: extra.assetsSeen ?? [],
    confidentialOnly: extra.confidentialOnly ?? false,
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
 * Fold a probe result into a pending deposit's status. Pure. The rules:
 *   - `confirmed` → 'confirmed' (amount/asset bookkeeping is the CALLER's
 *     ledger check; the probe proves chain inclusion + native-asset visibility)
 *   - `pending` / `not_found` / `wrong_asset` → stays 'broadcast'
 *     (wrong_asset is honest evidence of activity - just not OUR asset)
 *   - `unavailable` → stays 'broadcast' (no claim either way)
 * A mismatched txid never folds (typed error).
 */
export function applyLiquidProbeToDeposit(
  depositTxid: string,
  evidence: LiquidConfirmationEvidence,
): 'confirmed' | 'broadcast' {
  if (evidence.txid !== depositTxid) {
    throw new LiquidTestnetProbeError('bad_response', `evidence txid ${evidence.txid} does not match deposit ${depositTxid}`);
  }
  return evidence.status === 'confirmed' ? 'confirmed' : 'broadcast';
}
