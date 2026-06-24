import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NRelay1, type NostrEvent, type NostrFilter } from "@nostrify/nostrify";

import { isNostrId } from "@/lib/nostrId";
import {
  BAO_COURT_DISPUTE_KIND,
  BAO_COURT_SELECTION_KIND,
  parseSelectionEvent,
  validateSelectionEvent,
  type DisputeCase,
} from "@bao/frost-court";

const RELAY = "wss://relay.bao.network";
const QUERY_LIMIT = 500;
const QUERY_TIMEOUT_MS = 15_000;
const LIVE_BATCH_MS = 1_000;

function sanitizeSingleLine(text: string, maxLength = 200): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export interface BaoCourtDispute extends DisputeCase {
  readonly createdAt: number;
  readonly deadline: number;
  readonly rawEvent: NostrEvent;
  readonly status: 'open' | 'closed';
}

function parseBaoCourtDispute(event: NostrEvent): BaoCourtDispute | null {
  if (event.kind !== BAO_COURT_DISPUTE_KIND) return null;

  const tags = event.tags ?? [];
  const getTag = (name: string): string | undefined =>
    tags.find((t) => t[0] === name)?.[1];

  let content: Record<string, unknown> = {};
  try {
    if (event.content) {
      content = JSON.parse(event.content) as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  const disputeIdRaw = getTag("dispute") ?? String(content.disputeId ?? event.id);
  const disputeId = isNostrId(disputeIdRaw) ? disputeIdRaw : event.id;
  const marketId = getTag("market") ?? String(content.marketId ?? '');
  const marketEventIdRaw = getTag("e") ?? String(content.marketEventId ?? '');
  const marketEventId = isNostrId(marketEventIdRaw) ? marketEventIdRaw : '';
  const originalOutcome = sanitizeSingleLine(
    String(getTag("original") ?? content.originalOutcome ?? ""),
    100,
  );
  const proposedOutcome = sanitizeSingleLine(
    String(getTag("proposed") ?? content.proposedOutcome ?? ""),
    100,
  );
  if (!proposedOutcome) return null;
  if (!isNostrId(event.pubkey)) return null;

  const challengerPubkey = event.pubkey;
  const respondentPubkey =
    getTag("respondent") ??
    String(content.respondentPubkey ?? "");

  const evidenceHashes = tags
    .filter((t) => t[0] === "evidence")
    .map((t) => t[1])
    .filter((h): h is string => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));

  const rawDeadline = getTag("deadline") ?? content.disputeDeadline;
  const deadline =
    typeof rawDeadline === "string" ? Number.parseInt(rawDeadline, 10) : Number(rawDeadline ?? 0);

  const status: BaoCourtDispute["status"] =
    deadline > 0 && Math.floor(Date.now() / 1000) > deadline ? "closed" : "open";

  return {
    disputeId,
    marketId,
    marketEventId,
    challengerPubkey,
    respondentPubkey,
    evidenceHashes,
    proposedOutcome,
    originalOutcome,
    createdAt: event.created_at,
    deadline,
    rawEvent: event,
    status,
  };
}

function getDisputesQueryKey() {
  return ["bao-court-disputes"];
}

function getSelectionQueryKey(disputeId: string) {
  return ["bao-court-selection", disputeId];
}

export function useBaoCourtDisputes() {
  const queryClient = useQueryClient();

  const query = useQuery<BaoCourtDispute[]>({
    queryKey: getDisputesQueryKey(),
    queryFn: async ({ signal }) => {
      const relay = new NRelay1(RELAY);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      try {
        const filter: NostrFilter = {
          kinds: [BAO_COURT_DISPUTE_KIND],
          limit: QUERY_LIMIT,
        };
        const events = await relay.query([filter], { signal: controller.signal });

        const deduped: NostrEvent[] = [];
        const seenIds = new Set<string>();
        for (const event of events) {
          if (seenIds.has(event.id)) continue;
          seenIds.add(event.id);
          deduped.push(event);
        }

        const seen = new Map<string, BaoCourtDispute>();
        for (const event of deduped) {
          const parsed = parseBaoCourtDispute(event);
          if (!parsed) continue;
          const existing = seen.get(parsed.disputeId);
          if (!existing || parsed.createdAt > existing.createdAt) {
            seen.set(parsed.disputeId, parsed);
          }
        }

        return Array.from(seen.values()).sort((a, b) => b.createdAt - a.createdAt);
      } finally {
        clearTimeout(timeoutId);
        relay.close().catch(() => {});
      }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: "always",
  });

  // Live subscription for new dispute events.
  useEffect(() => {
    const relay = new NRelay1(RELAY);
    const controller = new AbortController();

    const since = Math.floor(Date.now() / 1000);
    const filter: NostrFilter = {
      kinds: [BAO_COURT_DISPUTE_KIND],
      limit: QUERY_LIMIT,
      since,
    };

    const pending: NostrEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flush() {
      flushTimer = null;
      if (pending.length === 0 || controller.signal.aborted) return;

      const events = pending.splice(0, pending.length);
      const queryKey = getDisputesQueryKey();

      queryClient.setQueryData<BaoCourtDispute[]>(queryKey, (old = []) => {
        const seenEventIds = new Set<string>();
        const byDispute = new Map<string, BaoCourtDispute>();
        for (const d of old) byDispute.set(d.disputeId, d);

        let changed = false;
        for (const event of events) {
          if (seenEventIds.has(event.id)) continue;
          seenEventIds.add(event.id);
          if (old.some((d) => d.rawEvent.id === event.id)) continue;

          const parsed = parseBaoCourtDispute(event);
          if (!parsed) continue;

          const existing = byDispute.get(parsed.disputeId);
          if (existing && existing.createdAt >= parsed.createdAt) continue;

          byDispute.set(parsed.disputeId, parsed);
          changed = true;
        }

        if (!changed) return old;
        return Array.from(byDispute.values()).sort((a, b) => b.createdAt - a.createdAt);
      });
    }

    function scheduleFlush() {
      if (flushTimer == null && !controller.signal.aborted) {
        flushTimer = setTimeout(flush, LIVE_BATCH_MS);
      }
    }

    (async () => {
      try {
        for await (const msg of relay.req([filter], { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          if (msg[0] !== "EVENT") continue;

          pending.push(msg[2]);
          scheduleFlush();
        }
      } catch {
        // Subscription errors are best-effort.
      } finally {
        if (flushTimer) clearTimeout(flushTimer);
        relay.close().catch(() => {});
      }
    })();

    return () => {
      controller.abort();
      if (flushTimer) clearTimeout(flushTimer);
      relay.close().catch(() => {});
    };
  }, [queryClient]);

  return query;
}

/**
 * Query the kind 39002 selection event for a specific dispute.
 *
 * Selection events are trust-sensitive. Callers currently provide a list of
 * trusted coordinator pubkeys for filtering, but a coordinator-based design is
 * NOT the desired end state. The protocol target is a fully independent jury
 * where selection events are validated through roster signatures, not a
 * privileged publisher. Until that replaces the coordinator filter, callers
 * should treat the pubkey list as a temporary compatibility aid.
 */
export function useBaoCourtSelection(
  disputeId: string,
  coordinatorPubkeys?: readonly string[],
) {
  return useQuery({
    queryKey: getSelectionQueryKey(disputeId),
    queryFn: async ({ signal }) => {
      const relay = new NRelay1(RELAY);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      try {
        const filter: NostrFilter = {
          kinds: [BAO_COURT_SELECTION_KIND],
          authors: coordinatorPubkeys && coordinatorPubkeys.length > 0
            ? [...coordinatorPubkeys]
            : undefined,
          "#dispute": [disputeId],
          limit: 20,
        };
        const events = await relay.query([filter], { signal: controller.signal });
        for (const event of events) {
          const validation = validateSelectionEvent(event, disputeId);
          if (!validation.valid) continue;
          const parsed = parseSelectionEvent(event);
          if (parsed && parsed.disputeId === disputeId) {
            return parsed;
          }
        }
        return null;
      } finally {
        clearTimeout(timeoutId);
        relay.close().catch(() => {});
      }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled: disputeId.length > 0,
  });
}
