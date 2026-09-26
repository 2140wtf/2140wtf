/**
 * Campaign-status projection (Concord §47 tail; closes the round-14 tool hole:
 * "no campaign-status surface exposing RELEASE_ELIGIBLE gate state - a creator
 * can't learn WHY release is blocked").
 *
 * PURE: every input is injected - the structural ledger fold (49305), the
 * court fold's open dispute, diversity counts (registrar publishes the
 * nullifier accumulator root + count; the caller supplies the numbers),
 * and a clock. Nothing here reads Date.now() or the network.
 *
 * Gates implemented (NORMATIVE sources):
 *   - ledger_frozen        - frozen fold → projection unusable (§ fold contract)
 *   - registrar_liveness   - 72h liveness → hot-spare; dead → 7-day contributor
 *                            timelock escape (§25.1 failure modes)
 *   - dispute_open         - RELEASED unreachable while DISPUTE_OPEN regardless
 *                            of tier (§25.1, invariant #4)
 *   - dispute_window       - tier window must have elapsed since milestone
 *                            completion (none 14d / agent-verified 7d /
 *                            human-court 3d; §25.1 + round-8 note: a bare
 *                            agent-key tier gets the none-tier window)
 *   - diversity_gate       - ≥3 distinct external contributors AND ≥60%
 *                            external ratio; mechanical precondition on
 *                            none/agent-verified tiers only (§25.1, C-2)
 *   - escrow_balance       - nothing to release at zero balance
 *
 * Refund locktime (NORMATIVE §3): computed ONCE at freeze as
 *   freeze + window + T_ADJUDICATE_MAX + campaign_deadline + margin
 * - every escrow proof carries a mint-enforced NUT-11 fallback to REFUND_ALL
 * at that instant; no state other than REFUND_ALL/RELEASED outlives it.
 */

/** Tier windows (seconds). A bare agent key gets the none-tier window. */
export const DISPUTE_WINDOW_SECS = {
  none: 14 * 86400,
  'agent-verified': 7 * 86400,
  'human-court': 3 * 86400,
} as const;

export type CampaignTier = keyof typeof DISPUTE_WINDOW_SECS;

/** Registrar liveness bound: 72h without a signed heartbeat → hot-spare. */
export const REGISTRAR_LIVENESS_SECS = 72 * 3600;
/** Dead-registrar contributor timelock: 7 days, fail-closed. */
export const DEAD_REGISTRAR_TIMELOCK_SECS = 7 * 86400;
/** Hard adjudication deadline (§32.2 C-1). */
export const T_ADJUDICATE_MAX_SECS = 7 * 86400;
/** Diversity gate (§25.1): author-MUST-set placeholder values from C-2. */
export const DIVERSITY_MIN_DISTINCT = 3;
export const DIVERSITY_MIN_EXTERNAL_RATIO = 0.6;

export type GateCode =
  | 'ledger_frozen'
  | 'registrar_liveness'
  | 'dispute_open'
  | 'dispute_window'
  | 'diversity_gate'
  | 'escrow_balance';

export interface GateResult {
  readonly code: GateCode;
  readonly pass: boolean;
  /** Why it failed - the creator-facing explanation. */
  readonly reason?: string;
}

export interface DiversityInputs {
  /** Distinct external contributors (nullifier accumulator count). */
  readonly distinctExternal: number;
  /** External contribution sats (sealed-total aggregation). */
  readonly externalSats: number;
  /** Total contribution sats. */
  readonly totalSats: number;
}

export interface CampaignStatusInputs {
  readonly fold: {
    readonly campaign: string;
    readonly seq: number;
    readonly runningSats: number;
    readonly closed: boolean;
    readonly frozen: false | string;
  };
  /** The court fold's live dispute, if any. */
  readonly openDispute: { readonly disputeId: string; readonly openedAt: number } | null;
  /** Registrar's last signed heartbeat / ledger entry (unix seconds). */
  readonly registrarLastSeen: number;
  /** Milestone completion anchor for the dispute window (unix seconds). */
  readonly milestoneCompletedAt: number;
  readonly tier: CampaignTier;
  readonly diversity: DiversityInputs;
  readonly nowSeconds: number;
}

export type CampaignPhase =
  | 'staking' // seq 0: no contributor locks yet
  | 'funded' // locks present, release not yet eligible
  | 'releasable' // every gate passes - RELEASE_ELIGIBLE
  | 'released' // closed after release
  | 'refunded' // closed after refund
  | 'frozen' // fork/broken chain - projection fail-closed
  | 'registrar_dead'; // liveness expired - timelock escape pending

