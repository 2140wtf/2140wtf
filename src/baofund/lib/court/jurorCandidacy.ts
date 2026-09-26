/**
 * jurorCandidacy - the S4 fold behind the Court panel's candidacy card
 * (COURT-GUI-WIRING-DESIGN.md §2 S4, rounds 1–5).
 *
 * PURE: every input is injected - relay events, verification results, and a
 * clock. The React hook (useJurorCandidacy) supplies live events; tests pin
 * `now` and verification outcomes.
 *
 * Security rules encoded here:
 *   - signature-verify every 39001 event BEFORE parsing (round-1 rule, the
 *     same discipline as disputeStatus.ts) - malformed or unverified events
 *     are dropped, never rendered;
 *   - one candidacy per juror: latest created_at wins per pubkey, older
 *     editions are superseded (the vsk:1 full-restatement convention);
 *   - bond ownership is NOT asserted here - `verifyBond` results are
 *     injected, so the fold stays pure and the UI decides when to re-check;
 *   - the join gate is deny-by-default: bond below the computed requirement,
 *     a passed opt-in deadline, or a missing profile each refuse with the
 *     FIRST failing reason (cheapest-check-first ordering).
 */
import { verifyEvent } from 'nostr-tools/pure';
import {
  BAO_COURT_JUROR_CANDIDACY_KIND,
  BAO_COURT_DISPUTE_KIND,
  BAO_COURT_SELECTION_KIND,
  parseJurorCandidacyEvent,
} from '@/baofund/court-core/events.js';
import { calculateBondAmount } from '@/baofund/court-core/escrow.js';

/** Minimal structural event type (nostr-tools compatible). */
export interface CourtEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * TRUE signature verification, immune to the nostr-tools memoization
 * hazard: `finalizeEvent` stamps a hidden `verifiedSymbol = true` on the
 * event object and `verifyEvent` returns that cached flag when present -
 * so a locally-built event, an object spread of one, or an attacker-stamped
 * object would SKIP verification entirely. Stripping own symbols forces the
 * real hash+signature check to run on the actual bytes.
 */
export function verifyCourtEvent(e: CourtEvent): boolean {
  const stripped = { ...e } as Record<PropertyKey, unknown>;
  for (const sym of Object.getOwnPropertySymbols(stripped)) delete stripped[sym as unknown as string];
  try {
    return verifyEvent(stripped as Parameters<typeof verifyEvent>[0]);
  } catch {
    return false;
  }
}

/** A verified candidacy folded to UI shape (vendor JurorProfile + bond). */
export interface FoldedCandidacy {
  eventId: string;
  jurorPubkey: string;
  createdAt: number;
  disputeId: string;
  marketId: string;
  stakeCapacitySats: number;
  wotScore: number;
  categories: string[];
  bondAmountSats: number;
  bondAddress: string;
  bondTxid?: string;
  bondVout?: number;
  bondScriptPubKey?: string;
  deadlineSeconds?: number;
  /** Set by the caller after verifyBond succeeds (injected, not folded). */
  bondVerified: boolean;
}

export interface CandidacyFoldContext {
  /** Injected clock (Unix seconds). */
  nowSeconds: number;
  /** Map of `<txid>:<vout>` → bond-verification outcome (see verifyBond). */
  bondVerified: ReadonlyMap<string, boolean>;
}

/** Relay filter: all candidacies for one dispute.
 *  Uses the single-char root `e` tag (dispute id) because strfry only indexes
 *  single-character tag names - `#dispute` is refused as "unindexed". */
export function candidacyFilter(disputeId: string): { kinds: number[]; '#e': string[]; limit: number } {
  return { kinds: [BAO_COURT_JUROR_CANDIDACY_KIND], '#e': [disputeId], limit: 200 };
}

/** Relay filter: recent disputes a juror can browse (the pool to serve). */
export function allDisputesFilter(): { kinds: number[]; limit: number } {
  return { kinds: [BAO_COURT_DISPUTE_KIND], limit: 100 };
}

/** Relay filter: jury selections mentioning this pubkey (My Disputes). */
export function selectionsForJuror(pubkey: string): { kinds: number[]; '#p': string[]; limit: number } {
  return { kinds: [BAO_COURT_SELECTION_KIND], '#p': [pubkey.toLowerCase()], limit: 100 };
}

/**
 * Verify + parse one candidacy event. Returns null for anything that fails
 * signature verification, kind checks, or shape parsing - never throws.
 */
