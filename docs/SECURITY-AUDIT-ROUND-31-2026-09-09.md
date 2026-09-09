# Security Audit — Round 31 (2026-09-09)

**Focus:** Cashu auction flow end-to-end — the newest unaudited money path (escrow-locked bids, kind-30401 bid ingestion, buy-now, bid validation). Feed/markets/fund campaign, trollbox excluded.

**Surface:** `src/lib/cashu/auction.ts` (listing + bid parsers, bid validation), `src/hooks/useAuctions.ts` (queries), `src/components/marketplace/AuctionBidDialog.tsx` (escrow lock + publish).

## Findings

### F-31-1: Escrow lock used the seller as the "operator" — every bid failed (High — funds flow broken)

`AuctionBidDialog` locked the bid with `{partyA: bidder, partyB: seller, operator: seller}`. The escrow primitive (`buildMultisigEscrowLock`) requires **three distinct keys** and throws `Escrow parties and operator must be three distinct keys` → `sendMultisigLockedToken` returned null before any debit → **no bid could ever be placed** ("Wallet could not lock the bid amount"). Even if duplicates were tolerated, a seller-controlled operator slot would let the seller co-sign releases without neutral oversight.

**Fix:** use the same neutral escrow operator the pet battles use (`config.petsBattleEscrowPubkey`); `canBid` fails closed when the operator is not configured.

### F-31-2: Buy-now published the SELLER's auction from the BUYER's key (High — phantom auction, close never lands)

Buy-now republished the seller's kind-30402 with `status=sold` (`prev: auction.event`) signed by the **buyer**. NIP-33 replaceability is per (kind, pubkey, d): a buyer-signed copy can never replace the seller's event — the real auction stayed open (others keep bidding into a "sold" purchase) while a **phantom duplicate auction owned by the buyer** appeared in the listings. The settlement module already assigns CLOSE to the seller ("the seller republishes … status = sold").

**Fix:** the buyer's bid now carries a `buy_now` marker tag instead of impersonating the seller's event; the seller closes/settles through their existing close-now flow. Toast copy updated to match reality.

### F-31-3: `parseAuctionListing` had no field caps (Medium — DoS/layout)

Round 30 capped `parseNip99Listing`, but the auction parser is a separate ingestion path with zero bounds: title/summary/content/images/categories from any pubkey could be megabytes of relay junk.

**Fix:** mirrors round 30 — strings capped at 2000 chars (incl. the dTag-as-title fallback), images ≤ 20 (2000-char URL cap + scheme check), categories ≤ 30 (deduped, 64 chars each).

### F-31-4: Unbounded money and time fields (Medium)

- `startingSats`/`buyNowSats`/bid `amount` accepted up to `MAX_SAFE_INTEGER` (9.007e15) — 43× Bitcoin's total supply; passes `isSafeInteger`, poisons the increment chain and renders absurd amounts. Auctions are sats-denominated, so they are now capped at `MAX_ORDER_SATS` (2.1e15, the same 21M-BTC bound round 30 applies to order totals). Note: `MAX_LISTING_PRICE` (21e15, msat-scale) is intentionally NOT used here — it exceeds `MAX_SAFE_INTEGER`, making any such cap unreachable.
- `closesAt` accepted any positive number: `close: 99999999999999` (year ~5M) keeps a junk auction "active" forever. Now bounded to epoch seconds 2020–2100 (mirroring round 30's `published_at` window).

### F-31-5: Bid `p2pk` escrow key unvalidated (Medium — settlement integrity)

Any garbage string was accepted as the bidder's escrow pubkey. The winning token's lock is verified against this key at settlement — a malformed key strands the winner's funds, a wrong-but-valid key points the release at an attacker-chosen lock.

**Fix:** `escrowPubkey` must be well-formed hex (64-char x-only or 66-char compressed, lowercased); otherwise the field is dropped.

### F-31-6: Bid aggregation trusted the relay's `#a` filter (Low — defense-in-depth)

`useAuctionBids` relied on the relay-side `#a` filter; `summarizeBids` has no way to know the target auction. A misbehaving relay could inject cross-auction bids into the highest-bid computation. **Fix:** parsed bids are filtered to the exact expected address before aggregation.

## Verified safe (no change needed)

- **Escrow primitive integrity** — `buildMultisigEscrowLock` enforces three distinct keys, refund key must be a party, sane locktime; NUT-11 refund path documented and journaled before network operations (`savePendingBidDeposit` before publish).
- **Bid privacy** — proofs never appear in bid events; only amount + P2PK key travel on relays (token via NIP-17 DM), so relay readers cannot spend locked funds.
- **Proxy-bid commitments** — hash commitment published, secret kept in the local journal; `evaluateReserve` fails closed on unrevealed reserves.
- **Tie-breaking** — eBay rule (earliest bid wins ties) preserved by `summarizeBids` sort.

## Tests

- `auction.test.ts` — 9 new adversarial cases (supply-bound listing/bid/buy-now rejection, 2020–2100 close window, string/image/category caps, malformed-p2pk matrix, supply-capped `validateBidAmount`); one legacy fixture updated (`close: '1'` was a 1970 timestamp the new window correctly rejects).
- Full suite: 42/42 auction cases green; ESLint clean on all touched files.
