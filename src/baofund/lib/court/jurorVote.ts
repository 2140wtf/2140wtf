/**
 * jurorVote - the S6 fold behind the Court panel's voting screen
 * (COURT-GUI-WIRING-DESIGN.md §2 S6).
 *
 * PURE: every input is injected - relay events, the roster (from the vendor
 * selection parse), and a clock. Tests pin `now`; the React layer never
 * makes a security decision itself.
 *
 * Security rules encoded here:
 *   - signature-verify every commit (39004) / reveal (39014) event BEFORE
 *     parsing (round-1 rule, same discipline as jurorCandidacy.ts) - and
 *     via `verifyCourtEvent`, the symbol-stripped re-verification immune
 *     to nostr-tools' `verifiedSymbol` memoization hazard;
 *   - a reveal is only admitted against a commit from the SAME pubkey at
 *     the SAME roster idx: no commit → the reveal is unprovable (dropped
 *     from the tally, listed as evidence of protocol violation);
 *   - commit/reveal match is the VENDOR's `hashCommit` math (never a
 *     hand-rolled hash - that is how two "same" commits diverge);
 *   - the tally is the vendor's `tallyVotes` (deterministic UTF-8
 *     tie-break, invalid reveals listed, never silently counted);
 *   - reveal window gating is deny-by-default: reveal before the commit
 *     phase ends → `commit_phase_open` (a revealed salt now would let
 *     anyone forge a matching commit retroactively).
 */
import {
  BAO_COURT_VOTE_COMMIT_KIND,
  BAO_COURT_VOTE_REVEAL_KIND,
  buildVoteCommitEvent,
  buildVoteRevealEvent,
  parseVoteCommitEvent,
  parseVoteRevealEvent,
} from '@/baofund/court-core/events.js';
import { hashCommit, tallyVotes, type TallyResult } from '@/baofund/court-core/dispute.js';
import type { JurorVote } from '@/baofund/court-core/types.js';
import { verifyCourtEvent, type CourtEvent } from './jurorCandidacy';
export type { CourtEvent };

/** A verified commit folded to UI shape. */
export interface FoldedCommit {
  readonly eventId: string;
  readonly disputeId: string;
  /** Roster index the juror committed under (vendor selection `idx`). */
  readonly jurorIdx: number;
  readonly pubkey: string;
  readonly commitHash: string;
  readonly createdAt: number;
}

/** A verified reveal folded to UI shape. */
export interface FoldedReveal {
  readonly eventId: string;
  readonly disputeId: string;
  readonly jurorIdx: number;
  readonly pubkey: string;
  readonly outcome: string;
  readonly salt: string;
  readonly createdAt: number;
}

/** One juror's position on the voting screen (commit → reveal → tally). */
export interface JurorVoteRow {
  readonly jurorIdx: number;
  readonly pubkey: string;
  readonly commit: FoldedCommit | null;
  readonly reveal: FoldedReveal | null;
  /** Reveal hash does NOT match the commit - counted as invalid, never as a vote. */
  readonly mismatch: boolean;
}

export type RevealWindow =
  | { open: true }
  | { open: false; reason: 'commit_phase_open' };

/** The signed selection's roster: lowercase juror pubkey → vendor `idx`.
 *  Authoritative when supplied - a vote is only counted from the pubkey the
 *  selection event seated at that exact index. */
export type VoteRoster = ReadonlyMap<string, number>;

export interface VoteView {
  readonly disputeId: string;
  readonly rows: readonly JurorVoteRow[];
  /** The vendor tally over admitted votes (invalid reveals listed, not counted). */
  readonly tally: TallyResult;
  /** Threshold from the vendor selection event - reveals needed to finalize. */
  readonly threshold: number;
  /** How many verified, commit-matching reveals exist so far. */
  readonly revealsSoFar: number;
  readonly finalized: boolean;
}

/** Relay query for a dispute's vote commits + reveals.
 *  Uses the single-char root `e` tag (dispute id): strfry only indexes
 *  single-character tag names, and vote `d` tags are suffixed per juror. */
