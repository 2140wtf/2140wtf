import { describe, expect, it } from 'vitest';
import {
  PendingSpentTracker,
  balanceBreakdown,
  broadcastTx,
  feeForVsize,
  feeRateFor,
  fetchRecommendedFees,
  mapBroadcastError,
  selectCoins,
  type Utxo,
} from './angorPatterns';

// ── fixtures ──────────────────────────────────────────────────────────────
const utxo = (txid: string, vout: number, value: number, height: number | null, confirmed = true): Utxo => ({
  txid, vout, value, status: { confirmed, block_height: height },
});

// ── 1. fee estimation ─────────────────────────────────────────────────────
describe('fetchRecommendedFees', () => {
  it('parses the mempool.space recommended-fees shape', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ fastestFee: 12, halfHourFee: 8, hourFee: 5, economyFee: 3 }), { status: 200 })) as unknown as typeof fetch;
    const fees = await fetchRecommendedFees(fetchFn);
    expect(fees).not.toBeNull();
    expect(fees!.fastest).toBe(12);
    expect(fees!.economy).toBe(3);
  });
  it('returns null on HTTP failure (caller falls back to the floor)', async () => {
    const fetchFn = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    expect(await fetchRecommendedFees(fetchFn)).toBeNull();
  });
  it('feeRateFor: floor wins when fees are null; economy clamps ≥ floor', () => {
    expect(feeRateFor('hour', null, 2)).toBe(2);
    expect(feeRateFor('economy', { fastest: 10, halfHour: 8, hour: 5, economy: 0.5, fetchedAt: 0 } as never, 1)).toBe(1);
    expect(feeRateFor('fastest', { fastest: 10, halfHour: 8, hour: 5, economy: 3, fetchedAt: 0 }, 1)).toBe(10);
  });
  it('feeForVsize rounds up', () => {
    expect(feeForVsize(10.5, 3)).toBe(32); // 31.5 → 32
  });
});

// ── 2. coin selection (Angor ordering) ────────────────────────────────────
describe('selectCoins', () => {
  it('accumulates MULTIPLE utxos until covered (single-largest-UTXO failure fixed)', () => {
    const pool = [utxo('a', 0, 30_000, 800), utxo('b', 0, 40_000, 801), utxo('c', 0, 35_000, 802)];
    const r = selectCoins(pool, 90_000, 1_000);
    expect(r.error).toBeNull();
    expect(r.selected.map((u) => u.txid).sort()).toEqual(['a', 'b', 'c']);
    expect(r.inputTotal).toBe(105_000);
    expect(r.change).toBe(14_000);
  });
  it('orders by block height then value (Angor AccountInfo ordering)', () => {
    const pool = [utxo('new', 0, 10_000, 900), utxo('old-small', 0, 5_000, 800), utxo('old-big', 0, 20_000, 800)];
    const r = selectCoins(pool, 30_000, 500);
    expect(r.selected[0].txid).toBe('old-small'); // height 800, value 5k first
    expect(r.selected[1].txid).toBe('old-big');
  });
  it('prefers confirmed; unconfirmed only when allowed', () => {
    const pool = [utxo('unconf', 0, 100_000, null, false)];
    expect(selectCoins(pool, 10_000, 500).error).toMatch(/insufficient/);
    const ok = selectCoins(pool, 10_000, 500, { allowUnconfirmed: true });
    expect(ok.error).toBeNull();
    expect(ok.selected[0].txid).toBe('unconf');
  });
  it('never selects pendingSpent UTXOs', () => {
    const pool = [utxo('r', 0, 100_000, 800), utxo('f', 0, 100_000, 801)];
    const r = selectCoins(pool, 50_000, 500, { pendingSpent: new Set(['r:0']) });
    expect(r.selected.map((u) => u.txid)).toEqual(['f']);
  });
  it('trims the last input when the rest still cover the need (dust-safe)', () => {
    const pool = [utxo('a', 0, 60_000, 800), utxo('b', 0, 20_000, 801)];
    // 60k alone covers 50.5k need with spendable change → b unnecessary.
    const r = selectCoins(pool, 50_000, 500);
    expect(r.selected.map((u) => u.txid)).toEqual(['a']);
    expect(r.change).toBe(9_500);
  });
  it('refuses sub-dust change instead of silently donating to miners', () => {
    const pool = [utxo('a', 0, 50_700, 800)];
    const r = selectCoins(pool, 50_000, 500); // change = 200 < 546
    expect(r.change).toBe(200);
    expect(r.dustChange).toBe(true);
  });
  it('fails with a clear message when the pool cannot cover the target', () => {
    const r = selectCoins([utxo('a', 0, 10_000, 800)], 90_000, 1_000);
    expect(r.error).toMatch(/insufficient funds: need 91,?000/);
    expect(r.selected).toHaveLength(0);
  });
});

