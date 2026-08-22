# BAO Markets Architecture — 2140.wtf

> **Last updated:** 2025-08-22  
> **Author:** 2140wtf  
> **Related:** NIP.md § Kind 38000, bao.markets API (`/bao-api/v1/`)

## Overview

2140.wtf integrates BAO prediction markets through a **dual-source discovery** model: Nostr relay definitions (kind 38000) for market presence, plus the bao.markets REST API for live odds, volume, and trade history. Markets are displayed on the `PredictionMarketsPage` (`/prediction-markets`) and individually via `BaoMarketDetailDialog`.

## File Map

```
src/hooks/
├── useBaoTopPredictionMarkets.ts    # Top-volumes hook (primary)
├── useBaoPredictionMarkets.ts       # Paginated catalog hook
├── useBaoRelayMarkets.ts            # Relay-only fallback hook
├── useBaoMarketCategories.ts        # Category catalog
├── useBaoSmjOdds.ts                 # SMJ parimutuel odds per market
├── useBaoMarketPriceHistory.ts      # Trade history candles
├── useBaoSmjHistory.ts              # SMJ pool share curve
├── useUrlSelectedBaoMarket.ts       # URL ?market= param → selection

src/lib/
├── baoMarketParser.ts               # BaoMarket type, parseBaoMarket (relay events)
├── baoMarketApi.ts                  # ApiMarket type, apiMarketToBaoMarket, baoApiFetch
├── baoRelayMarkets.ts               # Relay merger, BAO_MARKETS_RELAY constant
├── baoChartData.ts                  # Synthetic history generator, normalizer

src/components/
├── CreateBaoMarketDialog.tsx         # Publish kind-38000 via useNostrPublish
├── BaoMarketChart.tsx                # Lightweight-charts price chart (outcome line renderer)
├── BaoMarketDetailDialog.tsx         # Full-screen market detail + BaoExpressTrade
├── MarketMiniSparkline.tsx           # Tiny sparkline on market cards
├── BaoExpressTrade.tsx               # Order form in detail dialog

src/pages/
└── PredictionMarketsPage.tsx         # Full markets page: grid, filters, create button
```

## Data Flow

```
┌─────────────────────┐         ┌──────────────────────────────┐
│  Nostr Relay        │         │  bao.markets REST API        │
│  wss://relay.bao    │         │  https://relay.bao.network   │
│                     │         │  /bao-api/v1/                │
│  kind 38000 events  │         │                              │
│  (market defs)      │         │  GET /markets   → ApiMarket[]│
│                     │         │  GET /smj/:id → odds curve   │
│  parseBaoMarket()   │         │  GET /categories → slug list │
│  → BaoMarket        │         │                              │
└────────┬────────────┘         └──────────┬───────────────────┘
         │                                 │
         │   mergeApiAndRelayMarkets()     │
         └──────────┬──────────────────────┘
                    │
                    ▼
            RelayMergedMarket[]
            (poolModel, oddsAvailable, totalVolumeSats, paymentRails)
                    │
                    ▼
        ┌───────────────────────────┐
        │   Progressive rendering   │
        │   visibleCount = 8,       │
        │   IntersectionObserver    │
        │   loads 8 more on scroll  │
        └───────────┬───────────────┘
                    │
                    ▼
        ┌───────────────────────────┐
        │  useBaoSmjOdds(visible)   │
        │  Only fires /smj/:id for  │
        │  currently-mounted SMJ    │
        │  markets (not all 500+)   │
        └───────────┬───────────────┘
                    │
                    ▼
            MarketsWithOdds[]
            (with probability overrides for SMJ outcomes)
                    │
                    ▼
        ┌───────────────────────────┐
        │  MarketCard grid          │
        │  - YES/NO % split bar     │
        │  - category badge         │
        │  - rail chips             │
        │  - mini sparkline         │
        │  - Buy Yes / Buy No       │
        │  - Volume, trade count    │
        └───────────────────────────┘
```

## API Endpoints

### Primary Base

```
https://relay.bao.network/bao-api/v1
```

The app also tries the same-origin proxy `/bao-api/v1` first (Vite dev proxy or nginx proxy), falling back to the public host when the proxy is missing or returns non-JSON.

### Market Catalog

```
GET /markets?status=active&sort_by=total_volume&sort_dir=desc&limit=20
```

Response shape:

```json
{
  "data": [
    {
      "id": "market-abc123",
      "title": "Will BTC hit 214k by 2027?",
      "description": "...",
      "category": "bitcoin",
      "type": "binary",
      "status": "active",
      "created_at": 1724000000,
      "end_date": 1798761600,
      "creator_pubkey": "...",
      "outcomes": [
        { "id": "yes", "label": "YES", "price": 0.62, "volume": 150000 },
        { "id": "no", "label": "NO", "price": 0.38, "volume": 95000 }
      ],
      "total_volume": 245000,
      "trade_count": 342,
      "liquidity": 12000,
      "pool_model": "smj",
      "smj": true,
      "payment_rails": ["htlc", "spark", "l1"],
      "nostr_event_id": "sha256of38000..."
    }
  ]
}
```

### SMJ Parimutuel Odds

