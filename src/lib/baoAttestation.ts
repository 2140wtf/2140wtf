/**
 * ₿AO Fund v3 — donor attestation (L2) client, DEMO mode.
 *
 * Implements the frontend half of the layered milestone-resolution spec
 * (docs/BAO_FUND_RESOLUTION.md v0.2): proof-of-work submission by the
 * campaign owner, donor objections, and sats-weighted donor ballots — all
 * carried as signed Nostr events POSTed to the bao.markets API.
 *
 *   kind 37107 — proof-of-work.   d-tag = milestone market_id, author = owner.
 *   kind 33831 — attestation ballot. d-tag = <market_id>:<round_no>,
 *                e-tag = round trigger event, tag vote=yes|no. Addressable per
 *                (voter, milestone, round): latest valid ballot wins, so
 *                re-voting before window close is free.
 *   kind 36789 — resolution artifact (published by the oracle/backend, NOT by
 *                this client; parsed here for display only). d = market_id,
 *                rank = 100 YES / 0 NO.
 *
 * Auth: the signed event itself authenticates these endpoints (the author
 * must be the campaign owner for proofs, a ring donor for objections and
 * ballots) — no separate NIP-98 header is sent. The backend re-verifies
 * every event (author, round binding, window discipline, snapshot weights);
 * anything this client computes is advisory only.
 *
 * DEMO: the bao.markets instance runs on signet with recorded-only sats.
 */

import type { NostrEvent } from '@nostrify/nostrify';

import { baoApiBase, baoApiDate } from '@/lib/baoFundraising';

export const BAO_PROOF_OF_WORK_KIND = 37107;
export const BAO_ATTESTATION_BALLOT_KIND = 33831;
export const BAO_RESOLUTION_ARTIFACT_KIND = 36789;

/** Quorum: ≥50% of ring weight (by sats) must cast a ballot (spec §2). */
export const ATTESTATION_QUORUM_PCT = 50;
/** Outcome: majority of cast sats decides — YES wins ties; NO needs only a
 * bare majority of cast to resolve NO and refund the milestone. */
export const ATTESTATION_NO_MAJORITY_PCT = 50;
/** Sabotage tax threshold: a NO outcome routes 2% of the milestone to the
 * runner only when NO reaches ≥2/3 of cast sats (spec §2). */
export const ATTESTATION_TAX_THRESHOLD_PCT = 200 / 3;
/** Share of the milestone routed to the runner on a ≥⅔ NO resolution (sabotage tax). */
export const ATTESTATION_SABOTAGE_TAX_PCT = 2;

// ── Types mirroring GET …/attestation ────────────────────────────────────────

/** Donor ring frozen at the objection trigger: pubkey → weight in sats. */
export type RingSnapshot =
  | Record<string, number>
  | Array<{ pubkey: string; weight_sats: number }>
  | string[];

export interface AttestationBallot {
  voter_pubkey: string;
  vote: 'yes' | 'no';
  weight_sats: number;
}

export interface AttestationTally {
  yes_sats: number;
  no_sats: number;
  cast_sats: number;
  ring_total_sats: number;
  quorum_reached: boolean;
  voters: number;
}

export interface AttestationRound {
  id: string;
  round_no: number;
  /** 'objection' | 'timeout' | 'extension' (backend-defined). */
  trigger_type: string;
  /** Event this round is bound to (objection/proof); ballots must e-tag it. */
  trigger_event_id: string | null;
  window_open: number | string | null;
  window_close: number | string | null;
  extended: boolean;
  snapshot: RingSnapshot;
  ring_total_sats: number;
  outcome: 'yes' | 'no' | null;
  sabotage_tax_sats?: number;
  artifact_event_id?: string | null;
  ballots: AttestationBallot[];
  tally: AttestationTally;
  refund_distribution?: Record<string, number> | Array<{ pubkey: string; amount_sats: number }> | null;
}

export interface AttestationMilestoneState {
  proof_event_id: string | null;
  proof_submitted_at: number | string | null;
  objection_window_close: number | string | null;
  /** 'yes' | 'no' | 'default' (backend-defined strings tolerated). */
  attestation_resolution: string | null;
  attestation_artifact_id: string | null;
}

export interface MilestoneAttestation {
  milestone: AttestationMilestoneState;
  rounds: AttestationRound[];
}

// ── Pure helpers (no nostr — unit-testable in isolation) ─────────────────────

/** Milliseconds until a window closes (never negative). Accepts API date shapes. */
export function timeLeft(close: number | string | null | undefined, now: number = Date.now()): number {
  const date = baoApiDate(close);
  if (!date) return 0;
  return Math.max(0, date.getTime() - now);
}

