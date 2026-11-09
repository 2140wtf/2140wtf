import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NRelay1, type NostrEvent, type NostrFilter } from "@nostrify/nostrify";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/useToast";
import { isVerifiedEvent } from "@/lib/nostrEvents";
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

export interface CourtSummonsNotice {
  /** Relay event id of the summons (dedupe + ack binding target). */
  readonly eventId: string;
  readonly kind: typeof SUMMONS_SELECTION_KIND | typeof SUMMONS_PROPOSAL_KIND;
  /** Case id: kind-39002 `dispute`/`d` tag, kind-38026 `d`/caseId. */
  readonly caseId: string;
  readonly marketId: string;
  readonly proposedOutcome: string | null;
  readonly createdAt: number;
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

  const rawOutcome = getTag(tags, "proposed") ?? getTag(tags, "outcome") ?? getTag(tags, "o")
    ?? (typeof content.outcome === "string" ? content.outcome : undefined);

  return {
    eventId: event.id,
    kind: event.kind,
    caseId,
    marketId,
    proposedOutcome: rawOutcome ?? null,
    createdAt: event.created_at,
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
      return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
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
  // persisted seen set and not already announced this session).
  const announcedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const notice of unseen) {
      if (announcedRef.current.has(notice.eventId)) continue;
      announcedRef.current.add(notice.eventId);
      const label = notice.kind === SUMMONS_SELECTION_KIND ? "Jury selection" : "Court summons";
      toast({
        title: `${label} received`,
        description: `Case ${notice.caseId.slice(0, 16)} — acknowledge from your Jury Duty panel.`,
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
        return { ok: false, reason: detail?.error?.message ?? `ack HTTP ${ackRes.status}` };
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
      const reason = err instanceof Error ? err.message : String(err);
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
