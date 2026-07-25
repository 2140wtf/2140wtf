import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NRelay1, type NostrEvent, type NostrFilter } from "@nostrify/nostrify";

import { parseBaoMarket, type BaoMarket, BAO_MARKET_KIND } from "@/lib/baoMarketParser";
import { apiMarketToBaoMarket, baoApiFetchAll, fetchBaoMarketCategories, type ApiMarket } from "@/lib/baoMarketApi";

const RELAY = "wss://relay.bao.network";
const QUERY_LIMIT = 500;
const QUERY_TIMEOUT_MS = 15_000;
const LIVE_BATCH_MS = 1_000;
/** The API caps `limit` at 200 and paginates via `offset`/`has_more`. */
const API_PAGE_LIMIT = 200;
const API_MAX_PAGES = 5;

async function fetchApiMarkets(category: string, status: 'active' | 'all', signal: AbortSignal): Promise<BaoMarket[]> {
  const byId = new Map<string, BaoMarket>();

  for (let page = 0; page < API_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      limit: String(API_PAGE_LIMIT),
      offset: String(page * API_PAGE_LIMIT),
    });
    if (category !== "all") {
      params.set("category", category);
    }
    if (status === "active") {
      params.set("status", "active");
    }

    // Primary (local dev API) and public API hold different rows — merge both.
    // Primary wins on id conflicts (it's the DB a developer is actively testing).
    const responses = await baoApiFetchAll(`/markets?${params.toString()}`, signal);
    if (responses.length === 0) {
      throw new Error("BAO markets API unreachable");
    }

    let hasMore = false;
    for (const res of responses) {
      const json = (await res.json()) as { data?: ApiMarket[]; has_more?: boolean };
      for (const m of json.data ?? []) {
        if (!byId.has(m.id)) byId.set(m.id, apiMarketToBaoMarket(m));
      }
      hasMore = hasMore || json.has_more === true;
    }
    if (!hasMore) break;
  }

  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function isMarketActive(market: BaoMarket, now: number): boolean {
  return market.state === 'active' && (market.endTime <= 0 || market.endTime >= now);
}

async function fetchRelayMarkets(category: string, status: 'active' | 'all', signal: AbortSignal): Promise<BaoMarket[]> {
  const relay = new NRelay1(RELAY);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  signal.addEventListener("abort", () => controller.abort(), { once: true });

  const filter: NostrFilter = {
    kinds: [BAO_MARKET_KIND],
    limit: QUERY_LIMIT,
  };
  if (category !== "all") {
    filter["#category"] = [category];
  }

  try {
    const events = await relay.query([filter], { signal: controller.signal });

    const dedupedEvents: typeof events = [];
    const seenIds = new Set<string>();
    for (const event of events) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);
      dedupedEvents.push(event);
    }

    const seen = new Map<string, BaoMarket>();
    const now = Math.floor(Date.now() / 1000);
    for (const event of dedupedEvents) {
      const parsed = parseBaoMarket(event);
      if (!parsed) continue;
      if (status === 'active' && !isMarketActive(parsed, now)) continue;
      const key = `${parsed.creatorPubkey}:${parsed.marketId}`;
      const existing = seen.get(key);
      if (!existing || parsed.createdAt > existing.createdAt) {
        seen.set(key, parsed);
      }
    }

    return Array.from(seen.values()).sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    clearTimeout(timeoutId);
    relay.close().catch(() => {});
  }
}

function getQueryKey(category: string, status: 'active' | 'all') {
  return ["bao-prediction-markets", category, status];
}

export function useBaoPredictionMarkets(category: string = "all", status: 'active' | 'all' = "active") {
  const queryClient = useQueryClient();

  const query = useQuery<BaoMarket[]>({
    queryKey: getQueryKey(category, status),
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      try {
        try {
          const apiMarkets = await fetchApiMarkets(category, status, controller.signal);
          if (apiMarkets.length > 0) {
            return apiMarkets;
          }
        } catch (error) {
          console.warn("[useBaoPredictionMarkets] API fetch failed, falling back to relay:", error);
        }

        return fetchRelayMarkets(category, status, controller.signal);
      } finally {
        clearTimeout(timeoutId);
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
    const now = Math.floor(Date.now() / 1000);

    const pending: NostrEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flush() {
      flushTimer = null;
      if (pending.length === 0 || controller.signal.aborted) return;

      const events = pending.splice(0, pending.length);
      const queryKey = getQueryKey(category, status);

      queryClient.setQueryData<BaoMarket[]>(queryKey, (old = []) => {
        const seenEventIds = new Set<string>();
        const byMarket = new Map<string, BaoMarket>();
        for (const m of old) byMarket.set(`${m.creatorPubkey}:${m.marketId}`, m);

        let changed = false;
        for (const event of events) {
          if (seenEventIds.has(event.id)) continue;
          seenEventIds.add(event.id);
          if (old.some((m) => m.rawEvent.id === event.id)) continue;

          const parsed = parseBaoMarket(event);
          if (!parsed) continue;
          if (status === 'active' && !isMarketActive(parsed, now)) continue;

          const key = `${parsed.creatorPubkey}:${parsed.marketId}`;
          const existing = byMarket.get(key);
          if (existing && existing.createdAt >= parsed.createdAt) continue;

          byMarket.set(key, parsed);
          changed = true;
        }

        if (!changed) return old;

        return Array.from(byMarket.values()).sort((a, b) => b.createdAt - a.createdAt);
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
  }, [category, status, queryClient]);

  return query;
}

/**
 * The API's market category catalog (slugs + active counts), for the category
 * picker. Merges the local dev API and the public API; public counts win.
 */
export function useBaoMarketCategories() {
  return useQuery({
    queryKey: ["bao-market-categories"],
    queryFn: ({ signal }) => fetchBaoMarketCategories(signal),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