export function votesFilter(disputeId: string): { kinds: number[]; '#e': string[]; limit: number } {
  return { kinds: [BAO_COURT_VOTE_COMMIT_KIND, BAO_COURT_VOTE_REVEAL_KIND], '#e': [disputeId], limit: 100 };
}

export function parseCommitEvent(e: CourtEvent): FoldedCommit | null {
  if (e.kind !== BAO_COURT_VOTE_COMMIT_KIND) return null;
  if (!verifyCourtEvent(e)) return null;
  const p = parseVoteCommitEvent(e as unknown as Parameters<typeof parseVoteCommitEvent>[0]);
  if (!p || !p.commitHash) return null;
  return {
    eventId: e.id,
    disputeId: p.disputeId,
    jurorIdx: p.jurorIdx,
    pubkey: p.pubkey.toLowerCase(),
    commitHash: p.commitHash,
    createdAt: e.created_at,
  };
}

export function parseRevealEvent(e: CourtEvent): FoldedReveal | null {
  if (e.kind !== BAO_COURT_VOTE_REVEAL_KIND) return null;
  if (!verifyCourtEvent(e)) return null;
  const p = parseVoteRevealEvent(e as unknown as Parameters<typeof parseVoteRevealEvent>[0]);
  if (!p || !p.outcome || !p.salt) return null;
  return {
    eventId: e.id,
    disputeId: p.disputeId,
    jurorIdx: p.jurorIdx,
    pubkey: p.pubkey.toLowerCase(),
    outcome: p.outcome,
    salt: p.salt,
    createdAt: e.created_at,
  };
}

/**
 * Is the reveal window open at the injected `now`? The commit phase ends at
 * the dispute deadline (the vendor dispute builder's `deadline` tag) - a
 * reveal BEFORE that would publish the salt while commits can still be
 * forged around it. Deny-by-default.
 */
export function revealWindow(deadlineSeconds: number, now: number): RevealWindow {
  return now >= deadlineSeconds ? { open: true } : { open: false, reason: 'commit_phase_open' };
}

/**
 * The full S6 view: folds commits + reveals into per-juror rows and the
 * vendor tally. Reveals are matched to commits by (pubkey, jurorIdx); a
 * reveal with no matching commit, or whose `hashCommit(outcome, salt)`
 * disagrees with the committed hash, is a MISMATCH row - evidence of a
 * protocol violation, never a counted vote.
 *
 * When `opts.roster` (the signed selection's pubkey → idx map) is supplied,
 * a row is additionally admitted ONLY when the roster seats that exact
 * pubkey at that exact idx: off-roster keys and double-votes across idx
 * values are flagged mismatch and excluded from the tally/finalization.
 */
