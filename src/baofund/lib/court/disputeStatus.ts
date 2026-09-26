/**
 * disputeStatus - the S1/S2 fold behind the court GUI (design §2, rounds 1–5).
 *
 * PURE: every input is injected - relay events, escrow context, and a clock.
 * The React hook (useCourtDispute) supplies live events; tests pin `now`.
 *
 * Security rules encoded here (COURT-GUI-WIRING-DESIGN.md):
 *   - round-1: signature-verify every court event BEFORE parsing; malformed
 *     or unverified events are dropped, never rendered;
 *   - round-2 fold-authenticity: a dispute surfaces only if its kind-38025
 *     author is one of the escrow parties - sybil spam never reaches the UI;
 *   - round-2: verdicts verify through verifyEscrowCourtAttestation (the SAME
 *     function the Fund API release gate uses), which pins the REAL empaneled
 *     courtGroupPubkey - the dispute-derived group key (whose private key is
 *     publicly computable) can never authorize anything here;
 *   - round-1: disputes queried/filtered by `#market` = `escrow:<id>`.
 */
import { verifyEvent } from 'nostr-tools/pure';
import {
  BAO_COURT_DISPUTE_KIND,
  BAO_COURT_ATTESTATION_KIND,
} from '@/baofund/court-core/events';
import { computePhaseBounds, getActivePhase } from '@/baofund/court-core/appealTiming';
import type { AppealPhase } from '@/baofund/court-core/types';
import {
  ESCROW_DISPUTE_APPEAL_TIMINGS,
  ESCROW_MARKET_PREFIX,
  escrowCourtCanResolveInTime,
  verifyEscrowCourtAttestation,
} from './escrowCourt';

export type { AppealPhase };

/** Minimal structural event type (nostr-tools compatible). */
export interface CourtEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly kind: number;
  readonly created_at: number;
  readonly tags: readonly string[][];
  readonly content: string;
  readonly sig: string;
}

/** Hex-64 id (event id or pubkey). */
const HEX_64 = /^[0-9a-f]{64}$/;

export interface FoldedDispute {
  /** The dispute id IS the 38025 event id (frozen at publish time). */
  readonly disputeId: string;
  readonly author: string;
  /** The `escrow:<id>` market id this dispute binds to. */
  readonly marketId: string;
  readonly escrowId: string;
  readonly challengerPubkey: string;
  readonly respondentPubkey: string;
  readonly proposedOutcome: string;
  readonly originalOutcome: string;
  readonly evidenceHashes: readonly string[];
  /** Dispute-open time (unix seconds) - the phase-timeline anchor. */
  readonly openedAt: number;
  /** The builder's `deadline` tag (unix seconds). */
  readonly deadline: number;
}

export type DisputeTerminal =
  | { kind: 'active' }
  | { kind: 'verdict'; winnerPubkey: string; attestationEventId: string }
  | { kind: 'invalid_attestation'; error: string };

export interface PhaseBound {
  readonly phase: AppealPhase;
  readonly startsAt: number;
  readonly endsAt: number;
}

export interface DisputeStatusView {
  readonly dispute: FoldedDispute;
  /** Phase bounds anchored at openedAt with the escrow-fitted timings. */
  readonly phases: readonly PhaseBound[];
  /** Phase active at the injected `now`, or null (before/after all phases). */
  readonly activePhase: AppealPhase | null;
  /** Can a court cycle opened `now - openedAt` ago still beat the refund locktime? */
  readonly canStillResolveInTime: boolean;
  readonly terminal: DisputeTerminal;
}

export interface FoldContext {
  /** Both escrow parties (any hex form) - fold-authenticity rule anchor. */
  partyAPubkey: string;
  partyBPubkey: string;
  /** REAL empaneled jury key (out-of-band; NEVER dispute-derived). */
  courtGroupPubkey: string;
  /** Unix seconds - injected clock; the fold never reads Date.now(). */
  nowSeconds: number;
}

/**
 * Relay query for the disputes of one escrow.
 *
 * The round-1 plan filtered by `#market: ['escrow:<id>']`, but strfry indexes
 * ONLY single-character tag names (proved by the 3308 `#r` incident, and again
 * live during WS-2: a `#market` REQ is refused with "unindexed tag filter" and
 * yields zero events). So we filter by the escrow PARTIES (the pubkey index) -
 * which the round-2 fold-authenticity rule already requires - and bind the
 * market client-side in `parseDisputeEvent`. Callers without both parties get
 * no result rather than a false "no dispute".
 */