/** Human label for a remaining duration: "6d 3h", "4h 12m", "47m", "under a minute". */
export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'closed';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `${minutes}m`;
  const days = Math.floor(hours / 24);
  if (days < 1) return `${hours}h ${minutes % 60}m`;
  return `${days}d ${hours % 24}h`;
}

/** Percent of ring weight that has voted (0 when the ring is empty). */
export function quorumPct(castSats: number, ringTotalSats: number): number {
  if (!Number.isFinite(ringTotalSats) || ringTotalSats <= 0) return 0;
  return (Math.max(0, castSats) / ringTotalSats) * 100;
}

/** YES/NO split of cast sats as percentages; {0,0} when nothing was cast. */
export function tallyPct(yesSats: number, noSats: number): { yes: number; no: number } {
  const cast = yesSats + noSats;
  if (!Number.isFinite(cast) || cast <= 0) return { yes: 0, no: 0 };
  return { yes: (yesSats / cast) * 100, no: (noSats / cast) * 100 };
}

/** A donor's frozen ring weight in sats, or null when they are not in the ring. */
export function snapshotWeight(snapshot: RingSnapshot | null | undefined, pubkey: string): number | null {
  if (!snapshot || !pubkey) return null;
  if (Array.isArray(snapshot)) {
    for (const entry of snapshot) {
      if (typeof entry === 'string') {
        if (entry === pubkey) return 0; // legacy shape: membership list without weights
      } else if (entry && entry.pubkey === pubkey) {
        return Number(entry.weight_sats) || 0;
      }
    }
    return null;
  }
  if (typeof snapshot === 'object') {
    const w = snapshot[pubkey];
    return w === undefined ? null : Number(w) || 0;
  }
  return null;
}

/** Only ring donors (pubkey in the round snapshot) can vote or object (spec §5). */
export function canUserVote(snapshot: RingSnapshot | null | undefined, pubkey: string | null | undefined): boolean {
  if (!pubkey) return false;
  return snapshotWeight(snapshot, pubkey) !== null;
}

/** The latest ballot a voter has cast in a round (re-votes replace earlier ones). */
export function voterBallot(round: AttestationRound, pubkey: string | null | undefined): AttestationBallot | null {
  if (!pubkey) return null;
  return round.ballots.find((b) => b.voter_pubkey === pubkey) ?? null;
}

/** A round is live until the backend records an outcome for it. */
export function isRoundOpen(round: AttestationRound): boolean {
  return round.outcome === null || round.outcome === undefined;
}

/** The currently-live round, if any. */
export function openRound(att: MilestoneAttestation | null | undefined): AttestationRound | null {
  return att?.rounds.find(isRoundOpen) ?? null;
}

/**
 * True while there is anything to poll for: proof submitted or a round open,
 * and no final resolution yet. Drives the react-query refetch interval —
 * settlement itself happens server-side the next time the fundraiser is
 * fetched after a window closes, so polling only matters while live.
 */
export function attestationActive(att: MilestoneAttestation | null | undefined): boolean {
  if (!att) return false;
  if (att.milestone.attestation_resolution) return false;
  return !!att.milestone.proof_event_id || att.rounds.length > 0;
}

/** Resolution label classification for badges. */
export function resolutionKind(att: MilestoneAttestation): 'yes' | 'no' | 'default' | null {
  const r = att.milestone.attestation_resolution;
  if (!r) return null;
  const norm = r.toLowerCase();
  if (norm === 'default' || norm === 'timeout' || norm === 'no_objection') return 'default';
  if (norm === 'no' || norm === 'rejected') return 'no';
  // A YES with no rounds ever run means the objection window lapsed quietly.
  if ((norm === 'yes' || norm === 'delivered') && att.rounds.length === 0) return 'default';
  if (norm === 'yes' || norm === 'delivered') return 'yes';
  return null;
}

// ── Event builders ───────────────────────────────────────────────────────────

export interface EventTemplate {
  kind: number;
  content: string;
  tags: string[][];
}

/**
 * kind-37107 proof-of-work (owner only). d-tag = the milestone's market id;
 * the deliverable link rides as an `r` tag, notes as content.
 */
export function buildProofOfWorkEvent(input: { marketId: string; deliverableUrl?: string; notes?: string }): EventTemplate {
  const tags: string[][] = [['d', input.marketId]];
  const url = input.deliverableUrl?.trim();
  if (url) tags.push(['r', url]);
  return {
    kind: BAO_PROOF_OF_WORK_KIND,
    content: input.notes?.trim() ?? '',
    tags,
  };
}

