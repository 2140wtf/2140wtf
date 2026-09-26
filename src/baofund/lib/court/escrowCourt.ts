// src/lib/court/escrowCourt.ts
//
// Adapter: BAO Court (FROST threshold oracle) → ₿AO 2-of-3 escrow disputes.
//
// The general escrow primitive (lib/cashu/escrowMultisig.ts) locks stakes to
// {partyA, partyB, operator} with n_sigs = 2. Today a disagreement falls back
// to the refund locktime (each side reclaims its own stake) because the
// operator has no trustworthy way to know who is right - "operator + honest
// party" requires the operator to JUDGE.
//
// The court removes that judgement: stake-backed jurors vote (commit-reveal)
// and threshold-sign the winning outcome. The operator then co-signs the
// disputed release only when a valid kind-39007 court attestation names the
// winner - the operator verifies, it never decides.
//
// Adaptations from the canonical market-resolution court:
//   - "market"  → the escrow: marketId is `escrow:<escrowId>` so court
//                 records can never collide with prediction-market ids.
//   - "outcome" → the winner's x-only pubkey. Self-authenticating: the
//                 attestation itself names who may be paid, and the operator
//                 only ever pays one of the two locked parties.
//   - timings   → must fit INSIDE the escrow refund locktime (24h) minus the
//                 operator's signing margin (1h): past the locktime the
//                 depositors' refund keys win the race regardless of any
//                 court verdict.

import {
  hashCommit,
  tallyVotes,
  validateAttestationEvent,
  type AppealTimings,
  type DisputeCase,
  type JurorVote,
} from '@/baofund/court-core';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import {
  normalizeMultisigPubkey,
  MULTISIG_REFUND_PERIOD_SECONDS,
  OPERATOR_SIGN_MIN_LOCKTIME_MARGIN_SECONDS,
} from '../cashu/escrowMultisig';

/** Namespace prefix keeping escrow "markets" disjoint from prediction markets. */
export const ESCROW_MARKET_PREFIX = 'escrow:';

/** Map an escrow/battle/bounty id onto the court's marketId space. */
export function escrowMarketId(escrowId: string): string {
  const id = escrowId.trim();
  if (!id) throw new Error('Escrow id is required');
  return `${ESCROW_MARKET_PREFIX}${id}`;
}

/** The court outcome for an escrow dispute IS the winner's x-only pubkey. */
export function escrowOutcomeForWinner(winnerPubkey: string): string {
  const winner = normalizeMultisigPubkey(winnerPubkey);
  if (!winner) throw new Error('Invalid winner pubkey');
  return winner;
}

export interface EscrowDisputeInput {
  /** Battle/bounty/escrow identifier (opaque to the court). */
  escrowId: string;
  /** The party who disputes (any hex pubkey form). */
  challengerPubkey: string;
  /** The other party (any hex pubkey form). */
  respondentPubkey: string;
  /** Who the challenger says won (must be one of the two parties). */
  proposedWinnerPubkey: string;
  /** sha256 hashes of evidence artifacts (battle log, signed finish events). */
  evidenceHashes?: readonly string[];
  /** The operator/both-parties outcome being challenged, if one existed. */
  originalOutcome?: string;
}

/**
 * Build the court DisputeCase for an escrow disagreement. Both parties and
 * the proposed winner are validated and normalized to x-only hex.
 */
export function buildEscrowDisputeCase(input: EscrowDisputeInput): DisputeCase {
  const challenger = normalizeMultisigPubkey(input.challengerPubkey);
  const respondent = normalizeMultisigPubkey(input.respondentPubkey);
  const winner = normalizeMultisigPubkey(input.proposedWinnerPubkey);
  if (!challenger || !respondent || !winner) throw new Error('Invalid dispute pubkey');
  if (challenger === respondent) throw new Error('Dispute parties must be distinct');
  if (winner !== challenger && winner !== respondent) {
    throw new Error('Proposed winner must be one of the two escrow parties');
  }
  return {
    disputeId: '', // filled from the published dispute event id (kind 38025)
    marketId: escrowMarketId(input.escrowId),
    challengerPubkey: challenger,
    respondentPubkey: respondent,
    evidenceHashes: input.evidenceHashes ?? [],
    proposedOutcome: escrowOutcomeForWinner(winner),
    originalOutcome: input.originalOutcome,
  };
}

/**
 * Appeal timings fitted to the escrow refund locktime. The sequential phases
 * (dispute → opt-in → selection → dkg → vote → signing → claim) must complete
 * before depositors can self-refund, otherwise a court verdict arrives too
 * late to matter. Budget: 24h locktime − 1h operator margin = 23h; the phases
 * below sum to ~16h, leaving ~7h of slack for slow jurors.
 */
export const ESCROW_DISPUTE_APPEAL_TIMINGS: AppealTimings = {
  disputeWindowSeconds: 2 * 3600,
  optInWindowSeconds: 3 * 3600,
  selectionDeadlineSeconds: 3600,
  dkgWindowSeconds: 4 * 3600,
  voteCommitWindowSeconds: 2 * 3600,
  voteRevealWindowSeconds: 3600,
  signingWindowSeconds: 3600,
  claimWindowSeconds: 2 * 3600,
  reselectionWindowSeconds: 3600,
  seedBlockConfirmations: 3,
};

/**
 * Total seconds the sequential court phases need. The operator must refuse
 * dispute releases (and let the refund path run) when the remaining locktime
 * is below this - a verdict that lands after the refund race is worthless.
 */
export function escrowCourtTotalPhaseSeconds(t: AppealTimings = ESCROW_DISPUTE_APPEAL_TIMINGS): number {
  return (
    t.disputeWindowSeconds +
    t.optInWindowSeconds +
    t.selectionDeadlineSeconds +
    t.dkgWindowSeconds +
    t.voteCommitWindowSeconds +
    t.voteRevealWindowSeconds +
    t.signingWindowSeconds +
    t.claimWindowSeconds
  );
}

