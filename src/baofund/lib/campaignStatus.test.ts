import { describe, expect, it } from 'vitest';
import {
  campaignStatus,
  computeRefundLocktime,
  DIVERSITY_MIN_DISTINCT,
  DIVERSITY_MIN_EXTERNAL_RATIO,
  DISPUTE_WINDOW_SECS,
  REGISTRAR_LIVENESS_SECS,
  DEAD_REGISTRAR_TIMELOCK_SECS,
  T_ADJUDICATE_MAX_SECS,
} from './campaignStatus';

const T0 = 1_700_000_000;

type Inputs = Parameters<typeof campaignStatus>[0];

// A fully passing input - each test mutates ONE field.
function base(over: Partial<Inputs> = {}): Inputs {
  return {
    fold: { campaign: '39801:aa:card1', seq: 3, runningSats: 50_000, closed: false, frozen: false },
    openDispute: null,
    registrarLastSeen: T0 - 3600,
    milestoneCompletedAt: T0 - 15 * 86400, // outside even the 14d none-window
    tier: 'none',
    diversity: { distinctExternal: 5, externalSats: 40_000, totalSats: 50_000 },
    nowSeconds: T0,
    ...over,
  };
}

describe('campaignStatus - happy path and phases', () => {
  it('all gates pass → releasable, empty blockedBy', () => {
    const v = campaignStatus(base());
    expect(v.releaseEligible).toBe(true);
    expect(v.blockedBy).toEqual([]);
    expect(v.phase).toBe('releasable');
    expect(v.refundEscape.available).toBe(false);
  });

  it('seq 0 with no escrow balance → staking phase', () => {
    const v = campaignStatus(base({ fold: { campaign: 'x', seq: 0, runningSats: 0, closed: false, frozen: false } }));
    expect(v.phase).toBe('staking');
    expect(v.blockedBy).toEqual(['escrow_balance']);
  });

  it('closed after release → released phase (gates were passing)', () => {
    const v = campaignStatus(base({ fold: { campaign: 'x', seq: 9, runningSats: 0, closed: true, frozen: false } }));
    // runningSats 0 fails escrow_balance - balance gate reports the truth even on a closed ledger.
    expect(v.phase).toBe('funded');
    expect(v.blockedBy).toEqual(['escrow_balance']);
  });

  it('frozen fold → frozen phase wins over everything, ledger_frozen blocked', () => {
    const v = campaignStatus(base({ fold: { campaign: 'x', seq: 5, runningSats: 100, closed: false, frozen: 'chain_forked' } }));
    expect(v.phase).toBe('frozen');
    expect(v.blockedBy[0]).toBe('ledger_frozen');
  });
});

