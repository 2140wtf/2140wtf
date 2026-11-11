import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NRelay1, type NostrEvent, type NostrFilter } from "@nostrify/nostrify";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/useToast";
import { isVerifiedEvent } from "@/lib/nostrEvents";
import { courtProposalPin } from "@/lib/courtPins";
import { shortIdentifier } from "@/lib/displayText";
import { BAO_COURT_RELAY } from "@/lib/baoCourtRelays";
import { baoNip98Header } from "@/lib/baoApiAuth";
import { baoApiBase } from "@/lib/baoFundraising";

/** Jury selection / ladder & DKG summons (§5.3). */
export const SUMMONS_SELECTION_KIND = 39002;
/** Universal-confirmation outcome proposal / summons (§5.2). */
export const SUMMONS_PROPOSAL_KIND = 38026;

/**
 * Initial backfill lookback for the summons subscription (courtInbox
 * semantics). After the first ingest the since-cursor advances so later
 * sessions only fetch what happened since the last seen event.
 */
const INITIAL_LOOKBACK_SECONDS = 48 * 60 * 60;
const QUERY_LIMIT = 500;
const QUERY_TIMEOUT_MS = 15_000;
/** Bounded localStorage FIFOs (seen + acked event ids). */
const MAX_STORED_IDS = 500;
const SEEN_STORAGE_KEY = "bao-court-summons-seen";
const ACKED_STORAGE_KEY = "bao-court-summons-acked";
/**
 * Round 35 caps. ANYONE can publish a kind-39002/38026 `#p`-tagged to this
 * npub, so the notice list, the per-session dedupe set and the toast queue are
 * all attacker-fillable. None of these caps is a trust decision - they only
 * bound memory, DOM and notification spam.
 */
const MAX_SUMMONS = 200;
const MAX_INGESTED_IDS = 2_000;
const MAX_ANNOUNCEMENTS = 5;
/**
 * Round 36: individual toasts an UNATTRIBUTED publisher may consume. The
 * remaining {@link MAX_ANNOUNCEMENTS} - this budget is reserved for the pinned
 * court authority, so a flood of stranger notices cannot fill the toast queue
 * and silence a real summons that arrives a moment later.
 */
const MAX_UNATTRIBUTED_ANNOUNCEMENTS = 2;
/** Longest accepted case/market/outcome tag value (display + URL bound). */
const MAX_FIELD_CHARS = 512;
/** Longest failure reason surfaced from the API/exception path. */
const MAX_REASON_CHARS = 200;

export interface CourtSummonsNotice {
  /** Relay event id of the summons (dedupe + ack binding target). */
  readonly eventId: string;
  readonly kind: typeof SUMMONS_SELECTION_KIND | typeof SUMMONS_PROPOSAL_KIND;
  /** Case id: kind-39002 `dispute`/`d` tag, kind-38026 `d`/caseId. */
  readonly caseId: string;
  readonly marketId: string;
  readonly proposedOutcome: string | null;
  readonly createdAt: number;
  /** Pubkey that published the summons event (always NIP-01 verified). */
  readonly publisher: string;
  /**
   * True when the publisher is the pinned court authority
   * (`courtProposalPin()`). ANY key can publish a `#p`-tagged summons, and the
   * event carries no selection proof the client can re-run, so an
   * unattributed notice is displayed as *unverified* rather than as a real
   * summons. The server-side summons board remains the authority for the ack.
   */
  readonly attributed: boolean;
}

export interface SummonsAckResult {
  readonly ok: boolean;
  /** true when THIS call transitioned the row to acked (false = idempotent re-ack). */
  readonly acked?: boolean;
  readonly reason?: string;
}

interface SummonsBoardRow {
  id?: number;
  jurorPubkey?: string;
  summonsEventId?: string | null;
  status?: string;
}

function getTag(tags: readonly (readonly string[])[], name: string): string | undefined {
  return tags.find((t) => t[0] === name && t.length >= 2)?.[1];
}

/**
 * Parse + verify a #p-tagged summons event. Returns null for anything
 * malformed — never a partially trusted notice.
 *
 * Round 35: the event must be NIP-01 signed (a hostile relay must not be able
 * to forge a summons attributed to the court), tag values are length-capped
 * (a hostile event cannot park a megabyte in the notice list), and the
 * publisher is reported separately from `attributed` so the UI can label an
 * unpinned publisher instead of implying court provenance.
 */
