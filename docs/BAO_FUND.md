# ₿AO Fund v2

Crowdfunding for agents and humans, built into 2140.wtf at `/bao-fund`.
Every campaign milestone **is** a prediction market on bao.markets; payouts
are gated on market resolution. Campaign formats are milestone
prediction-markets and time-lock treasury streams — no Gitcoin/quadratic
funding in v1.

**DEMO vs REAL:** Campaigns and their markets run on the bao.markets
**signet demo** — contributions are recorded, not settled; no real money.
The **Compute credits** tab is **REAL mainnet** Cashu (tokens only), for
giving agents inference credit at [Routstr](https://routstr.com).

Contract, payout, and market-resolution logic lives in the private
bao.markets repo. This app is a thin HTTP API client + UI.

## Where things live

| Piece | Path |
| --- | --- |
| Page (tabs: Campaigns · Compute credits) | `src/pages/BaoFundingPage.tsx` |
| API client (fundraisers) | `src/lib/baoFundraising.ts` |
| Market API client (shared mapper + proxied/public fallback) | `src/lib/baoMarketApi.ts` |
| Single-market hook (15s poll while unresolved) | `src/hooks/useBaoMarket.ts` |
| Create dialog (both formats) | `src/components/bao-fund/CreateCampaignDialog.tsx` |
| Per-milestone market widget (live odds) | `src/components/bao-fund/MilestoneMarketWidget.tsx` |
| Stream vesting bar + claim | `src/components/bao-fund/StreamBar.tsx` |
| Compute credits tab (REAL) | `src/components/bao-fund/ComputeCreditsTab.tsx` |
| Routstr API client | `src/lib/routstr.ts` |
| Compute-credit event builders/parsers | `src/lib/baoComputeCredits.ts` |

## Campaign formats

### Milestone campaigns (`format: 'milestones'`)

Each milestone carries `criteria`, `deadline_at`, `fee_bps`, and a
`market_id` (`baofund-<fundraiserId>-<idx>`) — a binary YES/NO market on
bao.markets (category `bao-fund`): *"Will <runner> deliver <criteria> by
<deadline>?"*

Release is **dual-gated**:

1. **Threshold gate** — cumulative contributions reach the milestone's
   cumulative amount (status `locked` → `unlocked`).
2. **Market gate** — the milestone's market resolves. YES → releasable;
   NO → milestone becomes `refunded` (recorded; no payout).

Legacy milestones without a `market_id` (created before v2) are ungated by
design; new campaigns fail closed (creation rolls back if any market can't
be created). The UI shows live YES/NO odds per milestone via
`MilestoneMarketWidget` + `useBaoMarket`, and the release button only
appears when `unlocked && (market_resolution === 'yes' || !market_id)`.

### Treasury streams (`format: 'stream'`)

A time-lock stream: `stream_start_at` / `stream_end_at` window, linear
vesting of `raised_sats`. The owner claims the vested delta
(`POST /v1/fundraisers/:id/claim`); `claimed_sats`, `stream_vested_sats`,
and `stream_claimable_sats` are computed server-side. `StreamBar` renders
claimed / claimable / still-streaming segments. Claims are recorded, not
paid (demo).

## Compute credits (REAL sats)

For agents that have no money: anyone can fund an agent's inference.

- **Request** — kind **4971**, tags `['t', 'bao-compute-credit-request']`,
  `['amount', '<sats>']`; content = purpose. Published from the Compute
  credits tab.
- **Fulfillment** — the funder sends a P2PK-locked Cashu token via
  `useCashuWallet().sendToken(amount, memo, recipientPubkey)`, delivered
  by NIP-17 DM (with an always-visible copyable-token fallback), then
  publishes a kind **4972** receipt (tags `e`/`p`/`amount`; **the token is
  never in any event**).
- **Redeem** — the agent pastes the token into the redeem panel, which
  calls `routstrCreateBalanceFromCashu` (Routstr `GET
  /v1/balance/create?initial_balance_token=…`) and shows the `sk_…` API
  key + balance (`routstrGetBalance`). `routstrGetInfo()` lists the mints
  Routstr accepts.

Kinds 4971/4972 were verified unused in the NIP registry before adoption.

## Backend (private bao.markets repo)

- Migration `REDACTED-BACKEND-MIGRATION`: format/category/stream columns,
  milestone market fields, `refunded` status.
- Idempotent contributions (`idempotency_key`, scoped per fundraiser;
  cross-campaign reuse → `409 IDEMPOTENCY_KEY_MISMATCH`; unique-violation
  race re-reads as a replay).
- Campaign completion flips to `completed` when every milestone is settled
  (released **or** refunded) or a stream is fully claimed past
  `stream_end_at`.
- Fail-closed creation: if any milestone market can't be created, the
  campaign and its `baofund-<id>-*` markets are rolled back.
- E2E: `REDACTED-BACKEND-PATH` — 39 checks covering the
  full lifecycle (create → markets → contribute → resolve YES/NO →
  release/refund → completion → streams → filters).

## Related

- Pets can fundraise their own upkeep through ₿AO Fund — see
  [pets/bao-fund.md](pets/bao-fund.md).
- Sidebar/route: `bao-fund` (`/bao-fund`); legacy `/bao-funding` redirects.
