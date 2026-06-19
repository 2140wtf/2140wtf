# P2P Trades — Feature Scope

> **Status:** Design draft  
> **Goal:** Add a Vexl-inspired, Nostr-native peer-to-peer Bitcoin trading layer to Ditto, built on NIP-99 classified listings and a public-web-of-trust reputation model, without phone numbers.

---

## 1. Elevator Pitch

**P2P Trades** lets Ditto users publish Bitcoin buy/sell offers as ordinary NIP-99 classified listings, discover offers within a configurable trust radius, negotiate privately via encrypted chat, and settle outside the app — exactly like Vexl, but with **Nostr pubkeys replacing phone numbers** and the **follow graph replacing the address-book graph**.

No custody. No KYC. No central backend. Offers are plain Nostr events, readable by any NIP-99 client; the trust filtering, ranking, and negotiation UI is Ditto-specific.

---

## 2. Guiding Principles

| Principle | What it means in practice |
|---|---|
| **No custody** | Ditto never holds bitcoin or fiat. Settlement happens off-app (cash, bank transfer, LN, on-chain, etc.). |
| **No KYC** | Identity is the user's Nostr pubkey. Optional verification (NIP-05, mutual contacts) is voluntary. |
| **Privacy by default** | Offer metadata is public (NIP-99). Negotiation is encrypted (NIP-17 DMs). Sensitive preferences may be wrapped (NIP-59). |
| **Web-of-trust ranking** | Reputation is computed from public follows, followers, mutual connections, and trade attestations — not a centralized score. |
| **Ecosystem compatible** | Listings use standard NIP-99 so other clients can render them; Ditto adds the trust-filtering and ranking layers on top. |
| **Progressive disclosure** | Users reveal only what they choose: pseudonymous offer → encrypted chat → optional real name/location → meet. |

---

## 3. Why Not Fork Vexl?

A literal fork of Vexl is not the right path:

- Vexl is **React Native + Expo + Java microservices**. Ditto is **React web + Capacitor**. A fork would be a separate app, not a Ditto feature.
- Vexl's safety model is built on **phone contacts and hashed phone-number matching**. Replacing that with Nostr IDs removes the real-world trust anchor.
- It is simpler and more coherent to **build Vexl-inspired features natively into Ditto**, reusing the existing NIP-99 marketplace, payment rails, NIP-17 DMs, and follow graph.

This scope therefore describes a **Ditto-native implementation**, not a fork.

---

## 4. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DITTO CLIENT                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ P2P Trades   │  │ Web-of-Trust │  │ Encrypted Negotiation    │  │
│  │ Feed / Cards │  │ Rank Engine  │  │ (NIP-17 DMs)             │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                       │                │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌────────────▼─────────────┐  │
│  │ NIP-99       │  │ Follow graph │  │ Payment rails            │  │
│  │ classifieds  │  │ + NIP-85     │  │ (zaps, on-chain, NWC…)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  STANDARD NOSTR     │
                    │  RELAYS (public)    │
                    └─────────────────────┘