export function parseSummonsEvent(event: NostrEvent): CourtSummonsNotice | null {
  if (event.kind !== SUMMONS_SELECTION_KIND && event.kind !== SUMMONS_PROPOSAL_KIND) return null;
  try {
    if (!isVerifiedEvent(event)) return null;
  } catch {
    return null;
  }
  const tags = event.tags ?? [];
  let content: Record<string, unknown> = {};
  try {
    if (event.content) content = JSON.parse(event.content) as Record<string, unknown>;
  } catch {
    content = {};
  }
  const caseId = event.kind === SUMMONS_SELECTION_KIND
    ? getTag(tags, "dispute") ?? getTag(tags, "d") ?? String(content.disputeId ?? "")
    : getTag(tags, "d") ?? String(content.caseId ?? "");
  const marketId = getTag(tags, "market") ?? getTag(tags, "m") ?? String(content.marketId ?? "");
  if (!caseId || !marketId) return null;
  // Reject (never truncate) absurd values: a 512-char case id is not an
  // identifier any real court event carries, and truncating would let two
  // hostile events collide on the same displayed id.
  if (caseId.length > MAX_FIELD_CHARS || marketId.length > MAX_FIELD_CHARS) return null;

  const rawOutcome = getTag(tags, "proposed") ?? getTag(tags, "outcome") ?? getTag(tags, "o")
    ?? (typeof content.outcome === "string" ? content.outcome : undefined);
  if (rawOutcome != null && rawOutcome.length > MAX_FIELD_CHARS) return null;

  return {
    eventId: event.id,
    kind: event.kind,
    caseId,
    marketId,
    proposedOutcome: rawOutcome ?? null,
    createdAt: event.created_at,
    publisher: event.pubkey,
    attributed: event.pubkey.toLowerCase() === courtProposalPin(),
  };
}

function readStoredIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeStoredIds(key: string, ids: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(-MAX_STORED_IDS)));
  } catch {
    // localStorage may be unavailable (private mode) — state stays in memory.
  }
}

/**
 * useMySummons — summons notification surface for rostered jurors (R1: humans
 * had NO summons notification; rostered jurors discovered summons only by
 * clicking around).
 *
 * Subscribes (initial query + live stream) to kind-39002 selections and
 * kind-38026 outcome proposals `#p`-tagged to the logged-in npub on the BAO
 * Court relay, deduped by event id with a persisted since-cursor. New
 * summons raise an in-app toast and an unread badge (the JurorDashboard
 * entry); {@link ackSummons} is the one-click §6 ack: resolve the summons
 * row via `GET /v1/court/summons-board?case_id=` then record it via
 * `POST /v1/court/summons/:id/ack` — both NIP-98 (sign-only, so nsec,
 * NIP-07 and NIP-46 bunker logins all work).
 */