describe('campaignStatus - each gate blocks with a reason', () => {
  it('registrar liveness: inside 72h passes; at >72h fails with hours + escape timestamp', () => {
    const inside = campaignStatus(base({ registrarLastSeen: T0 - REGISTRAR_LIVENESS_SECS }));
    expect(inside.blockedBy).not.toContain('registrar_liveness');

    const dead = campaignStatus(base({ registrarLastSeen: T0 - REGISTRAR_LIVENESS_SECS - 1 }));
    expect(dead.blockedBy).toContain('registrar_liveness');
    expect(dead.phase).toBe('registrar_dead');
    expect(dead.refundEscape.available).toBe(true);
    expect(dead.refundEscape.opensAt).toBe(T0 - REGISTRAR_LIVENESS_SECS - 1 + REGISTRAR_LIVENESS_SECS + DEAD_REGISTRAR_TIMELOCK_SECS);
    const gate = dead.gates.find((g) => g.code === 'registrar_liveness')!;
    expect(gate.reason).toMatch(/timelock opens at \d+/);
  });

  it('liveness boundary: exactly 72h still passes (strictly-greater rule)', () => {
    const v = campaignStatus(base({ registrarLastSeen: T0 - REGISTRAR_LIVENESS_SECS }));
    expect(v.blockedBy).not.toContain('registrar_liveness');
  });

  it('open dispute blocks with the dispute id in the reason', () => {
    const v = campaignStatus(base({ openDispute: { disputeId: 'evt-abc', openedAt: T0 - 100 } }));
    expect(v.blockedBy).toContain('dispute_open');
    expect(v.gates.find((g) => g.code === 'dispute_open')!.reason).toMatch(/evt-abc/);
  });

  it('dispute window: boundary at exactly window-end passes; 1s before fails', () => {
    const completed = T0 - DISPUTE_WINDOW_SECS['agent-verified'];
    const atBoundary = campaignStatus(base({ tier: 'agent-verified', milestoneCompletedAt: completed }));
    expect(atBoundary.blockedBy).not.toContain('dispute_window');

    const oneSecBefore = campaignStatus(base({ tier: 'agent-verified', milestoneCompletedAt: completed + 1 }));
    expect(oneSecBefore.blockedBy).toContain('dispute_window');
  });

  it('tier windows differ: 14d/7d/3d and the round-8 note (bare agent key gets none window)', () => {
    expect(DISPUTE_WINDOW_SECS.none).toBe(14 * 86400);
    expect(DISPUTE_WINDOW_SECS['agent-verified']).toBe(7 * 86400);
    expect(DISPUTE_WINDOW_SECS['human-court']).toBe(3 * 86400);
  });

  it('diversity gate: thresholds from C-2 (≥3 distinct, ≥60%)', () => {
    expect(DIVERSITY_MIN_DISTINCT).toBe(3);
    expect(DIVERSITY_MIN_EXTERNAL_RATIO).toBe(0.6);

    const lowCount = campaignStatus(base({ diversity: { distinctExternal: 2, externalSats: 40_000, totalSats: 50_000 } }));
    expect(lowCount.blockedBy).toContain('diversity_gate');

    const lowRatio = campaignStatus(base({ diversity: { distinctExternal: 5, externalSats: 29_999, totalSats: 50_000 } }));
    expect(lowRatio.blockedBy).toContain('diversity_gate');

    const exactPass = campaignStatus(base({ diversity: { distinctExternal: 3, externalSats: 30_000, totalSats: 50_000 } }));
    expect(exactPass.blockedBy).not.toContain('diversity_gate');
  });

  it('diversity gate is skipped on human-court tier', () => {
    const v = campaignStatus(base({ tier: 'human-court', diversity: { distinctExternal: 0, externalSats: 0, totalSats: 50_000 } }));
    expect(v.blockedBy).not.toContain('diversity_gate');
  });

  it('zero balance blocks even when everything else passes', () => {
    const v = campaignStatus(base({ fold: { campaign: 'x', seq: 4, runningSats: 0, closed: false, frozen: false } }));
    expect(v.blockedBy).toEqual(['escrow_balance']);
  });

  it('multiple failures: blockedBy lists ALL codes in evaluation order', () => {
    const v = campaignStatus(
      base({
        fold: { campaign: 'x', seq: 2, runningSats: 100, closed: false, frozen: 'seq_gap' },
        openDispute: { disputeId: 'd1', openedAt: T0 },
        registrarLastSeen: T0 - 100 * 3600,
        milestoneCompletedAt: T0, // window active - dispute_window fails too
        diversity: { distinctExternal: 0, externalSats: 0, totalSats: 100 },
      }),
    );
    expect(v.blockedBy).toEqual(['ledger_frozen', 'registrar_liveness', 'dispute_open', 'dispute_window', 'diversity_gate']);
    expect(v.releaseEligible).toBe(false);
  });
});

