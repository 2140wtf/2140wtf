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

/** Build the deterministic demo curve used by the standalone ₿AO Markets UI. */
export function buildSyntheticPoolHistory(
  currentRatio: number,
  seedKey: string,
  outcomeIndex: number,
  startTime: number,
  endTime: number,
  pointCount = 30,
): BaoPriceHistoryPoint[] {
  if (!Number.isFinite(currentRatio) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return [];
  const start = Math.floor(Math.min(startTime, endTime - 1));
  const end = Math.floor(Math.max(endTime, start + 1));
  const target = Math.max(0.01, Math.min(0.99, currentRatio));
  const count = Math.max(2, Math.floor(pointCount));

  let seed = outcomeIndex * 7919;
  for (let i = 0; i < seedKey.length; i++) {
    seed = ((seed << 5) - seed + seedKey.charCodeAt(i)) | 0;
  }
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed & 0x7fffffff) / 0x7fffffff;
  };

  const prices = [0.5];
  const difference = target - 0.5;
  const volatility = Math.max(0.01, Math.abs(difference) * 0.5);
  for (let i = 1; i < count - 1; i++) {
    const progress = i / (count - 1);
    const expected = 0.5 + difference * progress;
    const u1 = random() || 0.001;
    const u2 = random();
    const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * volatility * 0.12;
    const previous = prices[i - 1];
    prices.push(Math.max(0.01, Math.min(0.99, previous + (expected - previous) * 0.35 + noise)));
  }
  prices.push(target);

  return prices.map((price, index) => ({
    time: start + Math.floor(((end - start) * index) / (prices.length - 1)),
    price,
  }));
}