```

### Reuse from existing Ditto

| Existing component | Reuse in P2P Trades |
|---|---|
| `MarketPage` / `Nip99ListingCard` | Offer discovery feed and cards |
| `Nip99Listing` parser / `useNip99Listings` | Listing serialization and queries |
| `MarketplaceBuyDialog` / `ZapDialog` | Deposit/payment flows, price conversion |
| **NIP-17 DMs (new)** | Encrypted negotiation between trader and counterparty |
| `useFollowActions` / `useFollowList` | 1st-degree trust graph |
| `useNip85Stats` | Public reputation signals (followers, post count, zap totals) |
| NWC / WebLN / on-chain zap flows | Settlement options |

> **Note on letters:** The existing kind 8211 encrypted letters are **removed entirely**. Ditto's private messaging moves to NIP-17 DMs, with UI inspiration from 0xchat.

---

## 5. NIP-99 Compatibility & Exposure

### 5.1 Listings are standard NIP-99

Offers are **kind 30402** classified listings with standard tags:

```json
{
  "kind": 30402,
  "content": "Selling BTC for EUR cash in Berlin Mitte. Meet at a public café. Available weekdays after 6pm.",
  "tags": [
    ["d", "sell-btc-berlin-001"],
    ["title", "Sell BTC for EUR cash — Berlin"],
    ["summary", "Up to 500 EUR, in-person cash trade"],
    ["published_at", "1718726400"],
    ["t", "p2p-trade"],
    ["t", "sell-btc"],
    ["t", "cash"],
    ["location", "Berlin, Germany"],
    ["g", "u33db"],
    ["price", "500", "EUR"],
    ["image", "https://…/trade-thumbnail.jpg"]
  ]
}
```

### 5.2 P2P-specific tag extensions

Ditto adds **optional, backward-compatible tags** inside the same NIP-99 event:

| Tag | Values | Meaning |
|---|---|---|
| `t` | `p2p-trade` | Top-level category so the listing can be filtered by P2P clients |
| `t` | `buy-btc` / `sell-btc` | Trade direction |
| `t` | `cash`, `bank-transfer`, `revolut`, `paypal`, `strike`, `lightning`, `on-chain` | Settlement methods the trader accepts |
| `t` | `in-person`, `online` | Meeting mode |
| `visibility` | `public`, `follows`, `wot-2`, `wot-3` | Who can see the offer in Ditto's feed |
| `currency` | e.g. `EUR`, `USD`, `CZK` | Redundant with price[2] for indexing |
| `premium` | `-2.5` | Percentage above/below market rate (optional) |
| `min-amount` | `50` | Minimum trade amount in listing currency |
| `max-amount` | `500` | Maximum trade amount in listing currency |

**Important:** These tags are plain text. Any NIP-99 client can read and render the listing. Ditto's `visibility` tag is a **client-side hint**: other clients may ignore it and display the offer publicly. Users must understand that NIP-99 is a public bulletin board.

### 5.3 Exposure trade-off

Because NIP-99 events are public and addressable, P2P offers will appear in:

- Other Nostr clients that support NIP-99 (Iris, Amethyst, Coracle, etc.)
- Relay indexes and search tools
- Njump / nostr.band previews

This is **by design** for liquidity and ecosystem compatibility, but it has implications:

- **Location precision:** Encourage coarse locations (city, neighborhood) and optional geohash precision.
- **Identity:** The seller's pubkey is public. Users should be warned before posting.
- **Phone numbers / bank details:** Must **never** appear in listing content/tags. They are shared only inside encrypted negotiation.
- **Visibility hint is not enforced:** A malicious or non-Ditto client can still show a "follows-only" offer to anyone.

Mitigation: if a user needs stronger privacy, they can wrap the entire listing in **NIP-59** (see §7).

---

## 6. Web-of-Trust Model & Ranking

Vexl's core innovation is **real-world reputation through social graph**. On Nostr, the equivalent is the public follow graph plus optional trusted-assertion stats.

### 6.1 Trust circles

From the viewer's perspective, every other pubkey sits in one of these circles:

| Circle | Definition | In Vexl terms |
|---|---|---|
| **Self** | The viewer | — |
| **1st degree** | Accounts the viewer follows | My contacts |
| **2nd degree** | Accounts followed by ≥1 of my 1st-degree follows | Contacts of contacts |
| **3rd degree** | Accounts followed by ≥1 of my 2nd-degree follows | Extended network |
| **Everyone else** | Rest of Nostr | Strangers |

Ditto can compute 1st and 2nd degrees locally from the viewer's follow list and the follow lists of followed accounts. 3rd degree is expensive and noisy; it should be optional and computed via a NIP-85-style stats provider or batched relay queries.

### 6.2 Offer visibility scopes

When creating an offer, the seller picks a visibility scope. The tag is advisory; Ditto filters the feed accordingly.

| Scope | Who sees it in Ditto | Use case |
|---|---|---|
| `public` | Anyone | Maximum liquidity; lowest privacy |
| `follows` | My followers only | Seller broadcasts to people who trust them |
| `wot-2` | 1st + 2nd degree | Default recommendation; Vexl-like bubble |
| `wot-3` | 1st + 2nd + 3rd degree | Wider liquidity with still some trust signal |

The seller can also publish **multiple concurrent offers with different scopes and prices** (e.g., a tighter spread for friends, a wider spread for the public).

### 6.3 Ranking algorithm (v1)

The default feed is sorted by a composite **Trust Score** per offer:

```
score = w1*circle_score + w2*reputation_score + w3*recency + w4*price_fairness
```

#### Circle score

| Circle | Score |
|---|---|
| 1st degree | 1.00 |
| 2nd degree with ≥2 mutual paths | 0.80 |
| 2nd degree with 1 mutual path | 0.60 |
| 3rd degree | 0.30 |
| Everyone else | 0.00 (hidden by default, toggleable) |

#### Reputation score

Computed from public signals:

| Signal | Source | Weight |
|---|---|---|
| Follower count | NIP-85 kind 30382 or local count | low |
| Account age | earliest kind 0 / kind 3 `created_at` | medium |
| Zap receipts received | NIP-57 kind 9735 + kind 8333 | medium |
| Prior successful trades | custom trade attestation kind (see §9) | high |
| NIP-05 verification | kind 0 `nip05` | medium |
| Mutual follows with viewer | local graph | high |
| No reports / mute-list hits | kind 1984 reports, viewer's mute list | negative filter |

#### Recency

- New offers get a small boost for the first 24 hours.
- Stale offers (>30 days) decay.
- Sellers can refresh by republishing (updates `created_at` but preserves `published_at`).

#### Price fairness

For BTC/fiat trades:

- Fetch BTC price from Ditto's existing Esplora price source.
- Compute premium vs. spot.
- Rank closer-to-market offers slightly higher, but never above trust signals.

### 6.4 Ranking UI

Each offer card shows:

- **Trust badge:** "Friend", "Friend of friend", "Extended network", "Public".
- **Mutual follows count:** "You and 4 people follow @alice".
- **Reputation chip:** e.g., "12 trades · 99% positive" if attestations exist.
- **NIP-05 checkmark** if verified.
- **Distance path:** optional expand to see the shortest follow-path(s).

---

## 7. Privacy Model: NIP-44, NIP-59, and Optional Escrow

### 7.1 Public layer — NIP-99

- Offer metadata, price, location, settlement methods.
- Visible to any Nostr client.
- Best for liquidity and simple trades.

### 7.2 Negotiation layer — NIP-17 private DMs

When a buyer opens an offer:

1. Ditto creates a **NIP-17 DM thread** with the seller.
2. The first message is a **trade request** containing pre-filled fields:
   - Offer being referenced (`a` tag: `30402:<seller>:<d-tag>`)
   - Desired amount
   - Proposed location/time
   - Preferred settlement method
   - Optional intro note
3. The message is wrapped as **kind 14 → kind 13 → kind 1059** and published to the seller's preferred DM relays (kind 10050).
4. The seller unwraps, decrypts, and replies in the same thread.
5. Both parties can reveal more identity (NIP-05, real name, Signal handle) inside the encrypted channel at their discretion.

**Self-copies:** Each outgoing DM is also gift-wrapped to the sender so both sides see the same conversation history.

### 7.3 Private offer layer — NIP-59 gift wraps

For users who want Vexl-like privacy (offer not visible to the public internet):

- The seller creates a **standard NIP-99 listing** as the inner event.
- The inner event is wrapped as a **NIP-59 gift wrap (kind 1059)** addressed to each intended recipient or to a group defined by follow graph.
- Recipients unwrap with their signer and see the offer inside Ditto.

Trade-offs:

- **Pros:** Not indexed by public NIP-99 clients; not visible on relays to casual observers.
- **Cons:** Requires knowing the recipient pubkeys in advance; no organic discovery by 2nd-degree connections; relay may still learn metadata (recipient set).
- **Complexity:** High. NIP-59 support is required; it uses the same seal/wrap machinery as NIP-17.

**Recommendation:** NIP-59 private offers are a **Phase 2** feature. Phase 1 uses public NIP-99 with visibility hints + NIP-17 negotiation.

### 7.4 Optional: privacy-preserving location

- Coarse location only in public listings (city / neighborhood / geohash prefix).
- Exact meetup spot shared in encrypted chat after both parties agree.
- Consider integrating with **OpenStreetMap** or **BTCMap** for public meetup-area hints.

---

## 8. Trade Lifecycle & Data Model

### 8.1 Lifecycle states

| State | Description |
|---|---|
| `active` | Offer is visible and accepting requests |
| `negotiating` | Buyer and seller are chatting (local UI state, not on-chain) |
| `pending` | Terms agreed; awaiting settlement (local UI state) |
| `settled` | Settlement completed off-app; both parties confirm |
| `disputed` | One party flags a problem (local UI state + optional report) |
| `sold` / `closed` | Seller marks offer inactive (NIP-99 `status: sold`) |
| `expired` | Offer older than seller's chosen TTL (local UI filter) |

### 8.2 Events / kinds used

| Kind | Purpose | Notes |
|---|---|---|
| `30402` | Public offer listing | Standard NIP-99 |
| `30403` | Draft offer | Standard NIP-99 draft |
| `14` | DM rumor (actual message) | Unsigned; wrapped inside kind 13 + 1059 |
| `13` | DM seal | Signed by sender, NIP-44 encrypted to recipient |
| `1059` | DM gift wrap | Signed by ephemeral key, published to relays |
| `10050` | DM relay list | Recipient's preferred DM relays |
| `7` | Reaction / thumbs-up on trade partner | Lightweight reputation signal |
| `1984` | Report bad actor | Standard NIP-56 reporting |
| **TBD** | Trade attestation (see §8.4) | New custom kind; needs NIP.md entry |

### 8.3 NIP-17 DM Implementation Architecture

NIP-17 is a three-layer gift-wrap protocol. Ditto must implement all three layers and the relay-discovery mechanism.

#### Three-layer event structure

```
┌─────────────────────────────────────────────┐
│  kind 1059  Gift Wrap                       │  ← published to relays
│  signed by random ephemeral key             │
│  NIP-44 encrypted seal inside               │
├─────────────────────────────────────────────┤
│  kind 13    Seal                            │
│  signed by real sender pubkey               │
│  NIP-44 encrypted rumor inside              │
├─────────────────────────────────────────────┤
│  kind 14    Rumor (actual message)          │
│  unsigned                                   │
│  content + tags (p, e, subject, etc.)       │
└─────────────────────────────────────────────┘
```

#### Required crypto utilities

| Function | Purpose |
|---|---|
| `createRumor(content, tags)` | Build unsigned kind 14 event |
| `createSeal(rumor, senderSec, recipientPub)` | NIP-44 encrypt rumor; sign kind 13 with sender key |
| `createWrap(seal, recipientPub)` | NIP-44 encrypt seal; sign kind 1059 with ephemeral key |
| `unwrapGiftWrap(wrapEvent, recipientSec)` | Decrypt kind 1059 → kind 13 |
| `unsealSeal(sealEvent, recipientSec)` | Decrypt kind 13 → kind 14 rumor |
| `verifyRumor(rumor, sealPubkey)` | Confirm rumor pubkey matches seal signer |

#### Self-copies

Senders cannot read messages they encrypted to someone else's pubkey. To show sent messages in the sender's own inbox, Ditto must publish a **second gift wrap** addressed to the sender's own pubkey, containing the same seal.

#### DM relay discovery (kind 10050)

Before sending, fetch the recipient's kind 10050 event:

```json
{ "kinds": [10050], "authors": ["<recipient-pubkey>"] }
```

- If found, publish the gift wrap to the listed `relay` URLs.
- If not found, fall back to the recipient's NIP-65 relay list, then the user's configured relays.

#### Conversation grouping

A conversation thread is identified by the **set of participants** (sender pubkey + all `p` tags in the rumor). For P2P trades this is a one-on-one thread. For general DMs it may be a small group.

#### Storage and decryption

- Gift wraps (kind 1059) addressed to the user are subscribed via `{ kinds: [1059], '#p': [userPubkey] }`.
- Unwrapping requires the user's private key, so it must happen in the signer path (`NSecSignerBtc`, `NBrowserSignerBtc`, `NConnectSignerBtc`).
- For NIP-46 signers, unwrapping may require round-trips to the bunker; consider caching unwrapped rumors locally.
- Decrypted messages are stored in IndexedDB keyed by conversation + timestamp.

#### Trade-request message format

Initial DM from buyer to seller includes an `a` tag referencing the offer:

```json
{
  "kind": 14,
  "content": "Hi, I'd like to buy 0.01 BTC. Proposed meet: Sat 14:00 at Hauptbahnhof.",
  "tags": [
    ["p", "<seller-pubkey>"],
    ["a", "30402:<seller-pubkey>:<d-tag>"],
    ["subject", "Trade request: Sell BTC for EUR"]
  ]
}
```

This lets the DM inbox surface trade requests distinctly and link back to the offer.

### 8.4 Custom kind: Trade Attestation

To enable reputation without a central server, Ditto can introduce a **trade attestation** event. This must follow the `nostr-kind-design` skill and be documented in `NIP.md`.

Draft:

```json
{
  "kind": 31221,
  "content": "",
  "tags": [
    ["a", "30402:<seller-pubkey>:<d-tag>"],
    ["p", "<counterparty-pubkey>"],
    ["rating", "positive"],
    ["role", "buyer"],
    ["alt", "Trade attestation: positive as buyer"]
  ]
}
```

Properties:

- Only one attestation per (trade event, counterparty, role) triple.
- Both buyer and seller can publish their own attestation.
- `rating` values: `positive`, `negative`, `neutral`.
- Content is empty by default; optional NIP-44-encrypted details could be added later.
- **Privacy concern:** Publicly links two pubkeys as having traded. Users must opt in.

Because of the privacy trade-off, Phase 1 might skip public attestations and rely on **NIP-85 stats + follow graph** only. Attestations can be Phase 2 or opt-in.

---

## 9. UI/UX Flows

### 9.1 Create offer

1. User navigates to **Market → P2P Trades**.
2. Clicks **"New offer"**.
3. Form fields:
   - I want to: **Buy BTC** / **Sell BTC**
   - Asset amount range (min/max)
   - Fiat currency
   - Price: **Market rate** / **Premium %**
   - Settlement methods (multi-select)
   - Location (coarse)
   - Meeting mode: **In-person** / **Online**
   - Visibility: **Public** / **Followers** / **Friends of friends** / **Extended network**
   - Title, summary, description, optional image
4. Preview card shows trust-circle badge and price.
5. Publish → standard NIP-99 kind 30402.

### 9.2 Discover offers

1. **P2P Trades** tab in the market shows a feed filtered to `t: p2p-trade`.
2. Default filter: **Friends of friends** (wot-2).
3. Sub-filters: buy/sell, currency, settlement method, location, price range.
4. Each card shows trust badge, reputation chips, price, location, payment methods.
5. Toggle to include public offers from strangers (with prominent risk warning).

### 9.3 Open negotiation

1. Buyer clicks **"Contact seller"** on an offer.
2. If not logged in, show `LoginDialog`.
3. Open a DM thread with the seller, pre-filled as a **trade request**:
   - Offer reference (`a` tag).
   - Buyer enters desired amount, proposed location/time, message.
4. Send → publish NIP-17 gift-wrapped DM (kind 14 → 13 → 1059) to seller's DM relays.
5. Seller receives it in their DM inbox with a **"Trade request"** badge.

### 9.4 Negotiation chat

1. Chat-like DM thread between buyer and seller.
2. Both parties can edit terms inline (amount, location, time, method).
3. **Reveal identity** button: optionally share NIP-05 / real name / contact handle (encrypted).
4. **Agree to terms** button: stores agreed terms locally for both parties (not on-chain).
5. **Mark settled** button: after off-app settlement, both can mark the trade complete.
6. **Leave attestation** button (opt-in): publish a trade attestation.

### 9.5 Settlement

Ditto does **not** escrow. It provides settlement helpers:

- **Lightning / on-chain / NWC / WebLN:** Reuse existing `ZapDialog` if the trade is structured as a payment to the seller's declared payment targets.
- **Cash / bank transfer:** Show a checklist and safety tips; no code path needed.
- **PSBT / CoinJoin:** Optional future integration for in-app Bitcoin settlement.

### 9.6 0xchat-inspired DM UX

The new NIP-17 DM interface borrows from 0xchat's chat-first design:

| 0xchat pattern | Ditto adaptation |
|---|---|
| **Conversation list / inbox** | `/messages` page showing recent threads with avatar, name, last message preview, timestamp, unread dot |
| **Chat thread** | Full-screen or sheet-based thread with message bubbles, timestamps, read status |
| **New message** | Floating action button or profile "Message" button opens thread directly |
| **Reply threading** | `e` tags on kind 14 rumors enable inline replies |
| **Subject / topic** | `subject` tag on kind 14 for named conversations (e.g., trade request title) |
| **Read receipts** | Optimistic local state + eventual confirmation via self-copy sync |
| **Push notifications** | DM notification type with sender preview and deep-link to thread |
| **Relay-aware sending** | kind 10050 DM relay list per recipient, fallback to common relays |
| **Group DMs (future)** | Same NIP-17 mechanism with multiple `p` tags; Phase 1 focuses on 1:1 |

Out of scope for Phase 0/1 but noted from 0xchat:

- Voice notes
- Audio/video calls (NIP-100 + WebRTC)
- Relay-managed public/private groups (NIP-29)
- Cashu wallet / red envelopes

---

## 10. Ranking & Reputation — Detailed v1 Spec

### 10.1 Data sources

| Source | Kind | How fetched |
|---|---|---|
| Viewer follow list | 3 | `useFollowList` |
| Follow lists of followed accounts | 3 | Batch relay query for `authors: [followed-pubkeys-1..n]` |
| Profile metadata | 0 | `useAuthor` |
| NIP-85 user stats | 30382 | `useNip85UserStats` if `nip85StatsPubkey` configured |
| NIP-85 event stats | 30383 / 30384 | For offer/listing engagement |
| Zap receipts | 9735, 8333 | Existing zap hooks |
| Trade attestations | TBD 31221 | New query |
| Reports | 1984 | Filtered by reporter trust |

### 10.2 Mutual-path calculation

For a candidate seller `S`:

1. `F1` = set of pubkeys the viewer follows.
2. If `S ∈ F1` → 1st degree.
3. Else, for each `f ∈ F1`, fetch `follows(f)`.
4. If `S ∈ follows(f)` for any `f` → 2nd degree; count how many `f` connect to `S`.
5. Else, for each 2nd-degree intermediate, fetch their follows → 3rd degree.

Performance: 2nd-degree computation is O(|F1|) relay queries. With batching and caching, this is feasible. 3rd-degree is expensive and should be optional or delegated to a stats provider.

### 10.3 Reputation signals displayed

On each offer card and trader profile:

- **Network distance** (1st / 2nd / 3rd / public).
- **Mutual follows** count and avatars.
- **Account age** (e.g., "2 years on Nostr").
- **Follower count** from NIP-85 or local count.
- **NIP-05 verified** badge.
- **Trade history** if attestations enabled ("12 trades").
- **Positive/negative ratio** from attestations.
- **Recent report warnings** ("2 reports from people you follow").

### 10.4 Safety ranking rules

- Any pubkey in the viewer's **mute list** or **love list** affects ranking (mute = hide, love = boost).
- Offers from accounts with **no followers and no posts** are flagged as "New account — trade carefully."
- In-person cash offers from **public/stranger** accounts require an extra confirmation tap before contact.

---

## 11. Safety & Abuse Mitigation

P2P trading with pseudonymous users carries real-world risk (theft, scams, physical danger). Ditto must be defensive without becoming custodial.

### 11.1 In-app warnings

- First-time P2P Trades user sees a **safety modal**:
  - Meet in public places.
  - Verify identity before large trades.
  - Never share private keys or seed phrases.
  - Ditto does not escrow or mediate disputes.
- Stranger-offer cards show: "You have no connection to this trader."
- High-value offers prompt an extra confirmation.

### 11.2 Reporting

- **Report offer** → publish kind 1984 report tagged with the listing `a` coordinate.
- **Report user** → publish kind 1984 report tagged with `p`.
- Reports from people the viewer follows carry more weight in ranking.

### 11.3 Anti-spam

- Require a small account-age minimum to publish P2P offers (e.g., account created >7 days ago or has >1 follower).
- Rate-limit offer publishing per pubkey (e.g., max 10 active offers).
- Hide duplicate offers (same title/price/location within a window).

### 11.4 Optional: verified traders

- A curated list of pubkeys (e.g., from Ditto admins, meetup organizers, or NIP-05-verified community leaders) can get a **"Verified trader"** badge.
- This is a trust-sensitive query and must be filtered by `authors: ADMIN_PUBKEYS` or a configurable curator list.

---

## 12. AppConfig Additions

Per the AppConfig triple requirement (interface + Zod schema + default), add:

```ts
interface AppConfig {
  // … existing …