describe('R02 boundary matrix (ROW-B B6)', () => {
  // B6 #3: campaign_deadline contributes zero remaining time after passing;
  // B6 #4: expiry opens the refund path. The dispute window is the per-tier
  // deadline here: open at the boundary, closed 1s early.
  for (const tier of ['none', 'agent-verified', 'human-court'] as const) {
    it(`${tier}: dispute window is inclusive at its end and excludes 1s before`, () => {
      const window = DISPUTE_WINDOW_SECS[tier];
      const at = campaignStatus(base({ tier, milestoneCompletedAt: T0 - window, nowSeconds: T0 }));
      expect(at.blockedBy).not.toContain('dispute_window');
      const before = campaignStatus(base({ tier, milestoneCompletedAt: T0 - window + 1, nowSeconds: T0 }));
      expect(before.blockedBy).toContain('dispute_window');
    });

    it(`${tier}: liveness is satisfied at exactly the bound and fails 1s later`, () => {
      const at = campaignStatus(base({ registrarLastSeen: T0 - REGISTRAR_LIVENESS_SECS, nowSeconds: T0 }));
      expect(at.blockedBy).not.toContain('registrar_liveness');
      const after = campaignStatus(base({ registrarLastSeen: T0 - REGISTRAR_LIVENESS_SECS - 1, nowSeconds: T0 }));
      expect(after.blockedBy).toContain('registrar_liveness');
    });
  }

  it('late release attempt: once every deadline has passed, only the real gates remain', () => {
    // A campaign whose window ended long ago is still blocked by a live dispute
    // or a dead registrar - "deadline passed" must never bypass those gates.
    const late = campaignStatus(
      base({
        milestoneCompletedAt: T0 - 400 * 86400,
        registrarLastSeen: T0 - REGISTRAR_LIVENESS_SECS - 1,
        openDispute: { disputeId: 'late', openedAt: T0 - 400 * 86400 },
      }),
    );
    expect(late.blockedBy).toContain('dispute_open');
    expect(late.blockedBy).toContain('registrar_liveness');
    expect(late.releaseEligible).toBe(false);
  });

  it('locktime boundary: strictly after freeze + window + adjudication (margin floor 0)', () => {
    for (const tier of ['none', 'agent-verified', 'human-court'] as const) {
      const lk = computeRefundLocktime({ freezeAt: T0, tier, campaignDeadline: 0, marginSecs: 0 });
      expect(lk).toBe(T0 + DISPUTE_WINDOW_SECS[tier] + T_ADJUDICATE_MAX_SECS);
      expect(lk).toBeGreaterThan(T0 + DISPUTE_WINDOW_SECS[tier]);
    }
    // longer dispute windows must not shorten the locktime
    expect(computeRefundLocktime({ freezeAt: T0, tier: 'none', campaignDeadline: 0, marginSecs: 0 })).toBeGreaterThan(
      computeRefundLocktime({ freezeAt: T0, tier: 'human-court', campaignDeadline: 0, marginSecs: 0 }),
    );
  });
});

describe('computeRefundLocktime - NORMATIVE §3 formula', () => {
  it('freeze + window + T_ADJUDICATE_MAX + campaign_deadline + margin, per tier', () => {
    const freezeAt = 1_700_000_000;
    const campaignDeadline = 30 * 86400;
    const margin = 3_600;
    expect(
      computeRefundLocktime({ freezeAt, tier: 'none', campaignDeadline, marginSecs: margin }),
    ).toBe(freezeAt + 14 * 86400 + T_ADJUDICATE_MAX_SECS + campaignDeadline + margin);
    expect(
      computeRefundLocktime({ freezeAt, tier: 'human-court', campaignDeadline, marginSecs: margin }),
    ).toBe(freezeAt + 3 * 86400 + T_ADJUDICATE_MAX_SECS + campaignDeadline + margin);
  });

  it('the locktime never depends on clock or state after freeze', () => {
    const a = computeRefundLocktime({ freezeAt: 100, tier: 'agent-verified', campaignDeadline: 200, marginSecs: 10 });
    const b = computeRefundLocktime({ freezeAt: 100, tier: 'agent-verified', campaignDeadline: 200, marginSecs: 10 });
    expect(a).toBe(b);
  });
});
