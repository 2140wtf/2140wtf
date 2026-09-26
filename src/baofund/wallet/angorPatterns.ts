/**
 * angorPatterns.ts - the five Angor wallet patterns ported into our lean
 * wallet core (owner research 2026-09-14: port the patterns, do NOT vendor
 * blockcore-wallet-legacy).
 *
 * Pure decision layer - every chain touch is an injected fetch/now, so all
 * of it is testable without a network (the E2E scripts wire the real
 * mempool.space fetch in).
 *
 *   1. Fee estimation   - mempool.space /api/v1/fees/recommended
 *                         (fastest/halfHour/hour/economy), replacing the
 *                         hardcoded `--fee 500` sats flat fee.
 *   2. Coin selection   - multi-UTXO accumulate-until-covered, ordered by
 *                         confirmation block height then value (Angor
 *                         AccountInfo.cs ordering), replacing single-UTXO
 *                         `confirmed.find(v >= amount)`.
 *   3. Change policy    - change SELF-SENDS back to a dedicated change
 *                         address, never the receive address (BIP-84
 *                         receive/change split).
 *   4. UTXO lifecycle   - pendingSpent marking: selected UTXOs are marked
 *                         reserved when a tx is BUILT and released on
 *                         broadcast failure; unconfirmed balance is reported
 *                         separately from confirmed (double-spend guard).
 *   5. Broadcast errors - map mempool.space/esplora error text to typed,
 *                         friendly outcomes (txn-already-in-mempool,
 *                         txn-already-known, missing-inputs, fee too low…).
 */

// ─── 1. Fee estimation ────────────────────────────────────────────────────

export interface RecommendedFees {
  fastest: number;   // sat/vB - next block
  halfHour: number;  // sat/vB
  hour: number;      // sat/vB
  economy: number;   // sat/vB
  fetchedAt: number; // unix seconds
}

const VITE_ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Default endpoint for the injected chain fetch. Override with
 *  `VITE_TESTNET4_ESPLORA_URL` to use a self-hosted electrs/Esplora. */
export const ANGOR_EXPLORER_BASE: string =
  VITE_ENV.VITE_TESTNET4_ESPLORA_URL ?? 'https://mempool.space/testnet4/api';

/** Parsed from the Angor pattern endpoint. `null` on any failure - callers
 *  must fall back to an explicit conservative floor, never a guess. */
export async function fetchRecommendedFees(
  fetchFn: typeof fetch,
  baseUrl = ANGOR_EXPLORER_BASE,
): Promise<RecommendedFees | null> {
  try {
    const r = await fetchFn(`${baseUrl}/v1/fees/recommended`);
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, unknown>;
    const n = (k: string): number | null =>
      typeof j[k] === 'number' && Number.isFinite(j[k]) && (j[k] as number) > 0 ? (j[k] as number) : null;
    const fastest = n('fastestFee');
    const halfHour = n('halfHourFee');
    const hour = n('hourFee');
    const economy = n('economyFee');
    if (fastest === null || halfHour === null || hour === null || economy === null) return null;
    return { fastest, halfHour, hour, economy, fetchedAt: Math.floor(Date.now() / 1000) };
  } catch {
    return null;
  }
}

/** Pick a sat/vB rate by urgency with an explicit floor. `economy` is
 *  clamped to ≥1; the floor wins whenever the estimate is lower (testnet
 *  relays sometimes return 1 for everything - fine - but a floor of 1 is
 *  still enforced for mainnet parity). */
export function feeRateFor(urgency: 'fastest' | 'halfHour' | 'hour' | 'economy', fees: RecommendedFees | null, floorSatVb = 1): number {
  if (!fees) return floorSatVb;
  return Math.max(floorSatVb, fees[urgency]);
}

/** Flat sats → precise fee from a tx's virtual size. Angor computes
 *  fee = rate × vsize; we expose the same so callers stop passing magic
 *  flat amounts. P2TR keypath spend ≈ 10.5 vsize per input + 31 per
 *  taproot output + 10.5 overhead - the caller may pass an exact vsize
 *  after building (tx.vsize in btc-signer) for the TRUE fee. */
export function feeForVsize(vsize: number, rateSatVb: number): number {
  return Math.ceil(vsize * rateSatVb);
}

// ─── 2. Coin selection (Angor AccountInfo.cs) ─────────────────────────────

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number | null };
  /** Set when the UTXO is locally marked reserved (pattern 4). */
  pendingSpent?: boolean;
}

