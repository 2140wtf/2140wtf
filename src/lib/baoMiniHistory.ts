import { baoApiFetch } from '@/lib/baoMarketApi';
import type { BaoMarket } from '@/lib/baoMarketParser';

export interface MiniHistoryPoint {
  time: number;
  price: number;
}

interface PriceHistoryResponse {
  data?: { prices?: Array<{ timestamp: number; price: number }> };
}

interface SmjHistoryResponse {
  data?: { bets?: Array<{ outcome_id: string; amount_sats: number; created_at: number }> };
}

export async function fetchMiniMarketHistory(
  market: Pick<BaoMarket, 'marketId' | 'poolModel' | 'outcomes'>,
  signal?: AbortSignal,
): Promise<MiniHistoryPoint[]> {
  const first = market.outcomes[0];
  if (!first) return [];

  if (market.poolModel === 'smj') {
    const response = await baoApiFetch(`/smj/${encodeURIComponent(market.marketId)}/history`, signal);
    const json = (await response.json()) as SmjHistoryResponse;
    const target = first.id.toLowerCase();
    const pools = new Map(market.outcomes.map((outcome) => [outcome.id.toLowerCase(), 0]));
    const points: MiniHistoryPoint[] = [];
    for (const bet of json.data?.bets ?? []) {
      const id = bet.outcome_id.toLowerCase();
      if (!pools.has(id) || !Number.isFinite(bet.amount_sats) || bet.amount_sats <= 0) continue;
      pools.set(id, (pools.get(id) ?? 0) + bet.amount_sats);
      const total = [...pools.values()].reduce((sum, amount) => sum + amount, 0);
      if (total > 0 && Number.isFinite(bet.created_at)) {
        points.push({ time: bet.created_at, price: (pools.get(target) ?? 0) / total });
      }
    }
    return points;
  }

  const params = new URLSearchParams({ period: '7d', outcome_id: first.id });
  const response = await baoApiFetch(
    `/markets/${encodeURIComponent(market.marketId)}/price-history?${params.toString()}`,
    signal,
  );
  const json = (await response.json()) as PriceHistoryResponse;
  return (json.data?.prices ?? [])
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price))
    .map((point) => ({ time: point.timestamp, price: Math.max(0, Math.min(1, point.price)) }));
}
