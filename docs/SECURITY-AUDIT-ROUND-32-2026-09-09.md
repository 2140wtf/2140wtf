# Security Audit — Round 32 (2026-09-09)

**Focus:** ₿AO Fund (milestone funding + streams) — campaign creation, contribution, milestone release, quota pre-check. Feed/markets/fund campaign, trollbox excluded.

**Surface:** `src/lib/baoFundraising.ts` (API client), `src/components/bao-fund/CreateCampaignDialog.tsx`, `src/pages/BaoFundingPage.tsx` (contribute/release mutations), `src/components/bao-fund/computeCreditsUtils.ts`.

## Findings

### F-32-1: Campaign goal/milestone amounts had no client-side upper bound (Low-Med — input integrity)

`CreateCampaignDialog` validated `goal ≥ 1000` but nothing above: `parseInt('99999999999999999')` yields the imprecise float `1e17`, which is sent to the API as `goal_sats`/`amount_sats` — a corrupted ledger row and a nonsense public campaign.

**Fix:** goal and per-milestone amounts are validated against `MAX_ORDER_SATS` (21M-BTC sats bound, same constant the marketplace order path uses) with explicit error messages.

### F-32-2: Quota pre-check interpolated the pubkey unencoded (Low — defense-in-depth)

`fetchFundraiserQuota` built `?pubkey=${pubkey}` raw — the only API call site not using `encodeURIComponent`. Pubkeys are hex today, but every other interpolated identifier (fundraiser ids, milestone ids) is encoded; a future key format with URL metachars would break the quota check silently (the catch-all returns null = "unknown, proceed").

**Fix:** `encodeURIComponent(pubkey)`.

## Verified safe (no change needed)

- **Contribution idempotency** — the funding dialog keeps a stable per-checkout key in `idemKeyRef` (rotated to null on success), so a network retry dedupes server-side instead of double-charging; the `replayed` response is surfaced to the user.
- **Self-funding block** — campaign owners cannot contribute to their own campaign (case-insensitive pubkey compare).
- **Custodial-first spend** — `sendDemoSats` with a scoped `fundraiser:<id>` destination is tried before the nutzap fallback; the fallback is Cashu-only with explicit balance pre-check and unknown-payment-outcome handling.
- **Milestone release** — stable per-milestone idempotency keys, in-flight tracking, NIP-98 server-side ownership verification; the client cannot forge a release.
- **Quota enforcement** — the pre-check is advisory only (`null` = proceed); the server still enforces 2/hour, 5/day.
- **Relay-first create** — random per-intent `d` tag prevents un-ingested intent replacement; the REST fallback carries the intent id so the bridge cannot double-create.
- **Compute-credits outbox** — storage keys scoped by funder pubkey (shared-browser safety), non-bearer lock-shaped tokens detected and rejected before the unsigned Routstr split.
- **Stream accounting** — vested/claimable sats are server-computed; the client only renders them.

## Tests

- Existing `CreateCampaignDialog.test.tsx` (8 cases) green with the new bounds; ESLint clean on all touched files. (Bounds are additive validation messages — existing fixtures unaffected.)
