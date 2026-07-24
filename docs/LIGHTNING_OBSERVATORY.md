# Lightning Observatory (in-app)

The sidebar's **LIGHTNING OBSERVATORY** entry opens a native in-app page at
`/lightning-observatory` — clicking it loads the observatory directly, no
external tab.

## Why not an iframe

[lightningobservatory.com](https://lightningobservatory.com/) sends
`X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'self'`,
so the full 3D observatory cannot be embedded. Instead the page renders the
network natively from the observatory's public JSON API.

## Data source

`GET https://lightningobservatory.com/api/network` returns live aggregate
stats:

```json
{
  "nodeCount": 16835,
  "channelCount": 31044,
  "edgeCount": 31044,
  "totalCapacity": 146666332527,
  "avgChannelSize": 4724466.32,
  "maxChannelSize": 1000000000,
  "blockHeight": 959358,
  "source": "live"
}
```

(capacity and channel sizes in sats). The page refreshes every 60s.

The API sends no CORS headers, so the client fetches it the same way the
bao.markets client does (`src/lib/lightningObservatory.ts`, mirroring
`baoApiFetch`):

1. **Same-origin `/lo-api/*`** first — provided by the vite dev/preview
   proxy (`vite.config.ts`) and, in production, by a host rule forwarding
   `/lo-api/*` → `https://lightningobservatory.com/api/*`.
2. **Public URL fallback** — works if the observatory ever enables CORS;
   otherwise the page shows an "open the full observatory" fallback card.

## Page contents

- Six stat cards: nodes, channels, total capacity (BTC), average channel,
  largest channel, block height — with a LIVE badge from the `source` field.
- A "Full observatory" button linking out to the 3D experience.
- The NIP-73 discussion thread for the observatory URL (same comment root
  as the old `/i/<url>` page), so the conversation is preserved in-app.

## Sidebar migration

The entry used to be the external URI `https://lightningobservatory.com/`
(an `/i/` discussion item). `SIDEBAR_ID_MIGRATIONS` in
`src/hooks/useFeedSettings.ts` maps that legacy id to
`lightning-observatory`, and the migration effect inserts the new item below
**NOSTR PETS** for existing users. Fresh installs get it in
`DEFAULT_SIDEBAR_ORDER`.

Files: `src/pages/LightningObservatoryPage.tsx`,
`src/lib/lightningObservatory.ts` (+ tests), `src/hooks/useLightningObservatory.ts`.