export function useMySummons() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const myPubkey = user?.pubkey;

  const [summons, setSummons] = useState<CourtSummonsNotice[]>([]);
  const [ackedEventIds, setAckedEventIds] = useState<string[]>(() => readStoredIds(ACKED_STORAGE_KEY));
  const [pendingAckEventId, setPendingAckEventId] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  /** Since-cursor: highest seen created_at, persisted across sessions. */
  const seenIdsRef = useRef<Set<string>>(new Set(readStoredIds(SEEN_STORAGE_KEY)));
  const ingestedIdsRef = useRef<Set<string>>(new Set());
  const cursorRef = useRef<number>(0);

  const ingest = useCallback((events: readonly NostrEvent[], myPubkey: string) => {
    // Bound the per-session dedupe set: clearing it only costs a re-parse
    // (the notice map below dedupes by event id), whereas an unbounded set is
    // a memory sink a hostile relay controls.
    if (ingestedIdsRef.current.size > MAX_INGESTED_IDS) ingestedIdsRef.current.clear();
    const fresh: CourtSummonsNotice[] = [];
    for (const event of events) {
      if (ingestedIdsRef.current.has(event.id)) continue;
      ingestedIdsRef.current.add(event.id);
      const parsed = parseSummonsEvent(event);
      if (!parsed) continue;
      // Roster gate: only summons addressed to ME (the '#p' filter is relay-
      // side; this re-check keeps the surface correct on any relay).
      const pTagged = (event.tags ?? []).some((t) => t[0] === "p" && t[1] === myPubkey);
      if (!pTagged) continue;
      fresh.push(parsed);
      cursorRef.current = Math.max(cursorRef.current, parsed.createdAt);
    }
    if (fresh.length === 0) return;
    setSummons((old) => {
      const byId = new Map(old.map((s) => [s.eventId, s]));
      for (const s of fresh) byId.set(s.eventId, s);
      const all = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
      // Newest first, capped - the list is attacker-fillable. Round 36: the cap
      // is applied with provenance priority, because ANY key can publish a
      // `#p`-tagged notice: a flood of newer unattributed events used to push a
      // genuine court summons off the list entirely (it then vanished from
      // `unseen`, the badge and the toast queue - the true signal was silenced
      // by publishing 200 newer fakes). Attributed notices always keep their
      // slot; unattributed ones fill what is left, newest first.
      const attributed = all.filter((s) => s.attributed);
      const rest = all.filter((s) => !s.attributed);
      return [...attributed, ...rest].slice(0, MAX_SUMMONS);
    });
  }, []);

  // Initial query + live subscription on the BAO Court relay.
  useEffect(() => {
    if (!myPubkey) return;
    const relay = new NRelay1(BAO_COURT_RELAY);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

    const kinds = [SUMMONS_SELECTION_KIND, SUMMONS_PROPOSAL_KIND];
    const since = cursorRef.current > 0
      ? cursorRef.current + 1
      : Math.floor(Date.now() / 1000) - INITIAL_LOOKBACK_SECONDS;
    const filter: NostrFilter = {
      kinds,
      "#p": [myPubkey],
      since,
      limit: QUERY_LIMIT,
    };

    (async () => {
      try {
        const initial = await relay.query([filter], { signal: controller.signal });
        if (controller.signal.aborted) return;
        ingest(initial, myPubkey);
      } catch {
        // Initial backfill is best-effort; the live stream may still deliver.
      } finally {
        clearTimeout(timeoutId);
      }
      try {
        for await (const msg of relay.req([filter], { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          if (msg[0] !== "EVENT") continue;
          ingest([msg[2]], myPubkey);
        }
      } catch {
        // Subscription errors are best-effort.
      } finally {
        relay.close().catch(() => {});
      }
    })();

    return () => {
      controller.abort();
      relay.close().catch(() => {});
    };
  }, [myPubkey, ingest]);

  const unseen = useMemo(
    () => summons.filter((s) => !seenIdsRef.current.has(s.eventId) && !ackedEventIds.includes(s.eventId)),
    [summons, ackedEventIds],
  );

  // Toast per newly-arrived unseen summons (bounded: only events not in the
  // persisted seen set and not already announced this session, and at most
  // MAX_ANNOUNCEMENTS toasts per mount - a hostile publisher can otherwise
  // queue hundreds of notifications at this npub).
  //
  // Round 36: unattributed publishers get only
  // MAX_UNATTRIBUTED_ANNOUNCEMENTS slots, so a stranger flood cannot spend the
  // whole queue before a genuine court summons arrives (it used to: five
  // attacker toasts, then the real one only appeared in the aggregate
  // "N more court notices" line - or not at all once it fell off the list cap).
  const announcedRef = useRef<Set<string>>(new Set());
  const announceCountRef = useRef(0);
  const unattributedAnnouncedRef = useRef(0);
  useEffect(() => {
    let suppressed = 0;
    for (const notice of unseen) {
      if (announcedRef.current.has(notice.eventId)) continue;
      announcedRef.current.add(notice.eventId);
      const allowed = notice.attributed
        ? announceCountRef.current < MAX_ANNOUNCEMENTS
        : announceCountRef.current < MAX_ANNOUNCEMENTS
          && unattributedAnnouncedRef.current < MAX_UNATTRIBUTED_ANNOUNCEMENTS;
      if (!allowed) {
        suppressed += 1;
        continue;
      }
      announceCountRef.current += 1;
      if (!notice.attributed) unattributedAnnouncedRef.current += 1;
      const label = notice.kind === SUMMONS_SELECTION_KIND ? "Jury selection" : "Court summons";
      const unverified = notice.attributed ? "" : " (unverified publisher)";
      toast({
        title: `${label} received${unverified}`,
        // Attacker-controlled id: sanitize + cap before it reaches a toast
        // (a raw slice could split a surrogate pair and smuggle bidi controls
        // into the notification).
        description: `Case ${shortIdentifier(notice.caseId, 16)} — acknowledge from your Jury Duty panel.`,
      });
    }
    if (suppressed > 0) {
      toast({
        title: `${suppressed} more court notices`,
        description: "Open your Jury Duty panel to review them.",
      });
    }
  }, [unseen, toast]);

  const markSeen = useCallback((eventIds?: readonly string[]) => {
    const toPersist = eventIds ?? summons.map((s) => s.eventId);
    for (const id of toPersist) seenIdsRef.current.add(id);
    writeStoredIds(SEEN_STORAGE_KEY, [...seenIdsRef.current]);
    // Force unseen recompute (seenIdsRef is a ref).
    setSummons((old) => [...old]);
  }, [summons]);

  /**
   * One-click §6 ack: resolve MY summons row for this case on the board,
   * then POST the ack. Idempotent server-side (a re-ack is acked:false).
   */
  const ackSummons = useCallback(async (notice: CourtSummonsNotice): Promise<SummonsAckResult> => {
    if (!user) return { ok: false, reason: "not_logged_in" };
    setPendingAckEventId(notice.eventId);
    setAckError(null);
    try {
      const signer = user.signer;
      // 1. Resolve the summons row id (the API acks by DB row id; the relay
      //    event id is the binding target).
      const boardUrl = `${baoApiBase()}/v1/court/summons-board?case_id=${encodeURIComponent(notice.caseId)}`;
      const boardRes = await fetch(boardUrl, {
        headers: { Authorization: await baoNip98Header(signer, boardUrl, "GET") },
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      });
      if (!boardRes.ok) {
        return { ok: false, reason: `summons-board HTTP ${boardRes.status}` };
      }
      const boardJson = (await boardRes.json().catch(() => ({}))) as {
        data?: { summons?: SummonsBoardRow[] };
      };
      const rows = boardJson?.data?.summons ?? [];
      const mine = rows.find((r) =>
        r.jurorPubkey === myPubkey && r.summonsEventId === notice.eventId)
        ?? rows.find((r) => r.jurorPubkey === myPubkey && r.status === "sent");
      if (!mine || typeof mine.id !== "number") {
        return { ok: false, reason: "summons_row_not_found" };
      }

      // 2. Record the ack.
      const ackUrl = `${baoApiBase()}/v1/court/summons/${mine.id}/ack`;
      const ackRes = await fetch(ackUrl, {
        method: "POST",
        headers: { Authorization: await baoNip98Header(signer, ackUrl, "POST") },
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      });
      if (!ackRes.ok) {
        const detail = (await ackRes.json().catch(() => ({}))) as { error?: { message?: string } };
        const message = detail?.error?.message;
        return {
          ok: false,
          reason: typeof message === "string" && message
            ? message.slice(0, MAX_REASON_CHARS)
            : `ack HTTP ${ackRes.status}`,
        };
      }
      const ackJson = (await ackRes.json().catch(() => ({}))) as { data?: { acked?: boolean } };

      setAckedEventIds((old) => {
        const next = old.includes(notice.eventId) ? old : [...old, notice.eventId];
        writeStoredIds(ACKED_STORAGE_KEY, next);
        return next;
      });
      markSeen([notice.eventId]);
      return { ok: true, acked: ackJson?.data?.acked ?? true };
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, MAX_REASON_CHARS);
      setAckError(reason);
      return { ok: false, reason };
    } finally {
      setPendingAckEventId(null);
    }
  }, [user, myPubkey, markSeen]);

  return {
    /** All known summons (newest first). */
    summons,
    /** Summons neither seen nor acked — the badge + prompt set. */
    unseen,
    /** Count for the JurorDashboard entry badge. */
    unreadCount: unseen.length,
    ackedEventIds,
    pendingAckEventId,
    ackError,
    ackSummons,
    markSeen,
  };
}
