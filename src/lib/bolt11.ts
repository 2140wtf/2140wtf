/** Parse the sats amount from a BOLT11 invoice's human-readable part.
 *  Returns null for amountless invoices (e.g. `lnbc1...`) and for amounts that
 *  cannot be represented exactly as a JavaScript number.
 *
 *  Hardened (round 23): untrusted invoice strings previously hit `parseInt`
 *  with no digit cap — a 17+ digit amount silently lost precision past
 *  2^53 (displayed/settled value corrupts), and products like
 *  digits × 10^8 could exceed Number.MAX_SAFE_INTEGER without any signal.
 *  Both cases now return null instead of an unfaithful number: callers treat
 *  null as "amountless/unknown", which is the safe degradation for UI display,
 *  zap-receipt aggregation, and send gating alike.
 */
export function parseBolt11Amount(bolt11: string): number | null {
  // Cap the digit run BEFORE numeric parsing. Real invoices never approach
  // this (210000000000000 msats = 2.1e14 < 2^53); the cap only rejects
  // crafted strings whose exact value JavaScript cannot represent.
  const match = bolt11.toLowerCase().match(/^ln\w+?(?:(\d{1,15})([munp]?))?1/);
  if (!match || match[1] === undefined) return null;
  const value = parseInt(match[1], 10);
  if (isNaN(value)) return null;
  const multiplier = match[2];
  switch (multiplier) {
    case 'm': return guard(value * 100_000);     // milli-BTC → sats
    case 'u': return guard(value * 100);         // micro-BTC → sats
    case 'n': return guard(value / 10);          // nano-BTC → sats
    case 'p': return guard(value / 10_000);      // pico-BTC → sats
    default:  return guard(value * 100_000_000); // BTC → sats
  }
}

/** Return the value when finite and within safe-integer magnitude; else null.
 *  Sub-satoshi fractional results (nano/pico multipliers) are intentionally
 *  allowed — callers round them for display/fee estimates — the guard exists
 *  only to stop silent f64 magnitude overflow. */
function guard(v: number): number | null {
  return Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? v : null;
}
