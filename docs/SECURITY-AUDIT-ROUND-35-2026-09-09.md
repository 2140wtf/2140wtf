# Security Audit — Round 35 (2026-09-09)

**Focus:** ₿AO Markets (prediction markets) — kind-38000 market ingestion, outcome/end-tag bounds, client-side market creation. Feed/markets/fund campaign, trollbox excluded.

**Surface:** `src/lib/baoMarketParser.ts` (market parser), `src/components/CreateBaoMarketDialog.tsx` (publisher), `src/pages/PredictionMarketsPage.tsx` + `MilestoneMarketWidget` (reviewed, no change).

## Findings

### F-35-1: Outcome floods and junk end-times unbounded (Medium — layout/sort DoS)

`parseBaoMarket` sanitized individual labels but had no count or end-time bounds:

- **Outcomes:** a content `outcomes` JSON array with 5,000 entries, or 5,000 `outcome` tags, flowed into the market card's outcome buttons and the `1/N` probability math. Now capped at `MAX_MARKET_OUTCOMES = 20` on both paths.
- **`end` tag:** `end: 9007199254740991` (year 285,508; also reachable via the epoch-millis branch) pinned the market at the end of every time sort. Now `clampEndTime` restricts to epoch seconds 2020–2100 (the same shared window rounds 31/33 use); junk dates land on 0 = unknown instead of the market being dropped.
- **`category`/`state`:** stringified unbounded (megabyte tag values). Now `sanitizeSingleLine(..., 64)` capped.

Note: `content.endDate` is epoch **millis** (frontend converter convention) — converted to seconds before clamping; the read-side previously consumed it raw as seconds (year-57k market clocks), a latent display bug fixed together with the bound.

### F-35-2: Market publisher had no bounds (Low — publishing noise)

`CreateBaoMarketDialog` only required ≥ 2 outcomes: duplicate outcome labels (which then skew every reader's 1/N probability), unbounded title/description/end-days, and the same outcome flood from the write side. Now: outcomes deduped + 2–20 count (≤100 chars each), title 1–200 chars, description ≤ 5000 (mirroring the parser), expiry 1–1825 days; button and submit path both enforce `canPublish`.

## Verified safe (no change needed)

- **Signature check** — `parseBaoMarket` rejects events with invalid signatures before parsing.
- **Per-label sanitization** — outcome labels/ids stripped to single lines with length caps; ≥2-outcomes floor preserved.
- **Pool-model/type gating** — `amm`/`smj` allowlist, categorical/scalar only from matching sources.
- **API trade path** — `placeBaoTrade` requires NIP-98 signer; AMM→SMJ fallback rethrows non-AMM errors; no client-side spend decision.
- **PredictionMarketsPage/MilestoneMarketWidget** — render parsed markets only; no new parsing on those paths.

## Tests

- `baoMarketParser.test.ts` — 4 new adversarial cases (content/tag outcome floods, absurd `end` dates → 0, valid `end` preserved, category cap). 8/8 green; ESLint warning-free on touched files.
