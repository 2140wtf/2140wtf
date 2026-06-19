import { useQuery } from '@tanstack/react-query';
import { NRelay1, type NostrEvent, type NostrFilter } from '@nostrify/nostrify';

import {
  BAO_MARKETS_TRADE_KIND,
  type BaoMarket,
  type BaoMarketOutcome,
} from '@/lib/baoMarketParser';

const RELAY = 'wss://relay.bao.network';
const QUERY_TIMEOUT_MS = 15_000;
const QUERY_LIMIT = 500;

export interface PricePoint {
  /** Unix timestamp in seconds. */
  time: number;
  /** Probability in the range [0, 1]. */
  price: number;
}

function getTagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

function normalizePrice(raw: unknown): number | null {
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(num)) return null;
  // Trade events store avgPrice in cents (0-100). Normalize to [0, 1].
  const ratio = num > 1 ? num / 100 : num;
  return Math.max(0, Math.min(1, ratio));
}

export interface ParsedTrade {
  tradeId: string;
  outcomeId: string;
  price: number;
  createdAt: number;
}

export function parseBaoTradeEvent(event: NostrEvent): ParsedTrade | null {
  if (event.kind !== BAO_MARKETS_TRADE_KIND) return null;

  const tags = event.tags ?? [];
  const tradeId = getTagValue(tags, 'd') || '';
  const marketId = getTagValue(tags, 'm') || '';
  if (!tradeId || !marketId) return null;

  let content: Record<string, unknown> = {};
  try {
    content = JSON.parse(event.content || '{}') as Record<string, unknown>;
  } catch {
    content = {};
  }

  const outcomeId =
    (typeof content.outcomeId === 'string' ? content.outcomeId : undefined) ||
    getTagValue(tags, 'o') ||
    getTagValue(tags, 'outcome') ||
    '';

  const price = normalizePrice(content.avgPrice);
  if (price === null || outcomeId === '') return null;

  return {
    tradeId,
    outcomeId,
    price,
    createdAt: event.created_at,
  };
}

function buildSyntheticHistory(
  outcomes: BaoMarketOutcome[],
): Record<string, PricePoint[]> {
  const history: Record<string, PricePoint[]> = {};
  const now = Math.floor(Date.now() / 1000);
  for (let idx = 0; idx < outcomes.length; idx++) {
    const outcome = outcomes[idx];
    const start = 0.5;
    const end = outcome.probability ?? 1 / outcomes.length;
    // Deterministic, stable synthetic line from 50% to current probability.
    // Use recent timestamps so the ALL range doesn't expand to the Unix epoch.
    history[outcome.label] = [
      { time: now - 24 * 60 * 60, price: start },
      { time: now, price: Math.max(0, Math.min(1, end)) },
    ];
  }
  return history;
}

export function buildPriceHistory(
  market: BaoMarket,
  trades: ParsedTrade[],
): Record<string, PricePoint[]> {
  if (trades.length === 0) {
    return buildSyntheticHistory(market.outcomes);
  }

  const byOutcome = new Map<string, PricePoint[]>();
  const sorted = [...trades].sort((a, b) => a.createdAt - b.createdAt);

  for (const trade of sorted) {
    const points = byOutcome.get(trade.outcomeId) ?? [];
    points.push({ time: trade.createdAt, price: trade.price });
    byOutcome.set(trade.outcomeId, points);
  }

  const history: Record<string, PricePoint[]> = {};
  for (const outcome of market.outcomes) {
    const points = byOutcome.get(outcome.label) ?? byOutcome.get(outcome.id);
    if (points && points.length >= 2) {
      history[outcome.label] = points;
      continue;
    }

    // No trades for this outcome — show a flat line at its current probability.
    const prob = Math.max(0, Math.min(1, outcome.probability ?? 1 / market.outcomes.length));
    history[outcome.label] = [
      { time: sorted[0]?.createdAt ?? market.createdAt, price: prob },
      { time: sorted[sorted.length - 1]?.createdAt ?? market.createdAt, price: prob },
    ];
  }

  return history;
}

export function useBaoMarketPriceHistory(market: BaoMarket | null) {
  return useQuery<Record<string, PricePoint[]>>({
    queryKey: ['bao-market-price-history', market?.marketId],
    queryFn: async ({ signal }) => {
      if (!market) return {};

      const relay = new NRelay1(RELAY);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
      if (signal) {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      const filter: NostrFilter = {
        kinds: [BAO_MARKETS_TRADE_KIND],
        '#m': [market.marketId],
        limit: QUERY_LIMIT,
      };

      try {
        const events = await relay.query([filter], { signal: controller.signal });
        const seen = new Set<string>();
        const trades: ParsedTrade[] = [];
        for (const event of events) {
          if (seen.has(event.id)) continue;
          seen.add(event.id);
          const parsed = parseBaoTradeEvent(event);
          if (parsed) trades.push(parsed);
        }
        return buildPriceHistory(market, trades);
      } finally {
        clearTimeout(timeoutId);
        relay.close().catch(() => {});
      }
    },
    enabled: !!market,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
