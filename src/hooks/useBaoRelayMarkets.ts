import { useQuery } from "@tanstack/react-query";
import { useNostr } from "@nostrify/react";
import type { NostrFilter } from "@nostrify/nostrify";

import { type BaoMarket, BAO_MARKET_KIND } from "@/lib/baoMarketParser";
import {
  BAO_MARKET_NETWORK,
  BAO_MARKETS_RELAY,
  parseBaoRelayMarkets,
} from "@/lib/baoRelayMarkets";

const QUERY_LIMIT = 500;
const QUERY_TIMEOUT_MS = 15_000;

function isMarketActive(market: BaoMarket, now: number): boolean {
  return market.state === "active" && (market.endTime <= 0 || market.endTime >= now);
}

/**
 * Discover bao.markets prediction markets directly from the relay via the
 * app's nostr pool — an ADDITIONAL source alongside the API hooks, not a
 * replacement. The relay carries market definitions only (no AMM state), so
 * consumers merge these with API markets (API wins on live fields) via
 * mergeApiAndRelayMarkets.
 *
 * Relay failures resolve to an empty list: when the relay is unreachable the
 * UI must behave exactly as if this hook did not exist.
 */
export function useBaoRelayMarkets(category: string = "all", status: "active" | "all" = "active") {
  const { nostr } = useNostr();

  return useQuery<BaoMarket[]>({
    queryKey: ["bao-relay-markets", category, status, BAO_MARKET_NETWORK],
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
      signal.addEventListener("abort", () => controller.abort(), { once: true });

      const filter: NostrFilter = {
        kinds: [BAO_MARKET_KIND],
        "#n": [BAO_MARKET_NETWORK],
        limit: QUERY_LIMIT,
      };
      if (category !== "all") {
        filter["#c"] = [category];
      }

      try {
        const events = await nostr.group([BAO_MARKETS_RELAY]).query([filter], {
          signal: controller.signal,
        });

        const markets = parseBaoRelayMarkets(events);
        if (status === "all") return markets;

        const now = Math.floor(Date.now() / 1000);
        return markets.filter((m) => isMarketActive(m, now));
      } catch (error) {
        console.warn("[useBaoRelayMarkets] relay query failed, returning no relay markets:", error);
        return [];
      } finally {
        clearTimeout(timeoutId);
      }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: "always",
    retry: false,
  });
}