/**
 * kind-33831 objection — a donor calling the question. An objection IS an
 * early NO vote (spec §5), so it carries vote=no on round 1. It e-tags the
 * milestone's proof event; on the timeout path (deadline passed, no proof)
 * there is no proof to e-tag and the tag is omitted.
 */
export function buildObjectionEvent(input: {
  marketId: string;
  proofEventId?: string | null;
  reason?: string;
}): EventTemplate {
  const tags: string[][] = [['d', `${input.marketId}:1`]];
  if (input.proofEventId) tags.push(['e', input.proofEventId]);
  tags.push(['vote', 'no']);
  return {
    kind: BAO_ATTESTATION_BALLOT_KIND,
    content: input.reason?.trim() ?? '',
    tags,
  };
}

/** kind-33831 donor ballot for an open round. Latest valid ballot per voter wins. */
export function buildBallotEvent(input: {
  marketId: string;
  roundNo: number;
  triggerEventId: string;
  vote: 'yes' | 'no';
}): EventTemplate {
  return {
    kind: BAO_ATTESTATION_BALLOT_KIND,
    content: '',
    tags: [
      ['d', `${input.marketId}:${input.roundNo}`],
      ['e', input.triggerEventId],
      ['vote', input.vote],
    ],
  };
}

/** NIP-33 address of one voter's ballot: `33831:<pubkey>:<market_id>:<round_no>`. */
export function ballotAddress(pubkey: string, marketId: string, roundNo: number): string {
  return `${BAO_ATTESTATION_BALLOT_KIND}:${pubkey}:${marketId}:${roundNo}`;
}

/**
 * Parse a kind-36789 resolution artifact (oracle-published; display only).
 * Tag shape mirrors NIP-85: d = milestone market id, rank = 100 YES / 0 NO.
 */
export function parseResolutionArtifact(event: NostrEvent): { marketId: string; outcome: 'yes' | 'no' } | null {
  if (event.kind !== BAO_RESOLUTION_ARTIFACT_KIND) return null;
  const marketId = event.tags.find((t) => t[0] === 'd')?.[1];
  const rank = event.tags.find((t) => t[0] === 'rank')?.[1];
  if (!marketId || (rank !== '100' && rank !== '0')) return null;
  return { marketId, outcome: rank === '100' ? 'yes' : 'no' };
}

// ── API client ───────────────────────────────────────────────────────────────

interface SignerLike {
  signEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<{
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }>;
}

/** Sign a template and POST it as `{event}`; the signed event is the auth. */
async function postSignedEvent<T>(signer: SignerLike, path: string, template: EventTemplate): Promise<T> {
  const event = await signer.signEvent({ ...template, created_at: Math.floor(Date.now() / 1000) });
  const res = await fetch(`${baoApiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (json as { data: T }).data;
}

/** Owner submits proof-of-work → opens the donor objection window. */
export async function submitProof(
  signer: SignerLike,
  fundraiserId: string,
  milestoneId: string,
  input: { marketId: string; deliverableUrl?: string; notes?: string },
): Promise<unknown> {
  return postSignedEvent(
    signer,
    `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/milestones/${encodeURIComponent(milestoneId)}/proof`,
    buildProofOfWorkEvent(input),
  );
}

/**
 * Donor objection (an early NO vote). Pass the milestone's proof_event_id;
 * omit it for the timeout path (delivery deadline passed with no proof).
 */
export async function submitObjection(
  signer: SignerLike,
  fundraiserId: string,
  milestoneId: string,
  input: { marketId: string; proofEventId?: string | null; reason?: string },
): Promise<unknown> {
  return postSignedEvent(
    signer,
    `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/milestones/${encodeURIComponent(milestoneId)}/object`,
    buildObjectionEvent(input),
  );
}

/** Cast (or replace) a donor ballot in an open attestation round. */
export async function castBallot(
  signer: SignerLike,
  roundId: string,
  input: { marketId: string; roundNo: number; triggerEventId: string; vote: 'yes' | 'no' },
): Promise<unknown> {
  return postSignedEvent(
    signer,
    `/v1/rounds/${encodeURIComponent(roundId)}/ballots`,
    buildBallotEvent(input),
  );
}

/** Fetch the full attestation state for one milestone. */
export async function fetchAttestation(fundraiserId: string, milestoneId: string): Promise<MilestoneAttestation> {
  const res = await fetch(
    `${baoApiBase()}/v1/fundraisers/${encodeURIComponent(fundraiserId)}/milestones/${encodeURIComponent(milestoneId)}/attestation`,
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (json as { data: MilestoneAttestation }).data;
}
