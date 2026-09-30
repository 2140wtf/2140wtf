/**
 * dkgConsole — the S7 operator console fold (COURT-GUI-WIRING-DESIGN.md §S7,
 * "aggregator + DKG host-key ceremonies stay engine/bot-side in v1").
 *
 * Read-only and key-free: this is a TRANSPORT-VIEW fold over the public DKG
 * ceremony events on the relay. It NEVER holds shares, NEVER runs the
 * IndependentDkgSession (that is the key-holding engine half), and NEVER
 * mutates anything. Its job is to answer, for a court operator watching an
 * escrow's ceremony:
 *
 *   - which machine phase the ceremony is in and when it expires;
 *   - who has published round-1 commitments / round-2 encrypted shares and
 *     who is MISSING (the actionable part — a stalling juror is the thing an
 *     operator can actually do something about);
 *   - what complaints (kind 38032) exist against whom;
 *   - whether the ceremony has expired/aborted per the pure DKG machine.
 *
 * Keying: the operator asks by ESCROW id (the same key as `/dispute`). The
 * fold derives the dispute id from the newest kind-38025 dispute bound to
 * `escrow:<id>` — ceremony events (38031/39003/38032/39100) all carry
 * `['dispute', <disputeId>]`/`d` tags keyed by that 38025 event id.
 *
 * Machine replay uses the vendored pure reducer (courtDkgMachine): the SAME
 * transition rules jurors run, so the console cannot show a phase the real
 * ceremony could not be in. Transition errors during replay (out-of-order
 * or malformed publishes) are surfaced as warnings, never crash the view.
 *
 * Honesty rules:
 *   - Wire events are consumed as given; the caller is responsible for
 *     signature verification upstream (same contract as the dispute fold).
 *   - Transcript finalize/certification (machine phases after round 2) are
 *     coordinator actions on the aggregator host in v1 — no public event
 *     carries them, so the console reports `awaiting_transcript_finalize`
 *     instead of inventing a certified phase.
 *   - No dispute found → `found: false`, never a fabricated roster.
 */
import { createCourtDkgMachine, reduceCourtDkgMachine, CourtDkgTransitionError, type CourtDkgMachineEvent, type CourtDkgMachineState } from '@/baofund/court-core/courtDkgMachine';
import { parseDkgCommitmentEvent } from '@/baofund/court-core/events';
import { parseEncryptedShareEvent, parseDkgComplaintEvent, BAO_COURT_ENCRYPTED_SHARE_KIND, BAO_COURT_DKG_COMPLAINT_KIND, BAO_COURT_SHARE_BACKUP_KIND } from '@/baofund/court-core/dkgMessages';
import { computePhaseBounds } from '@/baofund/court-core/appealTiming';
import { ESCROW_DISPUTE_APPEAL_TIMINGS, ESCROW_MARKET_PREFIX } from './escrowCourt';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { CourtEvent } from './disputeStatus';

export const DKG_CEREMONY_KINDS = [
  38031, // DKG commitment (round 1)
  BAO_COURT_ENCRYPTED_SHARE_KIND, // 39003 (round 2)
  BAO_COURT_DKG_COMPLAINT_KIND, // 38032
  BAO_COURT_SHARE_BACKUP_KIND, // 39100
] as const;

/** strfry indexes single-char tags generically; every ceremony event carries
 *  `['e', disputeId, '', 'root']`, so this finds the ceremony on any NIP-01
 *  relay without needing author pubkeys (jurors are unknown pre-selection). */
export function dkgCeremonyFilter(disputeId: string): Record<string, unknown> {
  return { kinds: [...DKG_CEREMONY_KINDS], '#e': [disputeId] };
}

export interface DkgConsoleInput {
  /** The escrow id the operator asks about (`escrow:<id>` market binding). */
  readonly escrowId: string;
  /** Newest kind-38025 dispute for the escrow (deadline anchor); its event
   *  id is the ceremony key. Null → nothing to show but honesty. */
  readonly disputeEvent: CourtEvent | null;
  /** Kind-39002 selection (roster source); null → ceremony cannot have started. */
  readonly selectionEvent: CourtEvent | null;
  readonly ceremonyEvents: readonly CourtEvent[];
  readonly nowSeconds: number;
}

export interface DkgComplaintView {
  readonly victimIdx: number;
  readonly accusedIdx: number;
  readonly victimPubkey: string;
  readonly accusedPubkey: string;
  readonly shareEventId: string;
  readonly at: number;
  readonly hasDefense: boolean;
}