export function parseCandidacyEvent(e: CourtEvent): Omit<FoldedCandidacy, 'bondVerified'> | null {
  if (e.kind !== BAO_COURT_JUROR_CANDIDACY_KIND) return null;
  if (!verifyCourtEvent(e)) return null;
  const profile = parseJurorCandidacyEvent(e as unknown as Parameters<typeof parseJurorCandidacyEvent>[0]);
  if (!profile) return null;
  const dTag = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
  const disputeTag = e.tags.find((t) => t[0] === 'dispute')?.[1] ?? dTag;
  if (!disputeTag) return null;
  const marketTag = e.tags.find((t) => t[0] === 'market')?.[1];
  const txidTag = e.tags.find((t) => t[0] === 'bondTxid')?.[1];
  const voutTag = e.tags.find((t) => t[0] === 'bondVout')?.[1];
  const scriptTag = e.tags.find((t) => t[0] === 'bondScript')?.[1];
  const deadlineTag = e.tags.find((t) => t[0] === 'deadline')?.[1];
  const bondAmountSats = e.tags.find((t) => t[0] === 'bond')?.[1];
  const bondAddress = e.tags.find((t) => t[0] === 'address')?.[1] ?? '';
  return {
    eventId: e.id,
    jurorPubkey: e.pubkey.toLowerCase(),
    createdAt: e.created_at,
    disputeId: disputeTag,
    marketId: marketTag ?? '',
    stakeCapacitySats: profile.stakeCapacitySats,
    wotScore: profile.wotScore,
    categories: [...profile.categories],
    bondAmountSats: Number(bondAmountSats ?? 0),
    bondAddress,
    ...(txidTag ? { bondTxid: txidTag } : {}),
    ...(voutTag !== undefined ? { bondVout: Number(voutTag) } : {}),
    ...(scriptTag ? { bondScriptPubKey: scriptTag } : {}),
    ...(deadlineTag ? { deadlineSeconds: Number(deadlineTag) } : {}),
  };
}

/**
 * Fold the dispute's candidacies: verified events only, one edition per
 * juror (latest created_at wins; equal timestamps resolve by event-id to a
 * deterministic winner), sorted by stake capacity (selection weighting
 * order), each annotated with the injected bond-verification outcome.
 */
export function foldJurorCandidacies(
  events: readonly CourtEvent[],
  ctx: CandidacyFoldContext,
): FoldedCandidacy[] {
  const latest = new Map<string, Omit<FoldedCandidacy, 'bondVerified'>>();
  for (const e of events) {
    const parsed = parseCandidacyEvent(e);
    if (!parsed) continue;
    const current = latest.get(parsed.jurorPubkey);
    if (!current || parsed.createdAt > current.createdAt ||
        (parsed.createdAt === current.createdAt && parsed.eventId > current.eventId)) {
      latest.set(parsed.jurorPubkey, parsed);
    }
  }
  const out: FoldedCandidacy[] = [];
  for (const c of latest.values()) {
    const key = c.bondTxid && c.bondVout !== undefined ? `${c.bondTxid}:${c.bondVout}` : '';
    out.push({ ...c, bondVerified: key !== '' && ctx.bondVerified.get(key) === true });
  }
  out.sort((a, b) => b.stakeCapacitySats - a.stakeCapacitySats || a.jurorPubkey.localeCompare(b.jurorPubkey));
  return out;
}

/** The bond required for a dispute at this round (vendor math re-exported so
 *  the UI has one import site and the preview can never drift). */
export function bondRequired(marketVolumeSats: number, round: number): number {
  return calculateBondAmount(marketVolumeSats, round);
}

export type CandidacyJoinRejection =
  | 'bond_below_requirement'
  | 'opt_in_window_closed'
  | 'bond_not_verified'
  | 'missing_bond_proof';

export interface JoinGateInput {
  /** The bond the candidate intends to post (sats). */
  bondAmountSats: number;
  /** The bond the dispute requires (see bondRequired). */
  requiredBondSats: number;
  /** Opt-in deadline (Unix seconds), when the dispute declares one. */
  optInDeadlineSeconds?: number;
  /** Injected clock. */
  nowSeconds: number;
  /** The UTXO reference the candidacy will carry, when present. */
  bondTxid?: string;
  bondVout?: number;
  /** Injected verification outcome for that UTXO. */
  bondVerified?: boolean;
}

/**
 * Deny-by-default join gate. The FIRST failing reason is returned; only an
 * all-gates-pass input yields null (allowed).
 */
export function candidacyJoinRejection(input: JoinGateInput): CandidacyJoinRejection | null {
  if (input.bondAmountSats < input.requiredBondSats) return 'bond_below_requirement';
  if (input.optInDeadlineSeconds !== undefined && input.nowSeconds >= input.optInDeadlineSeconds) {
    return 'opt_in_window_closed';
  }
  if (!input.bondTxid || input.bondVout === undefined) return 'missing_bond_proof';
  if (input.bondVerified !== true) return 'bond_not_verified';
  return null;
}

/** Slashing conditions shown in the first-run explainer (vendor constants). */
export const SLASHING = {
  /** Incoherent vote slash fraction (voted, but lost + inconsistent). */
  incoherence: 0.5,
  /** Non-reveal / double-vote slash fraction (total bond loss). */
  nonReveal: 1.0,
} as const;