export function disputesFilter(partyPubkeys: readonly string[]) {
  return {
    kinds: [BAO_COURT_DISPUTE_KIND],
    authors: partyPubkeys.map((p) => p.toLowerCase()),
    limit: 50,
  };
}

/**
 * Relay query for attestations of one dispute. The builder tags them with a
 * single-char `d` = dispute event id (strfry-indexable); the readable
 * `dispute` tag is NOT indexed, so querying `#dispute` returns nothing live.
 */
export function attestationsFilter(disputeId: string) {
  return { kinds: [BAO_COURT_ATTESTATION_KIND], '#d': [disputeId], limit: 10 };
}

function tagValue(e: CourtEvent, name: string): string | undefined {
  return e.tags.find((t) => t[0] === name)?.[1];
}

/**
 * TRUE signature verification, immune to the nostr-tools memoization
 * hazard: `finalizeEvent` stamps a hidden `verifiedSymbol = true` on the
 * event object and `verifyEvent` returns that cached flag when present -
 * so a locally-built event, an object spread of one, or an attacker-stamped
 * object would SKIP verification entirely. Stripping own symbols forces the
 * real hash+signature check to run on the actual bytes.
 * (Shared logic with jurorCandidacy.verifyCourtEvent - duplicated to keep
 * each fold module self-contained; both are covered by tests.)
 */
function verifyDisputeEvent(e: CourtEvent): boolean {
  const stripped = { ...e } as Record<PropertyKey, unknown>;
  for (const sym of Object.getOwnPropertySymbols(stripped)) delete stripped[sym as unknown as string];
  try {
    return verifyEvent(stripped as Parameters<typeof verifyEvent>[0]);
  } catch {
    return false;
  }
}

/**
 * Parse + signature-verify one kind-38025 event into a FoldedDispute.
 * Returns null for anything foreign: wrong kind, bad signature, unparseable
 * content, missing bindings, or an author/challenger outside the escrow
 * parties (round-2: sybil disputes against our escrows never surface).
 */
export function parseDisputeEvent(e: CourtEvent, ctx: FoldContext): FoldedDispute | null {
  if (e.kind !== BAO_COURT_DISPUTE_KIND) return null;
  try {
    if (!verifyDisputeEvent(e)) return null;
  } catch {
    return null;
  }
  const author = e.pubkey.toLowerCase();
  const a = ctx.partyAPubkey.toLowerCase();
  const b = ctx.partyBPubkey.toLowerCase();
  if (author !== a && author !== b) return null;

  let content: Record<string, unknown>;
  try {
    content = JSON.parse(e.content || '{}') as Record<string, unknown>;
  } catch {
    return null;
  }
  const marketId = typeof content.marketId === 'string' && content.marketId ? content.marketId : (tagValue(e, 'market') ?? '');
  if (!marketId.startsWith(ESCROW_MARKET_PREFIX)) return null;
  const escrowId = marketId.slice(ESCROW_MARKET_PREFIX.length);

  const challenger = (tagValue(e, 'challenger') ?? '').toLowerCase();
  if (!HEX_64.test(challenger) || (challenger !== a && challenger !== b)) return null;

  const evidence = Array.isArray(content.evidenceHashes)
    ? (content.evidenceHashes as unknown[]).filter((h): h is string => typeof h === 'string' && HEX_64.test(h))
    : [];
  const openedAt = Number.isSafeInteger(e.created_at) && e.created_at >= 0 ? e.created_at : -1;
  const deadline = Number(tagValue(e, 'deadline'));
  if (openedAt < 0 || !Number.isSafeInteger(deadline)) return null;

  return {
    disputeId: e.id,
    author,
    marketId,
    escrowId,
    challengerPubkey: challenger,
    respondentPubkey: challenger === a ? b : a,
    proposedOutcome: typeof content.proposedOutcome === 'string' ? content.proposedOutcome : (tagValue(e, 'proposed') ?? ''),
    originalOutcome: typeof content.originalOutcome === 'string' ? content.originalOutcome : (tagValue(e, 'original') ?? ''),
    evidenceHashes: evidence,
    openedAt,
    deadline,
  };
}