export interface CampaignStatusView {
  readonly campaign: string;
  readonly phase: CampaignPhase;
  /** True iff EVERY gate passes (RELEASE_ELIGIBLE). */
  readonly releaseEligible: boolean;
  /** All gates with pass/fail - the creator's "why" surface. */
  readonly gates: readonly GateResult[];
  /** Failing gate codes in evaluation order (empty when eligible). */
  readonly blockedBy: readonly GateCode[];
  /** Dead-registrar escape: when the contributor timelock opens REFUND_ALL. */
  readonly refundEscape: {
    readonly available: boolean;
    /** Unix seconds the timelock opens (registrarLastSeen + 72h + 7d). */
    readonly opensAt: number;
  };
}

/** Evaluate every gate in deterministic order; first failure is blockedBy[0]. */
export function evaluateReleaseGates(input: CampaignStatusInputs): readonly GateResult[] {
  const gates: GateResult[] = [];

  gates.push(
    input.fold.frozen
      ? { code: 'ledger_frozen', pass: false, reason: `ledger fold frozen (${input.fold.frozen}) - no release can be evaluated` }
      : { code: 'ledger_frozen', pass: true },
  );

  const livenessAge = input.nowSeconds - input.registrarLastSeen;
  gates.push(
    livenessAge > REGISTRAR_LIVENESS_SECS
      ? {
          code: 'registrar_liveness',
          pass: false,
          reason: `registrar silent ${Math.floor(livenessAge / 3600)}h (limit ${REGISTRAR_LIVENESS_SECS / 3600}h) - contributor timelock opens at ${input.registrarLastSeen + REGISTRAR_LIVENESS_SECS + DEAD_REGISTRAR_TIMELOCK_SECS}`,
        }
      : { code: 'registrar_liveness', pass: true },
  );

  gates.push(
    input.openDispute
      ? {
          code: 'dispute_open',
          pass: false,
          reason: `dispute ${input.openDispute.disputeId} is open - RELEASED is unreachable while DISPUTE_OPEN regardless of tier`,
        }
      : { code: 'dispute_open', pass: true },
  );

  const windowEnds = input.milestoneCompletedAt + DISPUTE_WINDOW_SECS[input.tier];
  gates.push(
    input.nowSeconds < windowEnds
      ? {
          code: 'dispute_window',
          pass: false,
          reason: `${input.tier}-tier dispute window runs ${Math.ceil((windowEnds - input.nowSeconds) / 3600)}h more (ends ${windowEnds})`,
        }
      : { code: 'dispute_window', pass: true },
  );

  if (input.tier !== 'human-court') {
    const ratio = input.diversity.totalSats > 0 ? input.diversity.externalSats / input.diversity.totalSats : 0;
    gates.push(
      input.diversity.distinctExternal < DIVERSITY_MIN_DISTINCT || ratio < DIVERSITY_MIN_EXTERNAL_RATIO
        ? {
            code: 'diversity_gate',
            pass: false,
            reason: `diversity gate needs ≥${DIVERSITY_MIN_DISTINCT} distinct external contributors (have ${input.diversity.distinctExternal}) and ≥${DIVERSITY_MIN_EXTERNAL_RATIO * 100}% external ratio (have ${Math.round(ratio * 100)}%)`,
          }
        : { code: 'diversity_gate', pass: true },
    );
  }

  gates.push(
    input.fold.runningSats <= 0
      ? { code: 'escrow_balance', pass: false, reason: 'escrow balance is zero - nothing to release' }
      : { code: 'escrow_balance', pass: true },
  );

  return gates;
}

export function campaignStatus(input: CampaignStatusInputs): CampaignStatusView {
  const gates = evaluateReleaseGates(input);
  const blockedBy = gates.filter((g) => !g.pass).map((g) => g.code);
  const registrarDead = input.nowSeconds - input.registrarLastSeen > REGISTRAR_LIVENESS_SECS;
  const opensAt = input.registrarLastSeen + REGISTRAR_LIVENESS_SECS + DEAD_REGISTRAR_TIMELOCK_SECS;

  let phase: CampaignPhase;
  if (input.fold.frozen) phase = 'frozen';
  else if (registrarDead) phase = 'registrar_dead';
  else if (blockedBy.length > 0) phase = input.fold.seq === 0 ? 'staking' : 'funded';
  else if (input.fold.closed) phase = 'released';
  else phase = 'releasable';

  return {
    campaign: input.fold.campaign,
    phase,
    releaseEligible: blockedBy.length === 0,
    gates,
    blockedBy,
    refundEscape: { available: registrarDead, opensAt },
  };
}

/**
 * NORMATIVE §3 refund locktime - computed ONCE at freeze:
 * freeze + window + T_ADJUDICATE_MAX + campaign_deadline + margin.
 * Mint-enforced (NUT-11); no state other than REFUND_ALL/RELEASED outlives it.
 */
export function computeRefundLocktime(freeze: {
  readonly freezeAt: number;
  readonly tier: CampaignTier;
  readonly campaignDeadline: number;
  readonly marginSecs: number;
}): number {
  return freeze.freezeAt + DISPUTE_WINDOW_SECS[freeze.tier] + T_ADJUDICATE_MAX_SECS + freeze.campaignDeadline + freeze.marginSecs;
}