export interface DkgConsoleView {
  readonly escrowId: string;
  /** The ceremony key (the bound 38025 event id), null before a dispute. */
  readonly disputeId: string | null;
  /** False when no dispute exists for the escrow. */
  readonly found: boolean;
  /** Machine phase during replay, or the transport hints below. */
  readonly phase:
    | 'no_dispute'
    | 'not_selected'
    | 'not_started'
    | 'awaiting_transcript_finalize'
    | CourtDkgMachineState['phase'];
  /** DKG-window deadline (unix seconds) from the dispute anchor, or null. */
  readonly deadline: number | null;
  readonly expired: boolean;
  readonly roster: ReadonlyArray<{ idx: number; pubkey: string }>;
  readonly round1: ReadonlyArray<{ idx: number; pubkey: string; at: number }>;
  readonly round2: ReadonlyArray<{ idx: number; at: number; shares: number }>;
  readonly missingRound1: readonly number[];
  readonly missingRound2: readonly number[];
  readonly complaints: readonly DkgComplaintView[];
  readonly backups: number;
  readonly failure: string | null;
  readonly warnings: readonly string[];
}

/** The machine's sessionHash is a v1 coordinator-internal value not carried
 *  by any public event; the selection seed (or a domain-separated hash of the
 *  dispute id) is the deterministic stand-in the operator replays with. */
function sessionHashFor(disputeId: string, selectionSeed: string | null): string {
  if (selectionSeed && /^[0-9a-f]{64}$/.test(selectionSeed)) return selectionSeed;
  return bytesToHex(sha256(new TextEncoder().encode(`BAO-Court/dkgConsoleSession/${disputeId}`)));
}

function disputeTagOf(e: CourtEvent): string {
  return e.tags.find((t) => t[0] === 'dispute')?.[1] ?? '';
}

/**
 * The escrow a raw 38025 event binds to — the same field precedence as the
 * courtStatus summarizer (`content.marketId`, then the `market` tag) so the
 * two views can never disagree about which dispute belongs to which escrow.
 */
function disputeEscrowId(e: CourtEvent): string | null {
  let marketId = '';
  try {
    const content = JSON.parse(e.content || '{}') as Record<string, unknown>;
    if (typeof content.marketId === 'string' && content.marketId) marketId = content.marketId;
  } catch {
    /* malformed content - fall through to the tag */
  }
  if (!marketId) marketId = e.tags.find((t) => t[0] === 'market')?.[1] ?? '';
  if (!marketId.startsWith(ESCROW_MARKET_PREFIX)) return null;
  return marketId.slice(ESCROW_MARKET_PREFIX.length);
}