/** True when a court cycle started `elapsedSeconds` ago can still beat the refund locktime. */
export function escrowCourtCanResolveInTime(elapsedSeconds: number): boolean {
  const budget = MULTISIG_REFUND_PERIOD_SECONDS - OPERATOR_SIGN_MIN_LOCKTIME_MARGIN_SECONDS;
  return elapsedSeconds + escrowCourtTotalPhaseSeconds() <= budget;
}

export interface EscrowCourtVerification {
  valid: boolean;
  /** The court-decided winner (x-only pubkey) - present only when valid. */
  winnerPubkey?: string;
  error?: string;
}

export interface EscrowCourtVerifyContext {
  /** The dispute this attestation must bind to (disputeId = dispute event id). */
  dispute: DisputeCase;
  /** The two escrow parties, any hex form - the only payable outcomes. */
  partyAPubkey: string;
  partyBPubkey: string;
  /** Expected FROST group pubkey (x-only) of the empaneled jury. */
  courtGroupPubkey: string;
  /** Optionally pin who may publish the attestation (jury aggregator). */
  trustedPublisherPubkeys?: readonly string[];
}

/**
 * Verify a kind-39007 court attestation for an escrow dispute and extract
 * the winner. Strict on every binding: dispute id, escrow market id, group
 * key, and that the outcome pays one of the two locked parties - never the
 * operator, never a third key.
 */
export function verifyEscrowCourtAttestation(
  event: NostrEvent,
  ctx: EscrowCourtVerifyContext,
): EscrowCourtVerification {
  // An empty disputeId would silently drop the dispute pin inside the
  // validator (expectedDisputeEventId is skipped when falsy) - refuse to
  // verify rather than accept a merely market-pinned attestation.
  if (!ctx.dispute.disputeId || !/^[0-9a-fA-F]{64}$/.test(ctx.dispute.disputeId)) {
    return { valid: false, error: 'Dispute case has no dispute event id - cannot bind the attestation' };
  }
  const a = normalizeMultisigPubkey(ctx.partyAPubkey);
  const b = normalizeMultisigPubkey(ctx.partyBPubkey);
  if (!a || !b) return { valid: false, error: 'Escrow party pubkeys are not configured' };

  // The release gate must not accept a laundered attestation: only the
  // dispute kind (39007) carries the verdict-tally binding the operator
  // co-sign is meant to certify. Kind-89 market attestations are weaker
  // (no tally requirement) and must never authorize a disputed payout.
  if (event.kind !== 39007) {
    return { valid: false, error: 'Escrow release requires a kind-39007 court attestation' };
  }

  const result = validateAttestationEvent(event, {
    expectedGroupPubkey: ctx.courtGroupPubkey,
    expectedDisputeEventId: ctx.dispute.disputeId,
    expectedMarketId: ctx.dispute.marketId,
    allowedOutcomes: [a, b].sort(),
    trustedPublisherPubkeys: ctx.trustedPublisherPubkeys
      ? [...ctx.trustedPublisherPubkeys]
      : undefined,
  });
  if (!result.valid) return { valid: false, error: result.error };

  const outcomeTag = event.tags.find((t) => t[0] === 'outcome');
  const winner = outcomeTag?.[1];
  if (!winner || (winner !== a && winner !== b)) {
    return { valid: false, error: 'Court outcome does not name an escrow party' };
  }
  return { valid: true, winnerPubkey: winner };
}

/**
 * NOTE ON JURY GROUP KEYS: there is deliberately NO "expected group pubkey"
 * helper here. The dispute-derived group key is PUBLICLY COMPUTABLE - its
 * private key can be derived by ANYONE from the court's normal group pubkey
 * plus the dispute id (see vendor/frost-court/dispute.ts, deriveDispute-
 * GroupPubkey: "the private key of the returned pubkey is PUBLICLY COMPUTABLE
 * … must NEVER be used to accept FROST attestation signatures"). Pinning
 * ctx.courtGroupPubkey to it would let any attacker forge a valid-looking
 * kind-39007 attestation and steal the escrow. The operator must supply the
 * REAL empaneled jury key out of band (court registry / DKG record).
 */
export interface EscrowVoteTally {
  /** Winning outcome = winner's x-only pubkey. */
  winnerPubkey: string;
  supportingVotes: JurorVote[];
  /** Reveals whose commit hash did not match - excluded, usable as slashing evidence. */
  invalidReveals: JurorVote[];
}

/**
 * Tally juror commit-reveal votes for an escrow dispute. Wraps the court's
 * tallyVotes with the escrow invariant: the winning outcome must be one of
 * the two parties (a "YES"/"NO" market-style outcome is meaningless here).
 * Commit-reveal mismatches never abort the count - they are excluded and
 * returned as slashing evidence, matching CourtVoteMachine.
 */
export function tallyEscrowJurorVotes(
  votes: readonly JurorVote[],
  partyAPubkey: string,
  partyBPubkey: string,
): EscrowVoteTally {
  const a = normalizeMultisigPubkey(partyAPubkey);
  const b = normalizeMultisigPubkey(partyBPubkey);
  if (!a || !b) throw new Error('Escrow party pubkeys are not configured');
  const { outcome, supportingVotes, invalidReveals } = tallyVotes(votes);
  if (outcome !== a && outcome !== b) {
    throw new Error('Jury outcome does not name an escrow party');
  }
  return { winnerPubkey: outcome, supportingVotes, invalidReveals };
}

/** Re-exported so dispute UIs can build vote commits without importing the vendor path. */
export { hashCommit };