```
GET /smj/{marketId}
```

Returns the live pool share curve — the true probability distribution for SMJ markets. The API's static `outcome.price` in the catalog is a stale default for SMJ pools; this endpoint carries the real odds.

### Market Detail

```
GET /markets/{marketId}
```

### Trade History

```
GET /markets/{marketId}/history?range=1D|1W|1M|ALL
```

### Trade Execution

```
POST /markets/{marketId}/trade
```

### Categories

```
GET /categories
```

Returns `{ slug, label, count, active_count }` for the category filter dropdown.

## Core Types

### BaoMarket (unified)

```typescript
interface BaoMarket {
  marketId: string;
  title: string;
  description: string;
  category: string;
  state: 'active' | 'resolved' | 'ended';
  type: 'binary' | 'categorical' | 'scalar';
  endTime: number;           // unix seconds
  createdAt: number;         // unix seconds
  poolModel?: 'smj' | 'amm'; // drives real-odds fetch
  paymentRails?: string[];
  totalVolumeSats?: number;
  tradeCount?: number;
  liquiditySats?: number;
  outcomes: BaoMarketOutcome[];
  creatorPubkey: string;
  resolution?: string | null;
  rawEvent: NostrEvent;      // relay definition (always present)
}

interface BaoMarketOutcome {
  id: string;
  label: string;
  probability: number;        // 0.0–1.0; updated by SMJ odds
  volumeSats?: number;
}
```

### ApiMarket (wire type)

Mirror of the REST API response. Converted to `BaoMarket` via `apiMarketToBaoMarket()` which:
- Maps `outcome.price → probability`
- Maps `outcome.volume → volumeSats`
- Sets `poolModel: 'smj'` when `smj: true` or `pool_model: 'smj'`
- Excludes `bao-fund` category from SMJ odds lookup (they 404 the `/smj/:id` endpoint)

## Odds Merging Logic

```typescript
// In PredictionMarketsPage.tsx
const smjIds = visibleMarkets
  .filter(m => m.poolModel === 'smj')
  .map(m => m.marketId);
const smjOdds = useBaoSmjOdds(smjIds);  // batched SMJ requests

const marketsWithOdds = mergedMarkets.map((m) => {
  // SMJ markets without a funded pool → hide fabricated 50/50 odds
  if (m.poolModel === 'smj' && !smjOdds[m.marketId]) {
    return { ...m, oddsAvailable: false };
  }
  return withSmjOdds(m, smjOdds);  // overlay live pool share onto outcomes
});
```

## Circuit Breaker

Located in `baoMarketApi.ts`. After 3 failures within 10 seconds, the circuit opens and every BAO market API call fails silently for 60 seconds. When the cooldown expires, one probe is released — success closes the breaker, failure re-trips it. Prevents console-error storms on relay.bao.network outages.

## Market Creation

Markets are created via `CreateBaoMarketDialog`, which publishes a kind-38000 event directly to the relay using `useNostrPublish`:

```typescript
await publishEvent({
  kind: BAO_MARKET_KIND,  // 38000
  content: JSON.stringify({ title, description, outcomes }),
  tags: [
    ['d', `market-${crypto.randomUUID()}`],
    ['title', title],
    ['c', category],
    ['n', BAO_MARKET_NETWORK],  // 'demo'
    ['end', String(endUnix)],
    ...outcomes.map(o => ['outcome', o]),
    ['alt', 'Prediction market definition'],
  ],
  relay: BAO_MARKETS_RELAY,  // 'wss://relay.bao.network'
});
```

Categories: bitcoin, politics, sports, nostr, angor-markets, culture, events, climate-energy, economics, tech-science, bao, other.

## Rendering

### MarketCard (grid items)

- **Binary markets:** YES/NO percentage row + split progress bar
- **Categorical markets:** Per-outcome progress bars (up to 3 visible, "+N more" indicator)
- **Rail chips:** ⚡ (htlc), SPARK, CASHU, LIQUID, ₿ (l1/onchain), FEDIMINT (ecash)
- **Mini sparkline:** Tiny trade history sparkline below rail chips
- **Action buttons:** Details / Buy Yes / Buy No (or Trade for categorical)
- **Meta:** Duration badge, end date, volume (sats), trade count

### BaoMarketChart (detail dialog)

Professional line chart using `lightweight-charts`. Renders outcome price curves with:
- Time range selector (1H, 1D, 1W, 1M, ALL)
- Outcome pill selector (colored per-outcome)
- Mirrored NO curve derived from YES history (binary pairs)
- Synthetic history fallback when real volume exists but no historical fills
- Chart watermark (₿AO.markets)

### Progressive Rendering

Initial batch = 8 cards. `IntersectionObserver` with 800px root margin loads 8 more per scroll. Odds sub-requests only fire for the currently mounted batch, preventing hundreds of parallel `/smj/:id` calls on initial load.

## Source Toggle

Users can switch the data source between:
- **API** — bao.markets REST API only (default, carries real odds)
- **Relay** — kind-38000 events only (no odds, no volume — debug mode)
- **Both** — merge API definitions with relay definitions (deduped by `d` tag)

Stored in `localStorage.bao-market-source`.