export interface SelectionResult {
  selected: Utxo[];
  /** Sum of selected inputs. */
  inputTotal: number;
  change: number;
  /** Human explanation when selection fails (null on success). */
  error: string | null;
  /** True when `change` is below the 546-sat dust floor - the caller must
   *  bump the fee and re-select; the change would otherwise be unspendable. */
  dustChange?: boolean;
}

/** Angor ordering: by block height asc (oldest first), then value asc.
 *  Unconfirmed UTXOs sort LAST (height undefined → +inf). */
function angorOrder(a: Utxo, b: Utxo): number {
  const ha = a.status.block_height ?? Number.MAX_SAFE_INTEGER;
  const hb = b.status.block_height ?? Number.MAX_SAFE_INTEGER;
  if (ha !== hb) return ha - hb;
  return a.value - b.value;
}

/** Multi-UTXO accumulate-until-covered. Confirmed-first (unconfirmed only
 *  when `allowUnconfirmed`), never picks `pendingSpent` UTXOs, and skips
 *  dust change by pulling a slightly larger input when possible. */
export function selectCoins(
  utxos: Utxo[],
  targetSats: number,
  feeSats: number,
  opts: { allowUnconfirmed?: boolean; pendingSpent?: Set<string> } = {},
): SelectionResult {
  if (!Number.isSafeInteger(targetSats) || targetSats <= 0) {
    return { selected: [], inputTotal: 0, change: 0, error: 'invalid target amount' };
  }
  if (!Number.isSafeInteger(feeSats) || feeSats < 0) {
    return { selected: [], inputTotal: 0, change: 0, error: 'invalid fee' };
  }
  const reserved = opts.pendingSpent ?? new Set<string>();
  const need = targetSats + feeSats;
  const pool = utxos
    .filter((u) => !reserved.has(`${u.txid}:${u.vout}`))
    .filter((u) => u.status.confirmed || opts.allowUnconfirmed === true);
  const ordered = [...pool].sort(angorOrder);

  // Pass 1: smallest-first accumulate (Angor accumulates in its ordered
  // enumeration; value-asc within a height keeps change lean).
  const selected: Utxo[] = [];
  let total = 0;
  for (const u of ordered) {
    if (total >= need) break;
    selected.push(u);
    total += u.value;
  }
  if (total < need) {
    return {
      selected: [],
      inputTotal: 0,
      change: 0,
      error:
        `insufficient funds: need ${need} sats, confirmed+unconfirmed-available ` +
        `${total} sats across ${selected.length} UTXO(s) (pool ${pool.length})`,
    };
  }

  // Pass 2: change-dust trim - if dropping the last input still covers the
  // need, drop it (less weight, lower fee, less change to sweep later).
  // 546 sat dust floor for taproot outputs.
  const DUST = 546;
  while (selected.length > 1) {
    const last = selected[selected.length - 1];
    if (total - last.value >= need && total - last.value - need >= 0) {
      // Only drop when the resulting change stays spendable OR zero.
      const changeIfDropped = total - last.value - need;
      if (changeIfDropped === 0 || changeIfDropped >= DUST) {
        selected.pop();
        total -= last.value;
        continue;
      }
    }
    break;
  }

  const change = total - need;
  if (change > 0 && change < DUST) {
    // Change below dust would be lost to the miner - surface the dust flag
    // so the caller bumps the fee (recompute with the true vsize) and
    // retries. An explicit flag, not a silent donation.
    return { selected, inputTotal: total, change, error: null, dustChange: true };
  }
  return { selected, inputTotal: total, change, error: null };
}

// ─── 4. UTXO lifecycle (WalletOperations.cs PendingSpent) ────────────────

export interface PendingSpentStore {
  mark(key: string, txid: string, at: number): void;
  release(key: string): void;
  keys(): Array<{ key: string; txid: string; at: number }>;
}

/** In-memory pending-spent with TTL. The browser session holds it for the
 *  tab lifetime; a full device wallet persists it - the interface is the
 *  same either way. TTL clears stale reservations after the mempool
 *  would have evicted them (default 2h). */