// ── 4. UTXO lifecycle ─────────────────────────────────────────────────────
describe('PendingSpentTracker + balanceBreakdown', () => {
  it('marks, reports and releases reservations; TTL evicts stale ones', () => {
    const t = new PendingSpentTracker(60);
    const now = Math.floor(Date.now() / 1000);
    t.mark('a:0', 'tx1', now); // fresh - stays
    expect(t.reservedSet().has('a:0')).toBe(true);
    t.release('a:0');
    expect(t.reservedSet().has('a:0')).toBe(false);
    // TTL eviction: ancient mark is evicted, fresh mark survives.
    t.mark('b:0', 'tx2', now - 3600);
    t.mark('c:0', 'tx3', now);
    const set = t.reservedSet();
    expect(set.has('b:0')).toBe(false);
    expect(set.has('c:0')).toBe(true);
  });
  it('balanceBreakdown splits confirmed/unconfirmed/reserved honestly', () => {
    const reserved = new Set(['r:0']);
    const b = balanceBreakdown(
      [utxo('c', 0, 50_000, 800), utxo('u', 0, 7_000, null, false), utxo('r', 0, 12_000, 801)],
      reserved,
    );
    expect(b.confirmedAvailable).toBe(50_000);
    expect(b.unconfirmed).toBe(7_000);
    expect(b.reserved).toBe(12_000);
  });
  it('PendingSpentTracker.overlaps detects re-selection of reserved inputs', () => {
    expect(PendingSpentTracker.overlaps([utxo('a', 0, 1, 1)], new Set(['a:0']))).toBe(true);
    expect(PendingSpentTracker.overlaps([utxo('a', 1, 1, 1)], new Set(['a:0']))).toBe(false);
  });
});

// ── 5. broadcast error mapping ────────────────────────────────────────────
describe('mapBroadcastError / broadcastTx', () => {
  it('maps txn-already-in-mempool to a friendly already-done outcome', () => {
    const o = mapBroadcastError(400, 'sendrawtransaction RPC error: {"code":-27,"message":"txn-already-in-mempool"}');
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.code).toBe('already-in-mempool');
  });
  it('maps missing-inputs with the refresh-and-retry guidance', () => {
    const o = mapBroadcastError(400, 'missing-inputs');
    if (!o.ok) {
      expect(o.code).toBe('missing-inputs');
      expect(o.message).toMatch(/refresh UTXOs/);
    } else throw new Error('expected failure');
  });
  it('maps min-relay-fee violations to fee-too-low', () => {
    const o = mapBroadcastError(400, 'min relay fee not met');
    if (!o.ok) expect(o.code).toBe('fee-too-low'); else throw new Error('expected failure');
  });
  it('broadcastTx returns the txid on 200 (plain text body)', async () => {
    const txid = 'ab'.repeat(32);
    const fetchFn = (async () => new Response(`  ${txid}\n`, { status: 200 })) as unknown as typeof fetch;
    const o = await broadcastTx(fetchFn, 'rawhex');
    expect(o).toEqual({ ok: true, txid });
  });
  it('broadcastTx refuses a 200 body that is not a transaction id (fail closed)', async () => {
    const fetchFn = (async () => new Response('<html>gateway error</html>', { status: 200 })) as unknown as typeof fetch;
    const o = await broadcastTx(fetchFn, 'rawhex');
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.message).toMatch(/transaction id/i);
  });
  it('broadcastTx maps a 400 body through mapBroadcastError', async () => {
    const fetchFn = (async () => new Response('txn-already-known', { status: 400 })) as unknown as typeof fetch;
    const o = await broadcastTx(fetchFn, 'rawhex');
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.code).toBe('already-known');
  });
});