/** Pure fold — every clock read is `input.nowSeconds`. */
export function foldDkgConsole(input: DkgConsoleInput): DkgConsoleView {
  const warnings: string[] = [];
  const empty = {
    deadline: null, expired: false,
    roster: [] as ReadonlyArray<{ idx: number; pubkey: string }>,
    round1: [] as ReadonlyArray<{ idx: number; pubkey: string; at: number }>,
    round2: [] as ReadonlyArray<{ idx: number; at: number; shares: number }>,
    missingRound1: [] as readonly number[],
    missingRound2: [] as readonly number[],
    complaints: [] as ReadonlyArray<DkgComplaintView>,
    backups: 0, failure: null, warnings,
  };
  if (!input.disputeEvent) {
    return { escrowId: input.escrowId, disputeId: null, found: false, phase: 'no_dispute', ...empty };
  }
  const disputeId = input.disputeEvent.id;

  // Roster from the newest selection event bound to this dispute.
  let roster: Array<{ idx: number; pubkey: string }> = [];
  let selectionSeed: string | null = null;
  for (const e of [...input.ceremonyEvents, ...(input.selectionEvent ? [input.selectionEvent] : [])]) {
    if (e.kind !== 39002 || disputeTagOf(e) !== disputeId) continue;
    try {
      const content = JSON.parse(e.content || '{}') as { selected?: Array<{ idx?: unknown; pubkey?: unknown }>; seed?: unknown };
      const selected = Array.isArray(content.selected) ? content.selected : [];
      const parsed = selected
        .map((j) => ({ idx: Number(j.idx), pubkey: String(j.pubkey ?? '') }))
        .filter((j) => Number.isInteger(j.idx) && j.idx >= 1 && /^[0-9a-f]{64}$/.test(j.pubkey));
      if (parsed.length > 0) { roster = parsed; selectionSeed = typeof content.seed === 'string' ? content.seed : null; }
    } catch { warnings.push(`selection event ${e.id.slice(0, 8)}… has malformed content`); }
  }
  if (roster.length === 0) {
    return {
      escrowId: input.escrowId, disputeId, found: true, phase: 'not_selected', ...empty,
      deadline: null,
    };
  }

  // Deadline from the dispute anchor through the same appeal timings the
  // GUI phases use (the DKG window is one segment of that pipeline).
  const bounds = computePhaseBounds(input.disputeEvent.created_at, ESCROW_DISPUTE_APPEAL_TIMINGS);
  const dkgWindow = bounds.find((b) => b.phase === 'dkg');
  const deadline = dkgWindow?.endsAt ?? null;

  const indices = roster.map((r) => r.idx).sort((a, b) => a - b);
  let state = createCourtDkgMachine({
    sessionHash: sessionHashFor(disputeId, selectionSeed),
    participantIndices: indices,
    deadline: deadline ?? Number.MAX_SAFE_INTEGER - 1,
  });
  const apply = (event: CourtDkgMachineEvent): void => {
    try { state = reduceCourtDkgMachine(state, event); } catch (err) {
      if (err instanceof CourtDkgTransitionError) warnings.push(err.message);
      else throw err;
    }
  };
  apply({ type: 'start', now: input.disputeEvent.created_at });

  // Round 1: commitments, oldest first (replay order matters to the machine).
  const round1: Array<{ idx: number; pubkey: string; at: number }> = [];
  for (const e of [...input.ceremonyEvents].sort((a, b) => a.created_at - b.created_at)) {
    if (e.kind !== 38031 || disputeTagOf(e) !== disputeId) continue;
    const c = parseDkgCommitmentEvent({ ...e, tags: [...e.tags] });
    if (!c) { warnings.push(`commitment event ${e.id.slice(0, 8)}… failed strict parse`); continue; }
    round1.push({ idx: c.jurorIdx, pubkey: c.jurorPubkey, at: e.created_at });
    apply({ type: 'accept_round_1', idx: c.jurorIdx, now: e.created_at });
  }

  // Round 2: encrypted shares; a juror participates when ANY share targets
  // them, and the console counts deliveries per target for the operator.
  const sharesByTarget = new Map<number, { at: number; shares: number }>();
  for (const e of [...input.ceremonyEvents].sort((a, b) => a.created_at - b.created_at)) {
    if (e.kind !== BAO_COURT_ENCRYPTED_SHARE_KIND || disputeTagOf(e) !== disputeId) continue;
    const s = parseEncryptedShareEvent({ ...e, tags: [...e.tags] });
    if (!s) { warnings.push(`share event ${e.id.slice(0, 8)}… failed strict parse`); continue; }
    const cur = sharesByTarget.get(s.toIdx) ?? { at: e.created_at, shares: 0 };
    cur.shares += 1;
    sharesByTarget.set(s.toIdx, cur);
    apply({ type: 'accept_round_2', idx: s.toIdx, now: e.created_at });
  }
  const round2 = [...sharesByTarget.entries()]
    .map(([idx, v]) => ({ idx, at: v.at, shares: v.shares }))
    .sort((a, b) => a.idx - b.idx);

  apply({ type: 'tick', now: input.nowSeconds });

  // Complaints are surfaced verbatim (strict-parsed); resolution belongs to
  // the engine session, not the operator view.
  const complaints: DkgComplaintView[] = [];
  for (const e of input.ceremonyEvents) {
    if (e.kind !== BAO_COURT_DKG_COMPLAINT_KIND || disputeTagOf(e) !== disputeId) continue;
    const c = parseDkgComplaintEvent({ ...e, tags: [...e.tags] });
    if (!c) { warnings.push(`complaint event ${e.id.slice(0, 8)}… failed strict parse`); continue; }
    let hasDefense = false;
    try { hasDefense = Boolean((JSON.parse(e.content || '{}') as { defense?: string }).defense); } catch { /* malformed already warned upstream */ }
    complaints.push({
      victimIdx: c.victimIdx, accusedIdx: c.accusedIdx,
      victimPubkey: c.victimPubkey, accusedPubkey: c.accusedPubkey,
      shareEventId: c.encryptedShareEventId, at: e.created_at,
      hasDefense,
    });
  }
  complaints.sort((a, b) => a.at - b.at);

  const backups = input.ceremonyEvents.filter(
    (e) => e.kind === BAO_COURT_SHARE_BACKUP_KIND && disputeTagOf(e) === disputeId,
  ).length;

  const missing1 = indices.filter((i) => !round1.some((r) => r.idx === i));
  const missing2 = indices.filter((i) => !sharesByTarget.has(i));
  const round2Complete = missing2.length === 0;
  const phase = state.phase === 'dkg_round_2' && round2Complete
    ? 'awaiting_transcript_finalize' as const
    : state.phase;

  return {
    escrowId: input.escrowId,
    disputeId,
    found: true,
    phase,
    deadline,
    expired: state.phase === 'expired' || (deadline !== null && input.nowSeconds >= deadline && !round2Complete),
    roster,
    round1: round1.sort((a, b) => a.idx - b.idx),
    round2,
    missingRound1: missing1,
    missingRound2: missing2,
    complaints,
    backups,
    failure: state.failure ? `${state.failure.phase}: ${state.failure.reason}` : null,
    warnings,
  };
}

