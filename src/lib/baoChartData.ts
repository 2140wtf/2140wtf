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

/**
 * Represent a live pool price honestly when the API exposes current odds but
 * no historical fills. A flat two-point line is a snapshot, not an invented
 * price path.
 */
export function buildCurrentPoolSnapshot(
  price: number,
  startTime: number,
  endTime: number,
): BaoPriceHistoryPoint[] {
  if (!Number.isFinite(price) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return [];
  const start = Math.floor(Math.min(startTime, endTime - 1));
  const end = Math.floor(Math.max(endTime, start + 1));
  const normalizedPrice = Math.max(0, Math.min(1, price));
  return [
    { time: start, price: normalizedPrice },
    { time: end, price: normalizedPrice },
  ];
}