  /** Default trust radius for P2P Trades feed. */
  p2pTradesDefaultVisibility: 'public' | 'follows' | 'wot-2' | 'wot-3';

  /** Require minimum account age (days) before publishing P2P offers. */
  p2pTradesMinAccountAgeDays: number;

  /** Maximum active P2P offers per user. */
  p2pTradesMaxActiveOffers: number;

  /** Optional NIP-85-style stats pubkey for extended reputation. */
  p2pTradesStatsPubkey?: string;

  /** Whether public stranger offers are shown by default. */
  p2pTradesShowPublicByDefault: boolean;
}
```

---

## 13. Implementation Phases

### Phase 0 — Replace Letters with NIP-17 DMs (4–6 weeks)

This phase removes the kind 8211 letter feature and replaces it with general-purpose NIP-17 DMs for all Ditto users.

#### 0a. Remove letters from the codebase

Delete or replace the following:

| Area | Files / places to clean up |
|---|---|
| Pages | `src/pages/LettersPage.tsx`, `src/pages/LetterComposePage.tsx`, `src/pages/LetterPreferencesPage.tsx` |
| Components | `src/components/letter/*` (~14 components), `src/components/EncryptedLetterContent.tsx`, `src/components/icons/InkPenIcon.tsx` |
| Hooks | `useLetters`, `useLetterPreferences`, `useStationery`, `useStationeryColors`, `useThemeStationery`, `useEnvelopeDimensions` |
| Library | `src/lib/letterTypes.ts`, `src/lib/letterUtils.ts` |
| Router | Remove `/letters`, `/letters/compose`, `/settings/letters` from `AppRouter.tsx` |
| Sidebar | Remove Letters item from `src/lib/sidebarItems.tsx` |
| Kind labels | Remove `8211: 'Letter'` from `src/lib/kindLabels.ts`; decide if `extraKinds.ts` letter blurb should be removed |
| Notifications | Remove letter notification templates/kinds and any letter-specific notification handling |
| Settings | Remove letter preferences from settings pages/schemas |
| P2P/marketplace | Update any existing "message seller via letter" callsites to use NIP-17 DMs |

> **Data migration:** Existing kind 8211 events remain on relays; they simply won't render in Ditto anymore. If users need historical letters, a one-time read-only migration view could be added later, but it is out of scope for Phase 0.

#### 0b. Build NIP-17 DM infrastructure

- [ ] Add NIP-17 crypto utilities: `createRumor`, `createSeal`, `createWrap`, unwrap/decrypt.
- [ ] Add `useNip17SendMessage` hook (handles rumor → seal → wrap + self-copy + DM relay lookup).
- [ ] Add `useNip17Inbox` hook (subscribe to kind 1059 `#p` = user pubkey, unwrap, decrypt, group by conversation).
- [ ] Add DM inbox UI (`/messages`) and conversation thread UI, inspired by 0xchat.
- [ ] Support kind 10050 DM relay discovery; fall back to user's NIP-65 relay list.
- [ ] Integrate DM notifications with existing push/notification system.
- [ ] Update `NIP.md`: remove/customize kind 8211 docs; add NIP-17 client behavior notes.

### Phase 1 — P2P Trades MVP (4–6 weeks)

- [ ] Add `p2p-trade` category and P2P form to marketplace.
- [ ] Extend `Nip99Listing` parser with P2P tags (direction, methods, visibility, min/max, premium).
- [ ] Create `P2PTradesPage` and filter UI.
- [ ] Implement web-of-trust feed filter (1st + 2nd degree) using existing follow graph.
- [ ] Add trust badges and basic ranking (circle + recency + NIP-85 stats).
- [ ] Build **trade-request composer** on top of NIP-17 DMs.
- [ ] Add safety modal and warnings.
- [ ] Update `NIP.md` with P2P tag conventions and any new custom kind.

### Phase 2 — Reputation & Privacy (4–6 weeks)

- [ ] Design and implement trade attestation kind (custom kind, documented in `NIP.md`).
- [ ] Build reputation score from attestations + follow graph + zaps.
- [ ] Add trader profile tab: "Trade history & reputation".
- [ ] Implement NIP-59 gift-wrapped private offers.
- [ ] Add 3rd-degree web-of-trust expansion (optional, with performance guardrails).
- [ ] Add reporting flow for P2P offers and traders.

### Phase 3 — Advanced Settlement & Discovery (future)

- [ ] In-app PSBT signing for escrow-less Bitcoin settlement.
- [ ] Price-oracle integration and premium-based ranking.
- [ ] Geolocation map of nearby offers (coarse).
- [ ] "Trader clubs" — curated groups for local communities (similar to Vexl clubs).
- [ ] Reputation export/import via NIP-85 or custom attestation bundles.

### Phase 4 — Audio/Video Calls (future, large scope)

0xchat supports E2EE audio/video calls via **NIP-100** call signaling over Nostr relays plus WebRTC media streams through user-selectable ICE servers. This is a separate, large feature:

- NIP-100 call offer/answer/ICE-candidate events.
- WebRTC peer connection + audio/video tracks.
- Incoming-call UI, active-call UI, call logs.
- Microphone/camera permissions on Capacitor iOS/Android.
- Push notifications for incoming calls.
- STUN/TURN/ICE server configuration and privacy implications.

**Recommendation:** Ship NIP-17 DMs and P2P Trades first. Add calls only after the messaging layer is stable and the team wants to take on WebRTC + native mobile permissions.

---

## 14. Open Questions

1. **Letter removal boundary:** Do we delete all letter code, or keep a read-only migration view for historical kind 8211 events?**
2. **Do we mint a new custom kind for trade attestations, or skip it for Phase 1?**
3. **Should offers be allowed in non-fiat currencies (e.g., sats for goods/services)?**
4. **How do we handle location privacy — city-level only, or configurable geohash precision?**
5. **Do we integrate a price oracle beyond the existing BTC/USD Esplora source?**
6. **Should there be a Ditto-curated "verified trader" list, or purely decentralized reputation?**
7. **What is the legal risk of facilitating in-person cash trades in the App Store / Google Play?**
8. **How do we rate-limit offer creation without a central backend?**
9. **Do we support NIP-59 in Phase 1, or defer to Phase 2 due to complexity?**

---

## 15. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Users scammed by strangers | High | High | WoT filtering by default; safety warnings; reporting; optional verified traders |
| Physical harm during in-person trades | Low | Critical | Safety education; meet-in-public guidance; no high-value stranger offers by default |
| App Store rejection for P2P cash trading | Medium | High | Frame as "classified listings"; no escrow; prominent disclaimers; consider web-only fallback |
| Sybil / spam offers | High | Medium | Account-age minimums; max active offers; hide duplicates; mute/report |
| NIP-99 public exposure surprises users | Medium | High | Clear pre-publish warning; encourage coarse locations; optional NIP-59 later |
| Relay query load from WoT computation | Medium | Medium | Batch and cache follow lists; lazy 2nd-degree expansion; optional 3rd-degree |
| Reputation gaming | Medium | Medium | Weight mutual follows and attestations from trusted accounts; cap follower-count signal |
| Letter removal angers existing users | Medium | Medium | Pre-release announcement; explain NIP-17 privacy upgrade; consider read-only historical view later |
| NIP-17 decryption performance with NIP-46 signers | Medium | Medium | Cache unwrapped rumors locally; batch unwrap operations; warn bunker users about latency |

---

## 16. Conclusion

**P2P Trades** is a high-value, strategically aligned feature for Ditto. It leverages Ditto's existing strengths (NIP-99 marketplace, payment rails, mobile app) plus a new **NIP-17 DM layer** (replacing kind 8211 letters) and Nostr's native social graph to approximate Vexl's trust-based trading model without phone numbers.

The right approach is **not to fork Vexl**, but to build a Ditto-native layer on top of NIP-99. Phase 0 removes letters and ships NIP-17 DMs for all users with 0xchat-inspired UX. Phase 1 layers P2P Trades on top: public listings + web-of-trust filtering + NIP-17 negotiation. Later phases add private offers (NIP-59) and reputation attestations.

**Next step:** Confirm the letter removal boundary, then start Phase 0 implementation or create a detailed task breakdown.
