/** Parse the sats amount from a BOLT11 invoice's human-readable part.
 *  Returns null for amountless invoices (e.g. `lnbc1...`).
 */
export function parseBolt11Amount(bolt11: string): number | null {
  const match = bolt11.toLowerCase().match(/^ln\w+?(?:(\d+)([munp]?))?1/);
  if (!match || match[1] === undefined) return null;
  const value = parseInt(match[1], 10);
  if (isNaN(value)) return null;
  const multiplier = match[2];
  switch (multiplier) {
    case 'm': return value * 100_000;     // milli-BTC → sats
    case 'u': return value * 100;         // micro-BTC → sats
    case 'n': return value / 10;          // nano-BTC → sats
    case 'p': return value / 10_000;      // pico-BTC → sats
    default:  return value * 100_000_000; // BTC → sats
  }
}