export function foldVotes(
  disputeId: string,
  events: readonly CourtEvent[],
  opts: { threshold: number; deadlineSeconds: number; now: number; roster?: VoteRoster },
): VoteView {
  const commits = new Map<string, FoldedCommit>();
  const reveals = new Map<string, FoldedReveal>();
  for (const e of events) {
    if (e.kind === BAO_COURT_VOTE_COMMIT_KIND) {
      const c = parseCommitEvent(e);
      if (c && c.disputeId === disputeId) {
        const k = `${c.pubkey}:${c.jurorIdx}`;
        const cur = commits.get(k);
        // Latest created_at wins; same-timestamp keeps the lower event id
        // (deterministic, order-independent).
        if (!cur || c.createdAt > cur.createdAt || (c.createdAt === cur.createdAt && c.eventId < cur.eventId)) {
          commits.set(k, c);
        }
      }
    } else if (e.kind === BAO_COURT_VOTE_REVEAL_KIND) {
      const r = parseRevealEvent(e);
      if (r && r.disputeId === disputeId) {
        const k = `${r.pubkey}:${r.jurorIdx}`;
        const cur = reveals.get(k);
        if (!cur || r.createdAt > cur.createdAt || (r.createdAt === cur.createdAt && r.eventId < cur.eventId)) {
          reveals.set(k, r);
        }
      }
    }
  }

  const rows: JurorVoteRow[] = [];
  const votes: JurorVote[] = [];
  const keys = new Set<string>([...commits.keys(), ...reveals.keys()]);
  for (const k of keys) {
    const commit = commits.get(k) ?? null;
    const reveal = reveals.get(k) ?? null;
    let mismatch = false;
    let vendorVote: JurorVote | null = null;
    if (commit) {
      vendorVote = { idx: commit.jurorIdx, pubkey: commit.pubkey, commit: commit.commitHash };
      if (reveal) {
        // Reveals published BEFORE the reveal window opens are invalid: the
        // commit phase is where the salt is still secret, and an early reveal
        // would let others forge commits around a public salt.
        if (reveal.createdAt < opts.deadlineSeconds) {
          mismatch = true;
        } else {
          vendorVote = { ...vendorVote, reveal: { outcome: reveal.outcome, salt: reveal.salt } };
          if (hashCommit(reveal.outcome, reveal.salt) !== commit.commitHash) mismatch = true;
        }
      }
    } else if (reveal) {
      // Reveal without commit: unprovable - a violation row, never a vote.
      mismatch = true;
    }
    // Roster binding: when the signed selection is supplied, a vote is only
    // admitted from the pubkey seated at that exact idx. Without this, any
    // key could vote under a stolen/duplicate idx and one seated juror could
    // stuff the tally by committing/revealing under several idx values.
    if (opts.roster) {
      const pubkey = commit?.pubkey ?? reveal?.pubkey ?? '';
      const jurorIdx = commit?.jurorIdx ?? reveal?.jurorIdx ?? 0;
      if (opts.roster.get(pubkey) !== jurorIdx) {
        mismatch = true;
        vendorVote = null;
      }
    }
    if (vendorVote) votes.push(vendorVote);
    const idx = commit?.jurorIdx ?? reveal?.jurorIdx ?? 0;
    const pubkey = commit?.pubkey ?? reveal?.pubkey ?? '';
    rows.push({ jurorIdx: idx, pubkey, commit, reveal, mismatch });
  }
  rows.sort((a, b) => a.jurorIdx - b.jurorIdx || a.pubkey.localeCompare(b.pubkey));

  const tally = tallyVotes(votes);
  const revealsSoFar = rows.filter((r) => r.reveal && !r.mismatch).length;
  return {
    disputeId,
    rows,
    tally,
    threshold: opts.threshold,
    revealsSoFar,
    finalized: opts.threshold > 0 && revealsSoFar >= opts.threshold,
  };
}

/**
 * Build the commit template the signer signs. The commit hash is the
 * VENDOR's `hashCommit(outcome, salt)`; the salt is generated by the caller
 * (crypto.getRandomValues) and MUST be kept local until reveal - losing it
 * forfeits the bond (α=1.0 non-reveal slashing).
 */
export function commitTemplate(params: {
  disputeId: string;
  jurorIdx: number;
  outcome: string;
  salt: string;
  publisherPubkey: string;
  nowSeconds: number;
}): { kind: number; created_at: number; tags: string[][]; content: string } & { commitHash: string } {
  const commitHash = hashCommit(params.outcome, params.salt);
  // vendor builder stamps its own created_at; we pass ours through by
  // overriding after the call to keep the fold pure (injected clock).
  const t = buildVoteCommitEvent({
    disputeId: params.disputeId,
    jurorIdx: params.jurorIdx,
    commitHash,
    publisherPubkey: params.publisherPubkey,
  }) as { kind: number; created_at: number; tags: string[][]; content: string };
  return { ...t, created_at: params.nowSeconds, commitHash };
}

/** Build the reveal template (outcome + salt go PUBLIC here). */
export function revealTemplate(params: {
  disputeId: string;
  jurorIdx: number;
  outcome: string;
  salt: string;
  publisherPubkey: string;
  nowSeconds: number;
}): { kind: number; created_at: number; tags: string[][]; content: string } {
  const t = buildVoteRevealEvent({
    disputeId: params.disputeId,
    jurorIdx: params.jurorIdx,
    outcome: params.outcome,
    salt: params.salt,
    publisherPubkey: params.publisherPubkey,
  }) as { kind: number; created_at: number; tags: string[][]; content: string };
  return { ...t, created_at: params.nowSeconds };
}
