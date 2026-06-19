/**
 * Deterministic price-history synthesis for ₿AO markets.
 *
 * When a market has no trade history yet, bao.markets renders a seeded
 * random-walk sparkline from 0.5 to the current implied probability so the
 * chart is never empty. This port uses the same algorithm so the fallback
 * looks identical.
 */

export function synthesizeBaoSparkline(
  targetPrice: number,
  marketId: string,
  numPoints = 30,
): number[] {
  if (!Number.isFinite(targetPrice)) {
    targetPrice = 0.5;
  }

  const start = 0.5;
  const end = Math.max(0.02, Math.min(0.98, targetPrice));
  const diff = end - start;

  const isFlat = Math.abs(diff) < 0.01;
  const volatility = isFlat ? 0.08 : Math.abs(diff) * 0.6;

  // Seeded PRNG derived from the market id.
  let seed = 0;
  for (let i = 0; i < marketId.length; i++) {
    seed = ((seed << 5) - seed + marketId.charCodeAt(i)) | 0;
  }
  const rng = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed & 0x7fffffff) / 0x7fffffff;
  };

  const result: number[] = [start];
  for (let i = 1; i < numPoints - 1; i++) {
    const t = i / (numPoints - 1);
    const expected = start + diff * t;
    const u1 = rng() || 0.001;
    const u2 = rng();
    const noise =
      Math.sqrt(-2 * Math.log(u1)) *
      Math.cos(2 * Math.PI * u2) *
      volatility *
      0.15;
    const prev = result[i - 1];
    const reversion = (expected - prev) * 0.3;
    let val = prev + reversion + noise;
    val = Math.max(0.02, Math.min(0.98, val));
    result.push(val);
  }
  result.push(end);
  return result;
}
