# Security Audit — Round 30 (2026-09-07)

**Focus:** NIP-99 marketplace listing ingestion (attacker-controlled rendering + order math) and Cashu mint trust / quote lifecycle hardening.

**Surface:** `src/lib/nip99.ts` (kind-30402 parser), `src/lib/marketplace.ts` + `Nip99ListingCard.tsx` + `CreateOrderDialog.tsx` (buyer price computation), `src/lib/gammaMarkets.ts` (order-message parsing + aggregation over NIP-17 DMs), `src/hooks/useCashuWallet.ts` (`mintFromQuote` BOLT12 path).

## Findings

### F-30-1: NIP-99 parser accepted unbounded/Infinity listing fields (Medium — DoS + layout corruption)

`parseNip99Listing` consumed relay-supplied kind-30402 events with almost no bounds:

- `Number('1e999')` is **Infinity, not NaN** — a `price: 1e999` tag passed the `!Number.isNaN(priceValue)` check and produced `price.value === Infinity`, which poisons every downstream conversion (`amountSats: Infinity` → order dialogs, payment math).
- `shipping_option` extraCost had the same NaN-only guard (`extraCost: Infinity` reachable).
- No length caps: title/summary/content/location/images/categories from any pubkey could be megabytes of junk (layout break, IndexedDB bloat, gallery grid with 1000s of images).
- `published_at: 99999999999999` was accepted and distorts feed sort order.

**Fix:** `isValidListingPrice` (finite, ≥0, ≤ 21M-BTC msat-scale bound) for price and extraCost; caps on all string fields (2000 chars), images (20), categories (30, 64 chars each), shipping refs (20), location (200), currency (16), frequency (64); `published_at` must be in 1970–2100.

### F-30-2: sats/btc listings were unorderable when the BTC-rate API was down (High — availability)

`getListingPriceState` required a live `btcPrice` **even for sats/sat/btc prices**, which are intrinsically denominated and never need a conversion. With the rate API down, every sats-denominated listing sat on "Loading price…" forever — the Buy button disabled. (Same defect in `Nip99ListingCard`'s duplicate price logic.)

**Fix:** sats/btc convert without the rate; only fiat→sats needs it. Also hardened: a non-finite/non-positive `btcPrice` for fiat conversion returns `loading` instead of dividing by a broken rate, and every computed sats amount is capped at `MAX_ORDER_SATS` (Bitcoin supply bound) so a hostile price can't inflate the order total past what payment executors accept.

### F-30-3: Gamma order aggregation trusted any sender for any role (High — state forgery)

Gamma order messages are kind-16/17 events inside NIP-17 gift wraps in the DM inbox. **Anyone who knows a participant's npub can send one with any `order` tag value.** `aggregateGammaOrders` applied every parsed message unconditionally:

- A forged type-2 payment request from a non-merchant **overwrote `order.paymentRequest`**, blocking the real merchant's request-payment action and pointing the buyer's Pay dialog at attacker-controlled payment values (the round-29 amount check validates the invoice encodes the order amount — a forged request with a matching amount still redirects the payout to the attacker).
- A forged type-3 status update could cancel/complete someone else's order.
- A forged kind-17 receipt from a stranger made the order look paid.
- A duplicate type-1 creation from a different pubkey silently **replaced the genuine creation** (order hijack — the old code had no createdAt comparison and no sender check).

**Fix:** first-party role enforcement in `aggregateGammaOrders`: type-2/type-4 only from the creation's merchant, type-3 only from buyer or merchant, receipts only from the buyer, and first-valid-creation-wins (same parties + newer createdAt may replace). Forged messages are ignored for state. Additionally: amounts capped at the supply bound with a finite check (Infinity passed the old NaN guard), quantities ≤ 1M, order ids ≤ 200 chars, tracking/carrier/eta length caps, eta must be epoch-seconds in 2020–2100.

### F-30-4: order dialog total could overflow the amount cap (Medium)

`CreateOrderDialog` computed `totalSats = unitSats * quantity` with an unbounded quantity input.

**Fix:** quantity clamped to `MAX_ORDER_TOTAL_SATS / unitSats`; both the input handler and the submit path use the clamp.

### F-30-5: BOLT12 mint delta from the mint was unvalidated (Low — hardened)

`mintFromQuote` used `checkedBolt12.amount_paid - amount_issued` (mint-reported) as the issuance amount with no validation. **Zero is legitimate** (reusable offer, no new increment — routes to the UNPAID path), and no upper cap applies (a payer can legitimately pay any amount into a reusable offer), so only negative/non-integer deltas fail closed. The existing post-mint `mintedAmount !== mintAmount` check still catches wrong issuance totals. *The first draft of this guard rejected the legitimate zero case — caught by the existing test suite (`does not issue a BOLT12 quote again when no new amount is available`) and corrected; the test suite is the reason this shipped right.*

## Verified safe (no change needed)

- **NUT-04 bolt11 quote lifecycle** — double-mint guards (minted-quote journal + cross-tab mutex + in-lock `checkMintQuote`), NUT-20 locked quotes with per-quote keys, counter journal + NUT-09 restore for interrupted mints, journal-before-validate ordering. Hardened in earlier rounds and still sound.
- **Mint trust boundaries** — `isAllowedMintUrl` (HTTPS-only, private-range + IPv4-mapped-IPv6 blocks from round 25), unknown-mint token receives load the foreign mint with `requireDleq: true`, fee-gate `isFeeWithinMaxPpm` (round 27b exact BigInt math).
- **Listing image rendering** — `SafeImage` → `sanitizeUrl` (HTTPS-only + local-network refusal); `ImageGallery` consumes the already-capped `listing.images`.
- **Payment option values in UI** — rendered as text nodes only, no linkification of attacker-supplied values.

## Tests

- `nip99.test.ts` — 9 new adversarial cases (Infinity/supply-bound prices, image/category/length/ref caps, absurd published_at, currency/frequency caps).
- `marketplace.test.ts` — 5 new cases (sats/btc without rate, fiat still needs rate, ceiling rejection, broken-rate handling, Infinity price).
- `gammaMarkets.test.ts` — **new file**, 13 cases: all caps plus the role matrix (legit merchant request, forged request/status/receipt/duplicate-creation from strangers, real-buyer receipt accepted).
- Full suite: **1,999 tests / 203 files green**; tsc, ESLint, build clean.
