/**
 * railRefund - donor refund core fixtures (WS-3).
 *
 * Covers the obligations the scope names: deadline boundary ±1s, late filing,
 * the all-milestones batch, and a crash between broadcast and the completion
 * record. All chain I/O is injected, so these are deterministic and offline;
 * the live broadcast E2E remains an owner-run rail script.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryRefundJournal,
  executeRefund,
  refundTimeGate,
  type ChainView,
  type RefundExecuteDeps,
  type RefundStage,
} from './railRefund';

function stage(over: Partial<RefundStage> = {}): RefundStage {
  return {
    id: 'tx:0',
    rail: 'btc-testnet4',
    depositTxid: 'd'.repeat(64),
    vout: 0,
    amountSats: 50_000,
    scriptPubKeyHex: '00'.repeat(34),
    refundUnlock: 1000,
    refundUnlockDomain: 'blocks',
    ...over,
  };
}

function makeChain(over: Partial<ChainView> = {}): ChainView & { broadcasts: string[] } {
  const state = { tips: 1000, broadcasts: [] as string[] };
  const chain: ChainView & { broadcasts: string[] } = {
    broadcasts: state.broadcasts,
    tipHeight: async () => state.tips,
    outspend: async () => ({ spent: false }),
    broadcast: async (_rail, raw) => {
      state.broadcasts.push(raw);
      return `txid-${state.broadcasts.length}`;
    },
  };
  return Object.assign(chain, over);
}

function makeDeps(over: Partial<RefundExecuteDeps> = {}): RefundExecuteDeps {
  return {
    chain: makeChain(),
    journal: new InMemoryRefundJournal(),
    buildSpend: vi.fn(async (s: RefundStage) => ({ rawTxHex: `raw-${s.id}` })),
    nowSeconds: () => 1_700_000_000,
    ...over,
  };
}

describe('refundTimeGate - R02 boundary semantics', () => {
  it('deadline is inclusive: eligible AT the deadline, not 1 second before', () => {
    const base = { tipHeight: 10, refundUnlock: 5, refundUnlockDomain: 'blocks' as const, refundDeadlineUnix: 1000 };
    expect(refundTimeGate({ ...base, nowUnix: 999 })).toMatchObject({ ok: false, code: 'too_early' });
    expect(refundTimeGate({ ...base, nowUnix: 1000 })).toEqual({ ok: true });
  });

  it('late filing stays eligible (deadline is a floor, not a window)', () => {
    const g = refundTimeGate({
      tipHeight: 10, refundUnlock: 5, refundUnlockDomain: 'blocks',
      refundDeadlineUnix: 1000, nowUnix: 1000 + 86_400 * 30,
    });
    expect(g).toEqual({ ok: true });
  });

  it('a time deadline without a clock FAILS CLOSED', () => {
    const g = refundTimeGate({ tipHeight: 10, refundUnlock: 5, refundUnlockDomain: 'blocks', refundDeadlineUnix: 1000 });
    expect(g).toMatchObject({ ok: false, code: 'too_early' });
  });

  it('block CLTV boundary: tip >= unlock eligible, one block short refused', () => {
    expect(refundTimeGate({ tipHeight: 999, refundUnlock: 1000, refundUnlockDomain: 'blocks' })).toMatchObject({
      ok: false, code: 'cltv_not_reached',
    });
    expect(refundTimeGate({ tipHeight: 1000, refundUnlock: 1000, refundUnlockDomain: 'blocks' })).toEqual({ ok: true });
  });

  it('seconds-domain CLTV is clock-gated and rejects a below-threshold value', () => {
    expect(
      refundTimeGate({ tipHeight: 1, refundUnlock: 500_000_100, refundUnlockDomain: 'seconds', nowUnix: 500_000_099 }),
    ).toMatchObject({ ok: false, code: 'too_early' });
    expect(
      refundTimeGate({ tipHeight: 1, refundUnlock: 500_000_100, refundUnlockDomain: 'seconds', nowUnix: 500_000_100 }),
    ).toEqual({ ok: true });
    // A seconds value below the BIP-65 threshold is a build bug → fail closed.
    expect(
      refundTimeGate({ tipHeight: 1, refundUnlock: 1234, refundUnlockDomain: 'seconds', nowUnix: 9_999_999_999 }),
    ).toMatchObject({ ok: false, code: 'cltv_not_reached' });
  });
});

describe('executeRefund - idempotent, fail-closed', () => {
  it('refunds an eligible stage and journals the broadcast', async () => {
    const journal = new InMemoryRefundJournal();
    // Assert the intent (with raw tx) is durable BEFORE broadcast.
    const seen: string[] = [];
    const chain = makeChain({
      broadcast: vi.fn(async () => {
        seen.push(String(journal.read('tx:0')?.status));
        return 'txid-1';
      }),
    }) as ReturnType<typeof makeChain>;
    const deps = makeDeps({ chain, journal });
    const [out] = await executeRefund(deps, [stage()]);
    expect(out).toEqual({ id: 'tx:0', status: 'refunded', txid: 'txid-1' });
    expect(seen).toEqual(['intent']);
    expect(journal.read('tx:0')).toMatchObject({ status: 'broadcast', txid: 'txid-1', rawTxHex: 'raw-tx:0' });
  });

  it('is a no-op for an already-finished stage (no build, no broadcast)', async () => {
    const journal = new InMemoryRefundJournal();
    journal.write({
      id: 'tx:0', rail: 'btc-testnet4', depositTxid: 'd'.repeat(64), vout: 0, amountSats: 1,
      status: 'confirmed', txid: 'txid-old', at: 1,
    });
    const buildSpend = vi.fn();
    const deps = makeDeps({ journal, buildSpend });
    const [out] = await executeRefund(deps, [stage()]);
    expect(out).toMatchObject({ status: 'skipped', code: 'already_confirmed' });
    expect(buildSpend).not.toHaveBeenCalled();
    expect((deps.chain as ReturnType<typeof makeChain>).broadcasts).toEqual([]);
  });

  it('crash between broadcast and record: a landed spend reconciles WITHOUT rebroadcast', async () => {
    const journal = new InMemoryRefundJournal();
    journal.write({
      id: 'tx:0', rail: 'btc-testnet4', depositTxid: 'd'.repeat(64), vout: 0, amountSats: 1,
      status: 'intent', rawTxHex: 'raw-tx:0', at: 1,
    });
    const chain = makeChain({
      outspend: async () => ({ spent: true, spendTxid: 'txid-landed' }),
    }) as ReturnType<typeof makeChain>;
    const buildSpend = vi.fn();
    const [out] = await executeRefund(makeDeps({ chain, journal, buildSpend }), [stage()]);
    expect(out).toEqual({ id: 'tx:0', status: 'reconciled', txid: 'txid-landed' });
    expect(buildSpend).not.toHaveBeenCalled();
    expect(chain.broadcasts).toEqual([]);
    expect(journal.read('tx:0')).toMatchObject({ status: 'reconciled', txid: 'txid-landed' });
  });

  it('an unlanded broadcast attempt is retried from the journaled raw tx (same bytes)', async () => {
    const journal = new InMemoryRefundJournal();
    journal.write({
      id: 'tx:0', rail: 'btc-testnet4', depositTxid: 'd'.repeat(64), vout: 0, amountSats: 1,
      status: 'intent', rawTxHex: 'raw-tx:0', at: 1,
    });
    const chain = makeChain() as ReturnType<typeof makeChain>;
    const [out] = await executeRefund(makeDeps({ chain, journal }), [stage()]);
    expect(out).toMatchObject({ status: 'refunded', txid: 'txid-1' });
    expect(chain.broadcasts).toEqual(['raw-tx:0']);
  });

  it('an intent without raw bytes is an unknown state, never retried blindly', async () => {
    const journal = new InMemoryRefundJournal();
    journal.write({
      id: 'tx:0', rail: 'btc-testnet4', depositTxid: 'd'.repeat(64), vout: 0, amountSats: 1, status: 'intent', at: 1,
    });
    const [out] = await executeRefund(makeDeps({ journal }), [stage()]);
    expect(out).toMatchObject({ status: 'failed', code: 'unknown_journal_state' });
  });

  it('a UTXO already spent before we acted reconciles and never double-spends', async () => {
    const chain = makeChain({ outspend: async () => ({ spent: true, spendTxid: 'txid-founder' }) }) as ReturnType<typeof makeChain>;
    const buildSpend = vi.fn();
    const [out] = await executeRefund(makeDeps({ chain, buildSpend }), [stage()]);
    expect(out).toEqual({ id: 'tx:0', status: 'reconciled', txid: 'txid-founder' });
    expect(buildSpend).not.toHaveBeenCalled();
    expect(chain.broadcasts).toEqual([]);
  });

  it('skips before signing when the CLTV is not satisfied', async () => {
    const chain = makeChain({ tipHeight: async () => 999 }) as ReturnType<typeof makeChain>;
    const buildSpend = vi.fn();
    const [out] = await executeRefund(makeDeps({ chain, buildSpend }), [stage()]);
    expect(out).toMatchObject({ status: 'skipped', code: 'cltv_not_reached' });
    expect(buildSpend).not.toHaveBeenCalled();
  });

  it('fails closed on an unknown chain state (no broadcast)', async () => {
    const chain = makeChain({ tipHeight: async () => { throw new Error('esplora 503'); } }) as ReturnType<typeof makeChain>;
    const buildSpend = vi.fn();
    const [out] = await executeRefund(makeDeps({ chain, buildSpend }), [stage()]);
    expect(out).toMatchObject({ status: 'failed', code: 'chain_unknown' });
    expect(buildSpend).not.toHaveBeenCalled();
    expect(chain.broadcasts).toEqual([]);
  });

  it('a build/verify failure persists no intent and broadcasts nothing', async () => {
    const journal = new InMemoryRefundJournal();
    const deps = makeDeps({
      journal,
      buildSpend: vi.fn(async () => { throw new Error('scriptPubKey mismatch'); }),
    });
    const [out] = await executeRefund(deps, [stage()]);
    expect(out).toMatchObject({ status: 'failed', code: 'build_failed' });
    expect(journal.read('tx:0')).toBeNull();
    expect((deps.chain as ReturnType<typeof makeChain>).broadcasts).toEqual([]);
  });

  it('a broadcast failure leaves the intent for recovery and reports failure', async () => {
    const journal = new InMemoryRefundJournal();
    const chain = makeChain({ broadcast: async () => { throw new Error('mempool rejected'); } }) as ReturnType<typeof makeChain>;
    const [out] = await executeRefund(makeDeps({ chain, journal }), [stage()]);
    expect(out).toMatchObject({ status: 'failed', code: 'broadcast_failed' });
    expect(journal.read('tx:0')).toMatchObject({ status: 'intent', rawTxHex: 'raw-tx:0' });
  });

  it('all-milestones: refunds every eligible stage, skips the locked one', async () => {
    const chain = makeChain({ tipHeight: async () => 1000 }) as ReturnType<typeof makeChain>;
    const deps = makeDeps({ chain });
    const stages = [
      stage({ id: 'm1:0', refundUnlock: 1000 }),
      stage({ id: 'm2:0', refundUnlock: 1001 }), // still locked
      stage({ id: 'm3:0', refundUnlock: 900 }),
    ];
    const out = await executeRefund(deps, stages);
    expect(out.map((o) => o.status)).toEqual(['refunded', 'skipped', 'refunded']);
    expect(out[1]).toMatchObject({ code: 'cltv_not_reached' });
    expect(chain.broadcasts.length).toBe(2);
  });
});
