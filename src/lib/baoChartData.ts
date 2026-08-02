export interface BaoPriceHistoryPoint {
  time: number;
  price: number;
}

/**
 * lightweight-charts requires strictly ascending, unique timestamps.
 * API/SMJ feeds can contain several fills in the same Unix second, so retain
 * the latest observation for each second and sort the resulting series.
 */
export function normalizeBaoPriceHistory(
  points: BaoPriceHistoryPoint[],
): BaoPriceHistoryPoint[] {
  const byTime = new Map<number, BaoPriceHistoryPoint>();
  for (const point of points) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.price)) continue;
    byTime.set(point.time, point);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