/**
 * Verify one kind-39007 attestation against the dispute + escrow context.
 * Wrapper over the SAME verifier the release gate uses (round-2 rule: GUI and
 * backend can never disagree about what a verdict is).
 */
export function verifyAttestationForDispute(
  e: CourtEvent,
  dispute: FoldedDispute,
  ctx: FoldContext,
): { valid: true; winnerPubkey: string } | { valid: false; error: string } {
  const res = verifyEscrowCourtAttestation(e as Parameters<typeof verifyEscrowCourtAttestation>[0], {
    dispute: {
      disputeId: dispute.disputeId,
      marketId: dispute.marketId,
      challengerPubkey: dispute.challengerPubkey,
      respondentPubkey: dispute.respondentPubkey,
      evidenceHashes: dispute.evidenceHashes,
      proposedOutcome: dispute.proposedOutcome,
    },
    partyAPubkey: ctx.partyAPubkey,
    partyBPubkey: ctx.partyBPubkey,
    courtGroupPubkey: ctx.courtGroupPubkey,
  });
  if (!res.valid || !res.winnerPubkey) return { valid: false, error: res.error ?? 'attestation rejected' };
  return { valid: true, winnerPubkey: res.winnerPubkey };
}

/**
 * Fold the relay event set into the status view for ONE dispute.
 * At most ONE verified verdict wins; any failed attestation surfaces as
 * invalid evidence, never as a verdict (fail-closed).
 */
export function foldDisputeStatus(
  events: readonly CourtEvent[],
  disputeEventId: string,
  ctx: FoldContext,
): DisputeStatusView | null {
  const disputeEvent = events.find((e) => e.id === disputeEventId);
  if (!disputeEvent) return null;
  const dispute = parseDisputeEvent(disputeEvent, ctx);
  if (!dispute) return null;

  const phases: PhaseBound[] = computePhaseBounds(dispute.openedAt, ESCROW_DISPUTE_APPEAL_TIMINGS).map((p) => ({
    phase: p.phase,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
  }));
  const activePhase = getActivePhase(dispute.openedAt, ctx.nowSeconds, ESCROW_DISPUTE_APPEAL_TIMINGS);

  let terminal: DisputeTerminal = { kind: 'active' };
  for (const e of events) {
    if (e.kind !== BAO_COURT_ATTESTATION_KIND) continue;
    const bound = (tagValue(e, 'dispute') ?? '').toLowerCase();
    if (bound && bound !== dispute.disputeId.toLowerCase()) continue;
    const res = verifyAttestationForDispute(e, dispute, ctx);
    if (res.valid) {
      terminal = { kind: 'verdict', winnerPubkey: res.winnerPubkey, attestationEventId: e.id };
      break;
    }
    if (terminal.kind === 'active') terminal = { kind: 'invalid_attestation', error: res.error };
  }

  return {
    dispute,
    phases,
    activePhase,
    canStillResolveInTime: escrowCourtCanResolveInTime(Math.max(0, ctx.nowSeconds - dispute.openedAt)),
    terminal,
  };
}

/**
 * S1 preconditions for opening a dispute (design §2 S1): one live dispute per
 * escrow, and the refund-race time gate. Returns a typed result the modal
 * renders directly; never throws.
 */
export type OpenDisputeCheck =
  | { ok: true }
  | { ok: false; code: 'dispute_already_open' }
  | { ok: false; code: 'court_cannot_beat_refund' };

export function canOpenDispute(input: {
  elapsedSeconds: number;
  existingDispute: FoldedDispute | null;
}): OpenDisputeCheck {
  if (input.existingDispute) return { ok: false, code: 'dispute_already_open' };
  if (!escrowCourtCanResolveInTime(input.elapsedSeconds)) return { ok: false, code: 'court_cannot_beat_refund' };
  return { ok: true };
}

/** Round-3 role-specific refund-race copy (the warning is asymmetric). */
export function refundRaceCopy(role: 'donor' | 'founder'): string {
  return role === 'donor'
    ? 'If the jury does not finish in time, your pledge refunds automatically - the founder gets nothing.'
    : 'If the jury does not finish in time, the refund wins and the escrow closes.';
}
