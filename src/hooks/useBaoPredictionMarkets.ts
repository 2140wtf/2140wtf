import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NRelay1, type NostrEvent, type NostrFilter } from "@nostrify/nostrify";

import { parseBaoMarket, type BaoMarket, BAO_MARKET_KIND } from "@/lib/baoMarketParser";

const RELAY = "wss://relay.bao.network";
const QUERY_LIMIT = 500;
const QUERY_TIMEOUT_MS = 15_000;
const LIVE_BATCH_MS = 1_000;

function getQueryKey(category: string) {
  return ["bao-prediction-markets", category];
}

export function useBaoPredictionMarkets(category: string = "all") {
  const queryClient = useQueryClient();

  const query = useQuery<BaoMarket[]>({
    queryKey: getQueryKey(category),
    queryFn: async ({ signal }) => {
      const relay = new NRelay1(RELAY);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      const filter: NostrFilter = {
        kinds: [BAO_MARKET_KIND],
        limit: QUERY_LIMIT,
      };
      if (category !== "all") {
        filter["#category"] = [category];
      }

      try {
        const events = await relay.query([filter], { signal: controller.signal });

        // Guard against relay duplicates: keep only the first occurrence of each event id.
        const dedupedEvents: typeof events = [];
        const seenIds = new Set<string>();
        for (const event of events) {
          if (seenIds.has(event.id)) continue;
          seenIds.add(event.id);
          dedupedEvents.push(event);
        }

        // Dedupe by market d-tag, keeping the newest version of each market.
        const seen = new Map<string, BaoMarket>();
        for (const event of dedupedEvents) {
          const parsed = parseBaoMarket(event);
          if (!parsed) continue;
          const existing = seen.get(parsed.marketId);
          if (!existing || parsed.createdAt > existing.createdAt) {
            seen.set(parsed.marketId, parsed);
          }
        }

        return Array.from(seen.values())
          .filter((m) => m.state !== 'ended')
          .sort((a, b) => b.createdAt - a.createdAt);
      } finally {
        clearTimeout(timeoutId);
        relay.close().catch(() => {});
      }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: "always",
  });

  // Live subscription: keep a persistent REQ open so new/updated markets flow in.
  // Batch incoming events to avoid re-rendering the grid on every single event.
  useEffect(() => {
    const relay = new NRelay1(RELAY);
    const controller = new AbortController();

    const since = Math.floor(Date.now() / 1000);
    const filter: NostrFilter = {
      kinds: [BAO_MARKET_KIND],
      limit: QUERY_LIMIT,
      since,
    };
    if (category !== "all") {
      filter["#category"] = [category];
    }

    const pending: NostrEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flush() {
      flushTimer = null;
      if (pending.length === 0 || controller.signal.aborted) return;

      const events = pending.splice(0, pending.length);
      const queryKey = getQueryKey(category);

      queryClient.setQueryData<BaoMarket[]>(queryKey, (old = []) => {
        const seenEventIds = new Set<string>();
        const byMarket = new Map<string, BaoMarket>();
        for (const m of old) byMarket.set(m.marketId, m);

        let changed = false;
        for (const event of events) {
          if (seenEventIds.has(event.id)) continue;
          seenEventIds.add(event.id);
          if (old.some((m) => m.rawEvent.id === event.id)) continue;

          const parsed = parseBaoMarket(event);
          if (!parsed) continue;

          const existing = byMarket.get(parsed.marketId);
          if (existing && existing.createdAt >= parsed.createdAt) continue;

          byMarket.set(parsed.marketId, parsed);
          changed = true;
        }

        if (!changed) return old;

        return Array.from(byMarket.values())
          .filter((m) => m.state !== "ended")
          .sort((a, b) => b.createdAt - a.createdAt);
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
        // Subscription errors are best-effort; the initial query still serves data.
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
  }, [category, queryClient]);

  return query;
}