export interface DkgConsoleQuery {
  readonly relayUrl: string;
  /** The escrow id (`escrow:<id>` market binding on a kind-38025 dispute). */
  readonly escrowId: string;
  /** Both escrow parties REQUIRED — the same strfry pubkey-index constraint
   *  as the dispute read; the 38025 anchor is found through them. */
  readonly partyA: string;
  readonly partyB: string;
  readonly nowSeconds: number;
  readonly timeoutMs?: number;
}

/** One-shot NIP-01 REQ collector (same transport discipline as courtStatus). */
function readRelay(url: string, filters: readonly unknown[], timeoutMs: number): Promise<CourtEvent[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const events: CourtEvent[] = [];
    const subId = `dkg-console-${Math.random().toString(36).slice(2, 8)}`;
    const t = setTimeout(() => {
      try { ws.close(); } catch { /* already closed */ }
      reject(new Error('relay timeout'));
    }, timeoutMs);
    ws.onopen = () => {
      try { ws.send(JSON.stringify(['REQ', subId, ...filters])); } catch { /* onerror handles */ }
    };
    ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(String((m as MessageEvent).data)) as unknown[];
        if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) events.push(msg[2] as CourtEvent);
        if (msg[0] === 'EOSE' && msg[1] === subId) {
          clearTimeout(t);
          try { ws.send(JSON.stringify(['CLOSE', subId])); ws.close(); } catch { /* done */ }
          resolve(events);
        }
      } catch { /* ignore malformed frames */ }
    };
    ws.onerror = () => {
      clearTimeout(t);
      try { ws.close(); } catch { /* already closed */ }
      reject(new Error('relay error'));
    };
  });
}

/** Relay-backed read used by the bot context; never throws (typed view). */
export async function fetchDkgConsole(query: DkgConsoleQuery): Promise<DkgConsoleView> {
  const timeoutMs = query.timeoutMs ?? 8000;
  const onError = (warning: string): DkgConsoleView => ({
    escrowId: query.escrowId, disputeId: null, found: false, phase: 'no_dispute',
    deadline: null, expired: false,
    roster: [], round1: [], round2: [], missingRound1: [], missingRound2: [],
    complaints: [], backups: 0, failure: null, warnings: [warning],
  });
  try {
    const parties = [query.partyA, query.partyB];
    const requested = query.escrowId.toLowerCase();
    const disputeEvents = await readRelay(query.relayUrl, [{ kinds: [38025], authors: parties }], timeoutMs);
    const disputeEvent = disputeEvents
      .filter((e) => e.kind === 38025 && disputeEscrowId(e)?.toLowerCase() === requested)
      .sort((a, b) => b.created_at - a.created_at)[0] ?? null;
    if (!disputeEvent) return onError('no dispute found for escrow');
    const disputeId = disputeEvent.id;
    const selectionEvents = await readRelay(query.relayUrl, [{ kinds: [39002], '#e': [disputeId], limit: 1 }], timeoutMs);
    const ceremonyEvents = await readRelay(query.relayUrl, [dkgCeremonyFilter(disputeId)], timeoutMs);
    return foldDkgConsole({
      escrowId: query.escrowId,
      disputeEvent,
      selectionEvent: selectionEvents[0] ?? null,
      ceremonyEvents,
      nowSeconds: query.nowSeconds,
    });
  } catch {
    return onError('relay error');
  }
}
