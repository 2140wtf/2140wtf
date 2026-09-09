# Security Audit — Round 34 (2026-09-09)

**Focus:** Feed/markets URL-rendering surface audit + proxy-bidding overpay logic. Feed/markets/fund campaign, trollbox excluded.

**Surface:** `NoteContent.tsx`, `LinkEmbed.tsx` (+ chat variant), `SafeLink.tsx`, `sanitizeUrl.ts`, `RedditEmbed.tsx`, `ExternalContentHeader.tsx` / `BitcoinContentHeader.tsx` (feed+market URL renderers); then `useProxyBidding.ts` + `auctionRules.ts` `proxyRaises` (auction).

## Findings

### F-34-1: Proxy bidding could raise to beat an equal-priced bid the bidder already owns (Low — asset overpay)

`proxyRaises`'s "already leading" guard keyed on **event identity** (`myLatestBid.eventId === standing.eventId`). But eBay tie rules say the **earliest equal-priced bid stands** — and `useProxyBidding` recomputes `standing` in time order, advancing only on `>`, so `standing` can legitimately be an **earlier equal-priced bid owned by the same bidder while `myLatestBid` is a later duplicate** (a relay split re-read produces exactly this). In that window:

- The outbid guard is skipped (`standing.pubkey === bidderPubkey`),
- `proxyRaises` computes `target = Math.min(maxSats, standingSats + increment)`,
- since `standingSats` equals `myVisible`, `target > myVisible` → it **raises one extra increment** against the bidder's own committed max that they did not need.

Arrow was chain of custody: round 31 (F-31-1) made the lock path functional, which makes this latent overpay bug reachable in production for the first time.

**Fix:** `proxyRaises` now treats **"my latest visible bid already equals the standing price" as the lead** (`standing && myVisible >= standing.amountSats → []`), ownership-agnostic but price-exact — a bidder who has a bid at the standing price is by definition the winner under eBay's tie rule, so there is never a need to raise. Rival-owned equal-priced standings still raise normally.

**Regression test:** three new `proxyRaises` cases — (1) later duplicate of my own equal raise → no raise (the overpay guard), (2) rival's equal-priced standing bid → still raises one increment, (3) existing leading/no-change/zero-max cases preserved.

### F-34-2 (verified-safe pass): Feed + market URL rendering is already hardened

Reviewed `sanitizeUrl` (HTTPS-only, `isLocalNetworkUrl` blocks loopback/private/link-local), `SafeLink` (renders placeholder `<span>` for unsafe), `NoteContent` (external links via `PlainLinkFallback` → `sanitizeUrl` + `rel="noopener noreferrer"`), both `LinkEmbed` variants (same rel), `RedditEmbed` (iframe src forced to `https://embed.reddit.com` after scheme+host allowlist), `ExternalContentHeader`/`BitcoinContentHeader` (internal `/r/<naddr>` links). **No XSS or `javascript:` sink found** — the `javascript:` hits are all in `javascript:` *sanitizer guards/comments*, not sinks. No change needed.

## Tests

- `auctionRules.test.ts` — 3 new `proxyRaises` adversarial cases (self-tie overpay, rival-tie still-raises, regressions). 
- Full cashu+marketplace suites: 19 files / 237 tests green; ESLint clean on touched files.