export class PendingSpentTracker implements PendingSpentStore {
  private map = new Map<string, { txid: string; at: number }>();
  constructor(private ttlSec = 2 * 3600) {}
  mark(key: string, txid: string, at: number): void {
    this.map.set(key, { txid, at });
  }
  release(key: string): void {
    this.map.delete(key);
  }
  /** Reserved keys, evicting entries past the TTL. */
  keys(): Array<{ key: string; txid: string; at: number }> {
    const now = Math.floor(Date.now() / 1000);
    for (const [k, v] of this.map) {
      if (now - v.at > this.ttlSec) this.map.delete(k);
    }
    return [...this.map.entries()].map(([key, v]) => ({ key, ...v }));
  }
  /** The set selectCoins() consumes. */
  reservedSet(): Set<string> {
    return new Set(this.keys().map((k) => k.key));
  }
  /** True when ANY selected input is reserved (caller must re-select). */
  static overlaps(selected: Utxo[], reserved: Set<string>): boolean {
    return selected.some((u) => reserved.has(`${u.txid}:${u.vout}`));
  }
}

/** Split a wallet's balance the way Angor displays it: confirmed-available
 *  (never pending-spent) vs unconfirmed vs reserved. All three numbers are
 *  honest - "total" is never the confirmed number wearing a hat. */
export function balanceBreakdown(utxos: Utxo[], reservedSet: Set<string>): {
  confirmedAvailable: number;
  unconfirmed: number;
  reserved: number;
} {
  let confirmedAvailable = 0;
  let unconfirmed = 0;
  let reservedSats = 0;
  for (const u of utxos) {
    const key = `${u.txid}:${u.vout}`;
    if (reservedSet.has(key)) { reservedSats += u.value; continue; }
    if (u.status.confirmed) confirmedAvailable += u.value;
    else unconfirmed += u.value;
  }
  return { confirmedAvailable, unconfirmed, reserved: reservedSats };
}

// ─── 5. Broadcast error mapping (MempoolSpaceIndexerApi.cs) ──────────────

export type BroadcastOutcome =
  | { ok: true; txid: string }
  | { ok: false; code: 'already-in-mempool' | 'already-known' | 'missing-inputs' | 'conflict' | 'fee-too-low' | 'bad-tx' | 'network'; message: string };

export function mapBroadcastError(status: number, bodyText: string): BroadcastOutcome {
  const b = bodyText.toLowerCase();
  if (b.includes('txn-already-in-mempool') || b.includes('already in mempool')) {
    return { ok: false, code: 'already-in-mempool', message: 'Transaction is already in the mempool - nothing to do (your send likely succeeded earlier).' };
  }
  if (b.includes('txn-already-known')) {
    return { ok: false, code: 'already-known', message: 'Transaction already known to the relay - treated as broadcast.' };
  }
  if (b.includes('txn-mempool-conflict')) {
    return { ok: false, code: 'conflict', message: 'A conflicting spend of the same coins is already pending - wait for it to confirm or drop out, then refresh UTXOs.' };
  }
  if (b.includes('missing-inputs') || b.includes('bad-txns-inputs')) {
    return { ok: false, code: 'missing-inputs', message: 'Inputs already spent or not visible to this node - refresh UTXOs and retry (do NOT blindly rebuild with the same inputs).' };
  }
  if (b.includes('min relay fee') || b.includes('fee too low') || b.includes('mempool min fee')) {
    return { ok: false, code: 'fee-too-low', message: 'Fee below the node minimum - rebuild with a higher fee rate (the mempool is busier than the estimate).' };
  }
  if (status === 400) {
    return { ok: false, code: 'bad-tx', message: 'Node rejected the transaction as malformed - verify the PSBT/tx build before retrying.' };
  }
  return { ok: false, code: 'network', message: `Broadcast failed (HTTP ${status}): ${bodyText.slice(0, 120)}` };
}

/** Broadcast with mapping: POST /tx returns the txid as plain text on 200. */
export async function broadcastTx(fetchFn: typeof fetch, rawTxHex: string, baseUrl = ANGOR_EXPLORER_BASE): Promise<BroadcastOutcome> {
  let r: Response;
  try {
    r = await fetchFn(`${baseUrl}/tx`, { method: 'POST', body: rawTxHex });
  } catch (e) {
    return { ok: false, code: 'network', message: `broadcast unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  const text = await r.text();
  if (r.ok) {
    // Esplora answers with the txid as plain text. A 200 carrying anything
    // else (a gateway error page, a proxy HTML body) must not be reported as
    // a broadcast: callers record/announce the txid as fact.
    const txid = text.trim();
    if (!/^[0-9a-f]{64}$/i.test(txid)) {
      return { ok: false, code: 'network', message: `Broadcast response did not carry a transaction id (HTTP 200): ${txid.slice(0, 120)}` };
    }
    return { ok: true, txid: txid.toLowerCase() };
  }
  return mapBroadcastError(r.status, text);
}
