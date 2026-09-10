# Security Audit — Round 36 (2026-09-09)

**Focus:** Marketplace query hooks — relay-query integrity for listing and order reads. Feed/markets/fund campaign, trollbox excluded.

**Surface:** `src/hooks/useNip99Listings.ts`, `src/hooks/useGammaOrders.ts` (reviewed), `src/pages/MarketPage.tsx` (caller, reviewed).

## Findings

### F-36-1: Caller-supplied query ranges unbounded (Low-Med — memory/DoS)

`useNip99Listings` accepted arbitrary `lookbackDays`/`limit`/`category` options straight into the relay filter, the `since` computation, and the react-query key:

- `limit: 100000` asks **each** relay set for 100k events (100k × ~2KB = 200MB per set before dedupe, plus `sort` + `dedupeNip99Listings` on the main thread).
- `lookbackDays: 999999` overflows `86400 * days` toward `-Infinity` `since`, making relays scan their whole store; `NaN`/`-5` equally poison the filter.
- `category: 'x'.repeat(9000)` bloats the `#t` filter and the query key identically.

**Fix:** `clampNip99QueryOptions` — limit clamped to [1, 2000] (2000 matches the heaviest sanctioned batch already fetched elsewhere), lookback clamped to [0, 3650] days with non-finite → default; `clampNip99Category` lowercases + caps at 64 chars (matches the per-category cap in `parseNip99Listing`). All three flow through the relay filter, key, and local category match.

### F-36-2: Verified safe — DM order reads

`useGammaOrders` reads the already-parsed, round-30/33-capped DM inbox and filters by exact pubkey equality; the per-order lookup is a linear find over an in-memory aggregate (no relay influence). No change needed.

## Tests

- `useNip99Listings.test.ts` — **new file**, 5 cases (defaults, limit caps, lookback caps + NaN/Infinity rejection, fractional flooring, category lowercase+64 cap).
