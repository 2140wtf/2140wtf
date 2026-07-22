# NIP: Custom Event Kinds

## Event Kinds Overview

### 2140.wtf Kinds

| Kind  | Name                 | Description                                           |
|-------|----------------------|-------------------------------------------------------|
| 8333  | Onchain Zap          | Attestation that an on-chain BTC tx paid a target     |
| 15683 | Love List            | The people the user truly loves (one per user)        |
| 36767 | Theme Definition     | Shareable, named custom UI theme                      |
| 16767 | Active Profile Theme | The user's currently active theme (one per user)      |
| 16769 | Profile Tabs         | The user's custom profile page tabs (one per user)    |

### Community Kinds

These event kinds were created by community contributors and are supported by 2140.wtf. Full specifications are maintained by their respective authors.

| Kind  | Name                   | Description                                                      | Spec                                                                                      |
|-------|------------------------|------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| 2473  | Bird Detection         | Bird-by-ear observation log (species heard in the wild)          | [NIP](https://gitlab.com/alexgleason/birdstar/-/blob/main/NIP.md)                         |
| 12473 | Birdex                 | Author's cumulative life list of confirmed bird species          | [NIP](https://gitlab.com/alexgleason/birdstar/-/blob/main/NIP.md)                         |
| 3367  | Color Moment           | Color palette post expressing a mood                             | [NIP](https://gitlab.com/chad.curtis/espy/-/blob/main/NIP.md)                            |
| 4223  | Weather Reading        | Sensor readings from a weather station                           | [Draft NIP](https://github.com/nostr-protocol/nips/pull/2163)                            |
| 7516  | Found Log              | Log entry recording a user finding a geocache                    | [NIP-GC](https://gitlab.com/chad.curtis/treasures/-/blob/main/NIP-GC.md)                 |
| 8211  | Encrypted Letter (deprecated in 2140.wtf) | Encrypted personal letter with visual stationery | [NIP](https://gitlab.com/chad.curtis/lief/-/blob/main/NIP.md) |
| 443–445, 10051, 1059 | NIP-104 Group Chat | End-to-end encrypted group chat (Marmot/Group Ratchet fallback) | [NIP-104](https://github.com/nostr-protocol/nips/blob/master/104.md) |
| 1124  | Pets Social Interaction | Immutable interaction log for Pets social interactions       | See [Pets Social Interaction](#kind-1124-pets-social-interaction) below                |
| 21124 | Pets Battle Sync       | Ephemeral encrypted in-match state stream for remote pet battles | See [Kind 21124: Pets Battle Sync](#kind-21124-pets-battle-sync) below               |
| 10133 | Payment Targets        | Donation endpoints (Bitcoin, Lightning, Monero, …) per RFC-8905 | [NIP-A3](https://github.com/ATXMJ/nips/blob/main/A3.md); see [Kind 10133](#kind-10133-payment-targets-nip-a3) below |
| 11125 | Nostr Pet Profile     | Owner profile with coins, achievements, and inventory            | [NIP-BB](https://github.com/Danidfra/nostr-pet/blob/production/NIP.md)                   |
| 14919 | Pets Interaction     | Individual pet interaction (feed, play, clean, etc.)             | [NIP-BB](https://github.com/Danidfra/nostr-pet/blob/production/NIP.md)                   |
| 14920 | Pets Breeding        | Breeding event between two adult Petss                         | [NIP-BB](https://github.com/Danidfra/nostr-pet/blob/production/NIP.md)                   |
| 14921 | Pets Record          | Immutable lifecycle record (birth, evolution, adoption)          | [NIP-BB](https://github.com/Danidfra/nostr-pet/blob/production/NIP.md)                   |
| 16158 | Weather Station        | Weather station metadata (location, sensors, connectivity)       | [Draft NIP](https://github.com/nostr-protocol/nips/pull/2163)                            |
| 31124 | Pets Pet State       | Current state of a virtual Pets pet (addressable)              | [NIP-BB](https://github.com/Danidfra/nostr-pet/blob/production/NIP.md)                   |
| 33863 | Fundraiser             | Self-authored Bitcoin fundraising campaign                       | See [Kind 33863: Fundraiser](#kind-33863-fundraiser) below                                |
| 1315  | Roadstr Report         | Road event report (police, accident, hazard, traffic jam, etc.)  | See [Roadstr](#roadstr) below                                                             |
| 1316  | Roadstr Confirmation   | Confirmation or denial of a Roadstr report                       | See [Roadstr](#roadstr) below                                                             |
| 37516 | Geocache               | Geocache listing for real-world treasure hunting                 | [NIP-GC](https://gitlab.com/chad.curtis/treasures/-/blob/main/NIP-GC.md)                 |
| 36787 | Music Track            | Addressable event for a music audio file with metadata           | See [Music Tracks & Playlists](#music-tracks--playlists) below                            |
| 34139 | Music Playlist         | Ordered list of music track references (also used for albums)    | See [Music Tracks & Playlists](#music-tracks--playlists) below                            |
| 30621 | Custom Constellation   | User-drawn star figure with Hipparcos-numbered edges             | [NIP](https://gitlab.com/alexgleason/birdstar/-/blob/main/NIP.md)                         |

---

## Cashu Wallet (NIP-60 / NIP-61) & DPCS Fallback

2140.wtf implements **NIP-60** (Cashu wallet events) as the primary relay-backed storage for Cashu wallet state, and **NIP-61** (Nutzaps) for peer-to-peer ecash payments. Local storage remains authoritative for the active wallet; relay events are used for restore and cross-device convergence.

The legacy **DPCS** `kind:30078` encrypted backup is still written as a compatibility fallback, but it is no longer the primary restore path.

### NIP-60 wallet key

The NIP-60 wallet key pair is deterministically derived from the same BIP-39 seed used for local wallet encryption:

```
walletPrivkey = hkdf_sha256(seed, salt='', info='freedomid:cashu:nip60:walletkey:v1', 32)
walletPubkey  = compressed secp256k1 public key of walletPrivkey
```

Every device that knows the seed derives the same wallet key, so kind `7375` token events encrypted to this key can be restored anywhere.

### BAO demo/signet wallet

2140.wtf also supports a separate **BAO demo Cashu wallet** for signet/demo ecash. It is derived deterministically from the same BIP-39 seed as the normal wallet, so any device with the seed recovers the same BAO balance.

#### BAO seed derivation

```
baoSeedMnemonic = bip39_from_entropy(hkdf_sha256(seed, salt='', info='2140:cashu:bao:seed:v1', 16))
```

The HKDF output is 16 bytes, which encodes to a 12-word BIP-39 mnemonic. This mnemonic is then encrypted with NIP-44 to the user's identity pubkey and stored locally.

#### BAO wallet key derivation

```
baoWalletPrivkey = hkdf_sha256(baoSeed, salt='', info='ditto:cashu:bao:walletkey:v1', 32)
baoWalletPubkey  = compressed secp256k1 public key of baoWalletPrivkey
```

The BAO wallet key signs its own `kind:7375` token events, `kind:7376` history events, and `kind:5` deletions. It does **not** sign the normal wallet's events.

### Event kinds

| Kind | Name | Use in 2140.wtf |
|------|------|-----------------|
| 17375 | Wallet config | Publishes one or more wallet pubkeys + mint lists (default + optional BAO). |
| 7375 | Token | NIP-44 encrypted token events storing proofs per mint. |
| 7376 | History | NIP-44 encrypted transaction history entries. |
| 5 | Deletion | Deletes superseded `kind:7375` token events. |
| 10019 | Nutzap info | Receiver advertisement: trusted mints, relays, and P2PK pubkey. |
| 9321 | Nutzap | Peer-to-peer Cashu payment event. |

### Multi-wallet `kind:17375` format

A single `kind:17375` event can carry multiple wallet configs. The encrypted plaintext is a JSON array of tags:

```json
[
  ["privkey", "<default-wallet-privkey-hex>"],
  ["mint", "https://mint.example.com"],
  ["privkey", "bao", "<bao-wallet-privkey-hex>"],
  ["mint", "https://mint.bao.network"]
]
```

- A two-element `privkey` tag represents the default/normal Cashu wallet.
- A three-element `privkey` tag with the identifier `bao` represents the BAO demo wallet.
- `mint` tags following a `privkey` tag belong to that wallet until the next `privkey` tag.

### Token storage and rollover

After every proof mutation — receive, send, mint, or melt — 2140.wtf publishes a fresh `kind:7375` token event for the affected mint and a `kind:5` deletion for the previous token event. The token event content is NIP-44 encrypted JSON with the shape:

```json
{
  "mint": "https://mint.example.com",
  "unit": "sat",
  "proofs": [ /* Cashu proofs */ ],
  "del": ["<previous-token-event-id>"]
}
```

The optional `del` field references the event ids being replaced, so relays and clients can garbage-collect old state.

### NIP-61 Nutzaps

Nutzaps are peer-to-peer Cashu payments delivered as `kind:9321` events. Sending a Nutzap is only possible when the recipient has published a valid `kind:10019` receiver ad.

The sender **MUST**:

1. Query the recipient's latest `kind:10019` by their identity pubkey.
2. Verify the event signature.
3. Confirm the chosen mint is listed in the recipient's trusted mints.
4. P2PK-lock the proofs to `02` + the **wallet pubkey** from the `kind:10019` ad.

Locking proofs to the recipient's identity pubkey makes the ecash unspendable. 2140.wtf enforces this by always reading the `pubkey` tag from `kind:10019` and passing `pubkey: '02' + walletPubkey` to the mint's `send` call.

### Nutzap receiver advertisement (opt-in)

The `kind:10019` receiver ad is **opt-in** via Settings → Privacy & Publishing → *Receive Nutzaps*. It defaults to **off**. When enabled, 2140.wtf publishes a `kind:10019` event with:

- `relay` tags for the relays the user reads,
- `mint` tags for the mints the user accepts,
- a `pubkey` tag containing the user's NIP-60 wallet pubkey.

When disabled, any existing `kind:10019` is overwritten with an empty replacement so relays stop serving the old ad.

### DPCS fallback

For backwards compatibility, 2140.wtf also writes an encrypted `kind:30078` addressable backup. The d-tag is derived from the user's hex pubkey:

```
d = hex(sha256("ditto:cashu:v1:" + pubkeyHex)).slice(0, 16)
```

Restore prefers NIP-60 events and falls back to DPCS only when no NIP-60 state is found. The legacy `d=freedomid:cashu` tag is still read as a migration fallback but is no longer written.

The BAO demo wallet writes a separate DPCS fallback with the d-tag `freedomid:cashu:bao`.

---

## NIP-104: Group Chat

2140.wtf implements NIP-104 (Marmot) encrypted group chat with a **Group Ratchet fallback** so that no external MLS backend is required. The feature is exposed in the UI as **Private Groups** (`/groups`).

### Event kinds used

| Kind  | Purpose |
|-------|---------|
| 443   | Key package published by each member |
| 444   | Welcome event (gift-wrapped to new members) |
| 445   | Group message / membership change event |
| 10051 | DM relay list for key packages |
| 1059  | Gift wrap for Welcome events |

### Group state

Each group has:

- `nostrGroupId` — a 32-byte lowercase hex identifier.
- `rootSecret` — the root symmetric secret from which epoch secrets are derived.
- `exporterSecret` — the current epoch's encryption secret.
- `epoch` — incremented on every membership change (add/remove/ban).
- `members` — list of member pubkeys.
- `adminPubkeys` — list of admin pubkeys.

### Encryption

Application messages are JSON payloads encrypted with the current `exporterSecret` and published as kind 445 events tagged with `h:<nostrGroupId>`. `createGroupEvent` / `decryptGroupEvent` handle the envelope; `createApplicationMessage` / `parseApplicationMessage` handle the inner payload.

### Membership changes and forward secrecy

When an admin adds, removes, or bans a member, 2140.wtf:

1. Increments the group `epoch`.
2. Rotates the `rootSecret`.
3. Derives a new `exporterSecret` for the epoch.
4. Sends the new secrets to all current members via gift-wrapped kind 444 Welcome events with `type` values such as `member_add`, `member_remove`, `member_ban`, or `admin_promote`.

Because old messages were encrypted with previous epoch secrets, a new member cannot decrypt history from before they were added.

### Metadata changes

When an admin edits the group name or description, 2140.wtf also increments the `epoch`, rotates the secrets, and sends a gift-wrapped kind 444 Welcome event with `type: "metadata_update"` to all current members. The Welcome payload includes the updated `nostr_group_data` extension so every member applies the new metadata atomically with the new secrets.

### Client storage

Groups, messages, secrets, and banned-member lists are persisted to `localStorage` via `groupChatStorage`. Read cursors are stored per-user in `localStorage` and synced across devices through the encrypted NIP-78 settings key `groupReadCursors`.

### Limitations

- Requires login with an `nsec` key; browser extension / bunker signers cannot derive the required private-key material.
- Maximum 500 members per group.
- Secrets are stored in `localStorage` plaintext; this is acceptable for a web client but not as hardened as a native MLS store.

---

## Kind 8333: Onchain Zap

### Summary

Regular event kind that records a **Bitcoin on-chain payment** ("onchain zap") sent in appreciation of a Nostr event or profile. Functions as the on-chain analogue of NIP-57 zap receipts (kind 9735), but without the LNURL round-trip: the event is self-attested by the sender and references a real Bitcoin transaction that clients can verify directly on-chain.

The kind number mirrors the convention of NIP-57: kind **9735** is the Lightning P2P port (per BOLT spec), and kind **8333** is the Bitcoin mainnet P2P port — a natural semantic pairing for Lightning vs. on-chain settlement.

Because every Nostr keypair deterministically maps to a Bitcoin Taproot (P2TR) address (both use 32-byte x-only secp256k1 keys, per BIP-340/BIP-341), an on-chain zap is simply a Bitcoin transaction whose output pays the recipient's derived Taproot address. The kind 8333 event links that transaction to the Nostr event or profile being zapped.

### Event Structure

Single-recipient zap (the common case — tipping a post or profile):

```json
{
  "kind": 8333,
  "pubkey": "<sender-pubkey>",
  "content": "Great post!",
  "tags": [
    ["i", "bitcoin:tx:<txid>"],
    ["p", "<recipient-pubkey>"],
    ["amount", "<sats>"],
    ["e", "<target-event-id>", "<relay-hint>"],
    ["alt", "Onchain zap: 25000 sats"]
  ]
}
```

Multi-recipient zap — one Bitcoin transaction paying multiple recipients in a single batch (e.g. "zap all members of a follow set"):

```json
{
  "kind": 8333,
  "pubkey": "<sender-pubkey>",
  "content": "Great list!",
  "tags": [
    ["i", "bitcoin:tx:<txid>"],
    ["p", "<recipient-1-pubkey>"],
    ["p", "<recipient-2-pubkey>"],
    ["p", "<recipient-3-pubkey>"],
    ["amount", "<total-sats-paid-to-all-recipients>"],
    ["a", "30000:<author>:<d-tag>"],
    ["alt", "Onchain zap: 75000 sats across 3 recipients"]
  ]
}
```

### Content

The `content` field is a human-readable comment from the sender (may be empty). It is NOT a zap request JSON (unlike NIP-57 kind 9735).

### Tags

| Tag      | Required | Description                                                                                  |
|----------|----------|----------------------------------------------------------------------------------------------|
| `i`      | Yes      | NIP-73 external content identifier. MUST be `bitcoin:tx:<txid>` where `<txid>` is a 64-char lowercase hex Bitcoin transaction ID. |
| `p`      | Yes (≥1) | 32-byte hex pubkey of a zap **recipient**. A single event MAY include multiple `p` tags when the transaction has one output per recipient (multi-recipient form). Each `p` tag MUST correspond to at least one tx output paying that recipient's derived Taproot address. |
| `amount` | Yes      | **Total** amount paid in satoshis (decimal integer). This is the sum of outputs in the tx paying the derived Taproot addresses of **all** listed `p` recipients combined — *not* the total tx value. The sender's change output MUST NOT be included. For single-recipient events this is simply the amount paid to that one recipient. |
| `e`      | If zapping an event | 32-byte hex ID of the event being zapped. Include a relay hint as the 3rd element where possible. |
| `a`      | If zapping an addressable event | Addressable event coordinate `<kind>:<pubkey>:<d-tag>`. Used instead of (or alongside) `e` for kinds 30000–39999. |
| `k`      | No       | The stringified `kind` of the target event, mirroring NIP-57.                                |
| `alt`    | Yes      | NIP-31 human-readable fallback.                                                              |

If neither `e` nor `a` is present, the zap targets the recipients' **profiles** (i.e. a tip to the pubkey(s), not to a specific event).

Per-recipient amounts are not encoded in the event. Clients that need them (e.g. attributing a multi-recipient donation to one recipient's profile zap history) recompute them from the on-chain transaction by matching each recipient's derived Taproot address against the tx outputs.

### Publishing Flow

1. Sender builds a Bitcoin transaction paying each recipient's derived Taproot address (`nostrPubkeyToBitcoinAddress(recipientPubkey)`). A single-recipient zap has one recipient output; a multi-recipient batch zap has one output per recipient.
2. Sender broadcasts the transaction to the Bitcoin network and obtains the `txid`.
3. Sender signs and publishes a kind 8333 event referencing that `txid` with the appropriate `e`/`a`/`p` tags. For batch zaps, every recipient gets its own `p` tag in the single event.
4. The event is published **after** broadcast; the txid is already final at that point.

### Client Behavior

**Querying onchain zaps for an event:**

```json
{ "kinds": [8333], "#e": ["<target-event-id>"], "limit": 100 }
```

For addressable events, use `"#a": ["<kind>:<pubkey>:<d-tag>"]` instead. For profile-level zaps, use `"#p": ["<pubkey>"]` — this matches both single-recipient events tagging that user and multi-recipient events where the user is one of several recipients.

**Verification (REQUIRED before trusting amounts):**

Clients MUST verify a kind 8333 event on-chain before counting it toward a zap total or displaying its amount. The `amount` tag is self-reported by the sender and would otherwise be trivially spoofable. To verify:

1. Extract the txid from the `i` tag.
2. Fetch the transaction from a Bitcoin data source (e.g. a mempool.space-compatible Esplora API).
3. For each `p` tag, derive the recipient's expected Taproot address from the pubkey.
4. Sum the values of all outputs in the transaction that pay **any** of the listed recipients' derived addresses. This is the **verified amount**. Change outputs paying back to the **sender's** derived Taproot address MUST NOT be counted toward the verified amount.
5. If the verified amount is 0 (none of the listed recipients received anything on-chain), the event SHOULD be discarded.
6. If the sender's `amount` tag exceeds the verified amount, clients MAY discard the event or MAY display the smaller verified amount (capping). Clients MUST NOT display or count the claimed amount when it exceeds the verified amount.
7. Unconfirmed transactions MAY be displayed as pending; clients MAY require confirmation before counting them toward public totals. Because unconfirmed transactions can be evicted (RBF, double-spend), clients SHOULD either exclude them from aggregate zap totals or clearly label them as pending.

When a client needs to attribute a multi-recipient event to one specific recipient (e.g. rendering a profile zap-history entry), it MAY sum only the tx outputs paying that one recipient's derived Taproot address. Per-recipient amounts are recomputed from the transaction at display time.

**Sender/recipient identity:** Clients SHOULD reject events where the sender's pubkey (`event.pubkey`) appears in **any** `p` tag. Self-zaps are trivial to fabricate (the sender already controls the destination address) and contribute nothing meaningful to zap totals.

**Deduplication:** Clients SHOULD deduplicate events that reference the same `txid` (an attacker could publish many events pointing at one real transaction). One kind 8333 event per (txid, target) pair is canonical — when multiple events reference the same `txid` for the same target, the earliest is preferred.

**Network scope:** This specification applies to Bitcoin **mainnet** only. Testnet, signet, and other networks are out of scope; addresses and txids on those networks MUST NOT be used in kind 8333 events.

### Comparison with NIP-57 (Lightning Zaps)

| Aspect | NIP-57 (kind 9735) | This spec (kind 8333) |
|--------|---------------------|------------------------|
| Settlement | Lightning Network | Bitcoin L1 |
| Invoice / payment | LNURL + BOLT-11 invoice | Raw Bitcoin tx |
| Event issuer | Recipient's LNURL provider | Sender |
| Availability | Requires `lud06`/`lud16` on recipient profile | Always available (every Nostr pubkey has a derived Taproot addr) |
| Verification | Recipient zap-provider pubkey + bolt11 amount | On-chain tx verified against derived recipient address |
| Finality | Instant | Confirms in ~10 min (mempool first) |
| Fees | Sub-satoshi typical | Significant at low amounts |

The two zap kinds are complementary. Clients SHOULD sum verified amounts from both kinds when displaying total zap stats for a post or profile.

---

## Kind 15683: Love List

### Summary

Replaceable event listing the people the user **truly loves** — a tier above an ordinary follow. Structured exactly like a NIP-51 standard people list (`p` tags), with one list per user (latest event wins).

The kind number spells **"1·LOVE"**: on a phone keypad L=5, O=6, V=8, E=3 → `5683`, with a leading `1` to land in the replaceable range (10000–19999) — *One Love*.

### Event Structure

```json
{
  "kind": 15683,
  "pubkey": "<author-pubkey>",
  "content": "",
  "tags": [
    ["p", "<loved-pubkey-1>"],
    ["p", "<loved-pubkey-2>"],
    ["alt", "Love list: the people this user truly loves"]
  ]
}
```

### Tags

| Tag   | Required | Description                                                          |
|-------|----------|----------------------------------------------------------------------|
| `p`   | Yes (≥0) | 32-byte hex pubkey of a loved person. Per NIP-51, new entries are appended to the end so the list stays in chronological order of being added. |
| `alt` | Yes      | NIP-31 human-readable fallback.                                      |

### Content

Empty by convention. Clients MAY use the NIP-51 private-items scheme (NIP-44-encrypted stringified tag array) for loves the user prefers to keep private; 2140.wtf currently publishes public entries only and ignores ciphertext it cannot decrypt.

### Client Behavior

- **Feed priority:** people on the viewer's Love List get a dedicated **Loved** feed tab, placed before the Follows tab. The tab shows posts from loved people only — including people the viewer doesn't follow. Reposts and reactions are excluded: the tab surfaces what loved people post, not what they boost or react to.
- **Updates as content:** a kind 15683 event itself renders in feeds as a "love letter" card listing the loved people (avatar + name per `p` tag).
- **Mutations** MUST follow read-modify-write: fetch the freshest kind 15683 for the author, rebuild the `p` tags, preserve unknown tags and `content`, and republish.
- Clients SHOULD hide kind 15683 events with zero `p` tags (an emptied list has nothing to display).

---

## Kind 10133: Payment Targets (NIP-A3)

**Author:** ATXMJ
**Spec:** https://github.com/ATXMJ/nips/blob/main/A3.md

### Summary

Replaceable event (one per user) that declares a user's donation endpoints — "payment targets" — as `(type, authority)` pairs in `payto` tags, following the [RFC-8905 `payto:` URI scheme](https://www.rfc-editor.org/rfc/rfc8905.html). In 2140.wtf's UI this is surfaced as the **"Accept Donations"** section of the Edit Profile screen; the term *payment targets* is used only in code.

### Event Structure

```json
{
  "kind": 10133,
  "pubkey": "<user-pubkey>",
  "content": "",
  "tags": [
    ["payto", "bitcoin", "bc1qxq66e0t8d7ugdecwnmv58e90tpry23nc84pg9k"],
    ["payto", "lightning", "user@walletofsatoshi.com"],
    ["payto", "monero", "4..."],
    ["alt", "Payment targets"]
  ]
}
```

### Tags

| Tag     | Required | Description                                                                                  |
|---------|----------|----------------------------------------------------------------------------------------------|
| `payto` | Yes (≥1) | `["payto", "<type>", "<authority>", …]`. Element 1 is the lowercase payment type, element 2 the address/handle/lightning address. Elements beyond index 2 are reserved per RFC-8905 and ignored. |
| `alt`   | Recommended | NIP-31 human-readable fallback.                                                           |

`type` is case-insensitive and normalized to lowercase. `authority` format is payment-system-specific.

### 2140.wtf Implementation Notes

2140.wtf restricts the **editable** set to a curated allowlist of recognized types and renders only those it recognizes (forward-compatible: unknown types in a fetched event are ignored, not rendered as garbage):

| Type       | Label      | Kind in 2140.wtf | Clickable URI                         |
|------------|------------|---------------|----------------------------------------|
| `bitcoin`  | Bitcoin    | native        | n/a (uses the built-in send flow)      |
| `lightning`| Lightning  | native        | n/a (uses the built-in zap flow)       |
| `bolt12`   | BOLT12     | generic       | `bolt12:<offer>`                       |
| `monero`   | Monero     | generic       | `monero:<address>`                     |
| `cashme`   | Cash App   | generic       | `https://cash.app/$<handle>`           |
| `venmo`    | Venmo      | generic       | `https://venmo.com/u/<handle>`         |
| `revolut`  | Revolut    | generic       | `https://revolut.me/<handle>`          |

Rules 2140.wtf enforces:

- **At most one target per type.** When parsing, the first valid target of each type wins; the editor enforces uniqueness on save.
- **Validation per type** — each authority is validated (bech32(m)/SP checksum for Bitcoin, lightning-address/LNURL shape for Lightning, base58 for Monero, etc.). Invalid entries are dropped on parse and rejected in the editor.
- **Precedence over derived/kind-0 values.** A `bitcoin` payment target overrides the recipient's pubkey-derived Taproot address in the zap flow; a `lightning` payment target takes precedence over the kind-0 `lud16`/`lud06`.
- **BOLT12 static Lightning offers.** A `bolt12` target contains a BIP-341/BOLT12 static offer (`lno1…`). 2140.wtf renders it as a QR code and copyable offer, and links out to `bolt12:<offer>`. It is treated as a Lightning-capable rail for donation buttons but uses the generic payment pane because the client does not fetch BOLT12 invoices.
- **Bitcoin target rail.** A `bc1q…`/`bc1p…` Bitcoin target sends on-chain and still publishes a kind 8333 attribution. An `sp1…` (BIP-352 silent payment) Bitcoin target sends on the silent-payment rail and publishes **no** kind 8333 event, preserving unlinkability.
- **Native vs. generic rendering.** Bitcoin and Lightning reuse 2140.wtf's existing purpose-built flows (no extra clickable button). Generic methods render a QR code, a copyable address, and a button that opens the **native URI** (preferred over `payto:` per the user's request) — falling back to the method's web payment page for custodial handles.
- **Zap dialog switcher.** When a recipient has more than one available method, the zap dialog's title becomes a dropdown switcher (Bitcoin icon + down chevron) for choosing between Bitcoin, Lightning, and any declared payment targets.

2140.wtf does **not** generate or render `payto://` URIs; it prefers each method's native scheme.

---

## NIP-99 Classified Listings: Accepted Payment Methods (2140.wtf extension)

NIP-99 (`kind:30402` / `kind:30403`) does not define a tag for declaring which payment rails a seller accepts for a given listing. 2140.wtf adds an optional `payment` tag so a listing can restrict the methods shown to buyers at checkout.

### Event Structure

```json
{
  "kind": 30402,
  "pubkey": "<seller-pubkey>",
  "content": "Full listing description…",
  "tags": [
    ["d", "<unique-id>"],
    ["title", "Signed Bitcoin poster"],
    ["price", "21000", "SATS"],
    ["payment", "lightning"],
    ["payment", "bitcoin"],
    ["payment", "cashu"],
    ["alt", "Product listing: Signed Bitcoin poster"]
  ]
}
```

### Tags

| Tag       | Required | Description                                                                                              |
|-----------|----------|----------------------------------------------------------------------------------------------------------|
| `payment` | No (≥0)  | `["payment", "<method>"]`. Declares one accepted payment rail. Omitting the tag means "accept all rails the seller has configured". |

### Recognized method values

| Value             | Label          | Notes                                                                                     |
|-------------------|----------------|-------------------------------------------------------------------------------------------|
| `cashu`           | Cashu          | Peer-to-peer ecash via NIP-61 Nutzaps.                                                    |
| `lightning`       | Lightning      | BOLT-11 invoice or LNURL/address.                                                         |
| `bitcoin`         | Bitcoin        | On-chain Bitcoin (including BIP-352 silent payments when the seller's target is `sp1…`). |
| `silent-payments` | Silent Payments| BIP-352 silent payment; 2140.wtf routes through the same native Bitcoin flow.            |
| `bolt12`          | BOLT12         | Static Lightning offer from a NIP-A3 `payto bolt12` target.                               |
| `xmr`             | Monero         | Generic Monero address from a NIP-A3 `payto monero` target.                               |

Values are case-insensitive. Unknown `payment` values are ignored on parse and do not break rendering.

### 2140.wtf Implementation Notes

- **Listing-level filtering.** When a listing carries one or more `payment` tags, `MarketplaceBuyDialog` passes the list to `ZapDialog`, which hides any payment rail that is not in the allowlist.
- **Profile-level discovery is unchanged.** The buyer-side dialog still resolves the seller's `kind:10133` payment targets and `kind:10019` Cashu receiver ad; the `payment` tags only filter which of those resolved rails are offered.
- **Bitcoin and Silent Payments overlap.** Both `bitcoin` and `silent-payments` allow the native Bitcoin method in `ZapDialog`, because that dialog already switches between on-chain and silent-payment behavior based on the seller's published `bitcoin` target authority.
- **Monero alias.** The `xmr` value maps to the `monero` NIP-A3 payment target; `monero` is also accepted as an alias when parsing.

---

## Kind 36767: Theme Definition

### Summary

Addressable event kind for publishing shareable custom UI themes. A single user may publish multiple themes, each identified by a unique `d` tag.

A theme consists of colors, optional fonts, and an optional background. Colors are stored in `c` tags, fonts in `f` tags, and background in a `bg` tag.

### Event Structure

```json
{
  "kind": 36767,
  "content": "",
  "tags": [
    ["d", "mk-dark-theme"],
    ["c", "#1a1a2e", "background"],
    ["c", "#e0e0e0", "text"],
    ["c", "#6c3ce0", "primary"],
    ["f", "Inter", "https://example.com/inter.woff2", "body"],
    ["f", "Playfair Display", "https://example.com/playfair.woff2", "title"],
    ["bg", "url https://example.com/bg.jpg", "mode cover", "m image/jpeg", "dim 1920x1080"],
    ["title", "MK Dark Theme"],
    ["alt", "Custom theme: MK Dark Theme"]
  ]
}
```

### Content

The `content` field is unused and MUST be an empty string (`""`).

### Tags

| Tag     | Required | Description                                                                           |
|---------|----------|---------------------------------------------------------------------------------------|
| `d`     | Yes      | Unique identifier (slug) for this theme, e.g. `"mk-dark-theme"`                      |
| `c`     | Yes (×3) | Hex color with marker. See [Color Tags](#color-tags).                                 |
| `f`     | No       | Font declaration. See [Font Tag](#font-tag).                                          |
| `bg`    | No       | Background media. See [Background Tag](#background-tag).                              |
| `title` | Yes      | Human-readable theme name                                                             |
| `alt`   | Yes      | NIP-31 human-readable fallback                                                        |

### Multiple Themes Per User

Since kind 36767 is addressable, a user can publish multiple themes by using different `d` tag values. Publishing a new event with the same `d` tag replaces the previous version (this is how editing works).

---

## Kind 16767: Active Profile Theme

### Summary

Replaceable event that represents the user's currently active profile theme. Only one per user. When other users visit a profile, they query this kind to determine what theme to display.

### Event Structure

```json
{
  "kind": 16767,
  "content": "",
  "tags": [
    ["c", "#1a1a2e", "background"],
    ["c", "#e0e0e0", "text"],
    ["c", "#6c3ce0", "primary"],
    ["f", "Inter", "https://example.com/inter.woff2", "body"],
    ["f", "Playfair Display", "https://example.com/playfair.woff2", "title"],
    ["bg", "url https://example.com/bg.jpg", "mode cover", "m image/jpeg"],
    ["title", "MK Dark Theme"],
    ["alt", "Active profile theme"]
  ]
}
```

### Content

The `content` field is unused and MUST be an empty string (`""`).

### Tags

| Tag     | Required | Description                                                                           |
|---------|----------|---------------------------------------------------------------------------------------|
| `c`     | Yes (×3) | Hex color with marker. See [Color Tags](#color-tags).                                 |
| `f`     | No       | Font declaration. See [Font Tag](#font-tag).                                          |
| `bg`    | No       | Background media. See [Background Tag](#background-tag).                              |
| `title` | No       | Human-readable name for the theme                                                     |
| `alt`   | Yes      | NIP-31 human-readable fallback                                                        |

### Client Behavior

- When visiting a profile, clients query `{ kinds: [16767], authors: [pubkey], limit: 1 }` to get the active theme.
- Clients read the `c` tags to extract colors, `f` tags for fonts, and `bg` tag for the background.
- Setting a new active theme publishes a new kind 16767 event (replacing the old one).
- To remove the active theme, publish a kind 5 deletion event targeting kind 16767.

---

## Shared Tag Definitions

The following tag definitions apply to both kind 36767 and kind 16767.

### Color Tags

Format: `["c", "#rrggbb", "<marker>"]`

| Index | Required | Description                                                                                   |
|-------|----------|-----------------------------------------------------------------------------------------------|
| 0     | Yes      | Tag name: `"c"`                                                                               |
| 1     | Yes      | Lowercase 6-digit hex color code including the `#` sign (e.g. `"#ff0000"`)                    |
| 2     | Yes      | Color role marker: one of `"primary"`, `"text"`, or `"background"`                            |

- All three markers (`"primary"`, `"text"`, `"background"`) MUST be present.
- Only one `c` tag per marker is allowed.

### Font Tag

Format: `["f", "<family>", "<url>", "<role>"]`

| Index | Required | Description                                                                                   |
|-------|----------|-----------------------------------------------------------------------------------------------|
| 0     | Yes      | Tag name: `"f"`                                                                               |
| 1     | Yes      | CSS `font-family` name (e.g. `"Inter"`)                                                       |
| 2     | Yes      | Direct URL to a font file (`.woff2`, `.ttf`, `.otf`)                                          |
| 3     | Yes      | Font role: `"body"` or `"title"`                                                              |

**Roles:**

| Role      | Applies to                                      |
|-----------|--------------------------------------------------|
| `"body"`  | All text globally (body, headings, UI elements)  |
| `"title"` | The user's profile display name                  |

**Rules:**

- The `f` tag is optional on the event.
- At most one `f` tag per role is allowed (i.e. one body font and one title font).
- The `"body"` font tag MUST be ordered before the `"title"` font tag. This ensures backward-compatible clients that only read the first `f` tag will pick up the body font.
- If the URL fails to load, the client SHOULD fall back to a default font gracefully.
- Clients that do not recognize a role SHOULD ignore that `f` tag.
- Legacy events with an `f` tag that has no role marker (only 3 elements) SHOULD be treated as `"body"`.
- Variable font files (covering multiple weights in a single file) are preferred.

### Background Tag

The `bg` tag uses an `imeta`-style variadic format where each entry (after the tag name) is a space-delimited key/value pair.

Format: `["bg", "url <url>", "mode <mode>", "m <mime-type>", ...]`

| Key         | Required | Description                                                                              |
|-------------|----------|------------------------------------------------------------------------------------------|
| `url`       | Yes      | URL to an image or video file                                                            |
| `mode`      | Yes      | Display mode: `"cover"` or `"tile"`                                                      |
| `m`         | Yes      | MIME type (e.g. `"image/jpeg"`, `"image/png"`, `"video/mp4"`)                            |
| `dim`       | No       | Dimensions in pixels: `"<width>x<height>"` (e.g. `"1920x1080"`)                          |
| `blurhash`  | No       | Blurhash placeholder string for progressive loading                                      |

- At most one `bg` tag is allowed per event.
- Clients MAY choose not to render video backgrounds for performance or bandwidth reasons.
- Unknown keys SHOULD be ignored for forward compatibility.

---

## Kind 16769: Profile Tabs

### Summary

Replaceable event kind for publishing a user's custom profile page tabs. Exactly one event per user (no `d` tag). Each tab defines a Nostr filter (NIP-01) that clients execute to populate the tab's content.

Visitors who load a profile fetch this event to display the custom tabs alongside the standard Posts / Media / Likes / Wall tabs.

### Event Structure

```json
{
  "kind": 16769,
  "content": "",
  "tags": [
    ["var", "$follows", "p", "a:3:$me:"],
    ["tab", "Bitcoin Posts", "{\"kinds\":[1],\"authors\":[\"$me\"],\"search\":\"bitcoin\"}"],
    ["tab", "Feed", "{\"kinds\":[1,6],\"authors\":[\"$follows\"],\"limit\":40}"],
    ["alt", "Custom profile tabs"]
  ]
}
```

### Content

The `content` field is unused and MUST be an empty string (`""`).

### Tags

| Tag   | Format                                         | Description                                                    |
|-------|------------------------------------------------|----------------------------------------------------------------|
| `tab` | `["tab", "<label>", "<filterJSON>"]`           | One tag per custom tab. Order defines display order.           |
| `var` | `["var", "<$name>", "<tag>", "<pointer>"]`     | Variable definition. See [Variable Tags](#variable-tags).      |
| `alt` | `["alt", "Custom profile tabs"]`               | NIP-31 human-readable fallback. Required.                      |

### Tab Filter JSON

The third element of each `tab` tag is a JSON-encoded **NIP-01 filter object**, optionally extended with the NIP-50 `search` field. Variable placeholders (strings starting with `$`) may appear wherever a string value is expected.

```json
{
  "kinds": [1],
  "authors": ["$me"],
  "search": "bitcoin",
  "limit": 20
}
```

Supported filter fields: `ids`, `authors`, `kinds`, `#<tag>` (e.g. `#t`, `#e`, `#p`), `since`, `until`, `limit`, `search`.

### Variable Tags

Variable tags define named placeholders that are resolved before the filter is executed. Each `var` tag extracts tag values from a referenced Nostr event.

Format: `["var", "$name", "<tag-to-extract>", "<event-pointer>"]`

| Index | Description                                                                                      |
|-------|--------------------------------------------------------------------------------------------------|
| 0     | Tag name: `"var"`                                                                                |
| 1     | Variable name, starting with `$` (e.g. `"$follows"`)                                            |
| 2     | Tag name to extract values from in the referenced event (e.g. `"p"`)                             |
| 3     | Event pointer: `e:<event-id>` for a specific event, or `a:<kind>:<pubkey>:<d-tag>` for an addressable/replaceable event coordinate. Variables like `$me` may appear in the pubkey position. |

Example — extract follow list pubkeys:
```json
["var", "$follows", "p", "a:3:$me:"]
```

This means: fetch the kind 3 event authored by `$me`, extract all `p` tag values, and bind them to `$follows`.

### Reserved Variable: `$me`

The `$me` variable is the only runtime-provided variable. It resolves to the **profile owner's pubkey** (the author of the kind 16769 event). It does not require a `var` tag definition.

### Variable Resolution

When a variable appears in a filter field that expects an array (e.g. `authors`, `ids`, `#p`), the variable is **expanded in-place** (spliced into the array). Literal values may be mixed with variables.

```json
["tab", "Mixed", "{\"authors\":[\"$follows\",\"abc123...\"],\"kinds\":[1]}"]
```

After resolution (assuming `$follows` = `["pk1", "pk2"]`):
```json
{"authors": ["pk1", "pk2", "abc123..."], "kinds": [1]}
```

### Behavior

- To **add or update** tabs: publish a new kind 16769 event with all current `tab` and `var` tags.
- To **clear** all tabs: publish a kind 16769 event with no `tab` tags (only `alt`).
- Clients MUST filter by `authors: [pubkey]` when querying to prevent spoofing.
- `var` tags are shared across all `tab` tags in the same event.

---

## Kind 0 Extension: Avatar Shape

### Summary

An optional `shape` property on kind 0 (profile metadata) that controls how the user's avatar is masked/clipped when displayed. The value is an emoji character whose silhouette is used as a mask over the avatar image. When absent, the avatar renders as the standard circle.

### Metadata Field

The `shape` field is added to the JSON content of a kind 0 event alongside standard fields like `name`, `picture`, etc. Its value is a single emoji character (including multi-codepoint emoji such as flags, ZWJ sequences, and skin-tone variants).

```json
{
  "kind": 0,
  "content": "{\"name\":\"Luna\",\"picture\":\"https://example.com/luna.jpg\",\"shape\":\"🌙\"}"
}
```

### Client Behavior

- When `shape` is absent, clients SHOULD render the avatar as a circle (the current universal default).
- When `shape` is a valid emoji, clients SHOULD use the emoji's silhouette as an alpha mask over the avatar image. The specific rendering technique is platform-dependent (see below).
- When `shape` is set to an unrecognized or invalid value, clients MUST fall back to a circle. This ensures forward compatibility.
- The `shape` field is purely cosmetic and has no protocol-level significance.
- Clients MAY choose not to support this extension, in which case avatars render as circles as usual.

---

## Community NIP Specifications

The following specifications are maintained by their respective authors. 2140.wtf implements these kinds but does not own the specs. See each link for the full event structure, tags, and client behavior.

### Color Moments (Kind 3367)

**Author:** Chad Curtis
**Spec:** https://gitlab.com/chad.curtis/espy/-/blob/main/NIP.md
**App:** https://espy.you

Color palette posts capturing 3-6 colors from a beautiful moment, optionally accompanied by an emoji and layout preference. Supports horizontal, vertical, grid, star, checkerboard, and diagonal stripe layouts. A form of pre-verbal visual communication through color and emotion.

### Birdstar (Kinds 2473, 12473, 30621)

**Author:** Alex Gleason
**Spec:** https://gitlab.com/alexgleason/birdstar/-/blob/main/NIP.md
**App:** https://birdstar.app

Birdstar merges Birdsong Spotter (a bird-by-ear checklist) and Starpoint (an interactive sky map with community constellations) into a single client.

- **Kind 2473 — Bird Detection.** A regular event representing a single identified bird observation. The species is identified by a NIP-73 `i`/`k` pair pointing at the species' Wikidata entity URI (e.g. `https://www.wikidata.org/entity/Q26825` for the American Robin). The `content` field holds an optional freeform human note about the detection. Required tags: NIP-31 `alt`, NIP-73 `i` (Wikidata URL) + `k` (`web`). 2140.wtf renders detections as a species card with the Wikipedia thumbnail, common/scientific name, and article summary.
- **Kind 12473 — Birdex.** A replaceable event (one per author) indexing every distinct species the author has ever confirmed via kind 2473. Each species is a positional `i`/`n` pair — the Wikidata entity URI followed immediately by the scientific binomial name — emitted in chronological order of first detection. 2140.wtf renders a Birdex as a tiled grid of species, each tile showing the Wikipedia thumbnail with the common name overlaid. In feeds, only the most recent few tiles are shown with a "+N" capstone mirroring how kind 3 follow lists preview members; the post-detail page shows every species.
- **Kind 30621 — Custom Constellation.** An addressable event (`d` tag) representing a single user-drawn star figure. Each `edge` tag (`["edge", from, to]`) references two Hipparcos catalog numbers as decimal strings — e.g. `["edge", "32349", "37279"]` for Sirius → Procyon. Required tags: `d`, `title`, `alt`, and at least one valid `edge`. The `content` field is a freeform description. 2140.wtf renders constellations as a stylized SVG star-map (gnomonically projected onto a tangent plane at the figure's centroid, with stars sized by magnitude) using a bundled Hipparcos catalog that is code-split so the data only loads when a constellation is actually viewed.

### Geocaching (Kinds 37516, 7516)

**Author:** Chad Curtis
**Spec:** https://gitlab.com/chad.curtis/treasures/-/blob/main/NIP-GC.md
**App:** https://treasures.to

NIP-GC defines geocaching on Nostr. Kind 37516 (addressable) is a geocache listing with location (geohash), difficulty/terrain scores, size, and type. Kind 7516 is a found log recording a successful visit. The spec also covers comment logs (kind 1111 via NIP-22), verified finds with cryptographic proof (kind 7517), and cache retirement.

### Private Messaging

2140.wtf uses **NIP-17** (kind 14 private direct messages wrapped in kind 1059 gift wraps) for private messaging. The legacy kind 8211 "Encrypted Letter" feature has been removed from 2140.wtf's UI and will no longer be rendered or published.

### Weather Station (Kinds 4223, 16158)

**Author:** Sam Thomson
**Spec:** https://github.com/nostr-protocol/nips/pull/2163
**App:** https://weather.shakespeare.wtf
**Firmware:** https://github.com/samthomson/weather-station

Kind 16158 (replaceable) describes a weather station's configuration: name, geohash location, elevation, power source, connectivity, and sensor inventory. Kind 4223 (regular) carries individual sensor readings as 3-parameter tags `[sensor_type, value, model]`, enabling historical queries and cross-station comparison. Each station has its own keypair.

### Pets Virtual Pet (Kinds 31124, 14919, 14920, 14921, 11125)

**Author:** Danifra
**Spec:** https://github.com/Danidfra/nostr-pet/blob/production/NIP.md
**App:** https://nostr-pet.vercel.app
**See also:** [Pets tag schema](docs/pets/pets-tag-schema.md) (2140.wtf-specific integration details)

NIP-BB defines a virtual pet lifecycle on Nostr. Kind 31124 (addressable) holds the current pet state across three stages (egg, baby, adult) with stats, appearance, and personality traits. Kind 14919 logs individual interactions, kind 14920 records breeding events, kind 14921 stores immutable lifecycle records, and kind 11125 (replaceable) holds the owner's profile with coins, achievements, and inventory.

#### Kind 31124 `bao_rarity`, `breed_category`, `breed_asset` tags

2140.wtf extends kind 31124 with breed-category tags so pets can have category-specific gameplay:

| Tag | Value | Description |
|-----|-------|-------------|
| `breed_category` | `2140-pets` \| `ditto-blobbi` \| `bao` | Visual family / gameplay category |
| `breed_asset` | string | Adult form ID or BAO card ID |
| `bao_rarity` | `common` \| `uncommon` \| `rare` \| `epic` \| `legendary` | ₿AO rarity tier, derived from `breed_asset` |

These tags are set at mint time and persist across all stage transitions.

#### Kind 31124 category abilities

Each `breed_category` grants passive gameplay bonuses that are computed at read time:

- `ditto-blobbi`: happiness decay is 15% slower; base stat cap increased by 5.
- `2140-pets`: daily quest tally progress counts as +20%; missed-care health penalties are 30% shorter; +10% sats from care and missions during local daylight hours (06:00–18:00).
- `bao`: stat-cap and daily BAO reward bonuses are derived from `bao_rarity`:
  - common: cap 100, +1,000 sats
  - uncommon: cap 105, +1,800 sats
  - rare: cap 112, +2,800 sats
  - epic: cap 120, +4,000 sats
  - legendary: cap 130, +5,000 sats

Stat effects are calculated against the effective cap, but stored stat tags remain clamped to 100 for backward compatibility. Clients that render stat bars should treat values above 100 as capped for display unless they explicitly support over-cap buffers.

#### Kind 31124 breeding tags

When a pet is created via breeding, the offspring egg carries parent references and the parents receive a cooldown tag:

| Tag | Value | Description |
|-----|-------|-------------|
| `parent_a` | canonical d-tag | First parent |
| `parent_b` | canonical d-tag | Second parent |
| `breeding_cooldown` | Unix timestamp | When this adult can breed again |

#### Kind 11125 `wallet_mode` tag

2140.wtf extends kind 11125 with a `wallet_mode` tag that selects how Pets economy costs are settled:

| Value | Meaning |
|-------|---------|
| `demo-sats` | Costs are paid with in-game demo `sats` stored on the profile. This is the default and the only mode currently enabled for testing. |
| `btc-sats` | Costs are settled with real BTC sats from an external Cashu/NIP-60 wallet before the in-game `sats` ledger is updated. This mode is gated by a feature flag and not yet active in production builds. |

Legacy values `demo`, `real`, and `bao` SHOULD be read for backward compatibility. When the real-sats feature flag is enabled, map them as follows: `demo` → `demo-sats`; `real` and `bao` → `btc-sats`. When the flag is disabled, or when the tag is missing or unrecognized, clients MUST treat the profile as `demo-sats`.

#### Kind 11125 `content` JSON — `missions` field

The `content` of kind 11125 is a JSON object. 2140.wtf extends it with a `missions` field that tracks daily and evolution mission progress:

```jsonc
{
  "missions": {
    "date": "2026-04-16",       // ISO date string for the current daily mission set
    "daily": [ /* Mission[] */ ],
    "evolution": [ /* Mission[] — active hatch/evolve tasks, cleared on stage transition */ ],
    "rerolls": 2                // remaining daily mission rerolls
  }
  // ...other profile fields
}
```

#### Kind 11125 `sats` tag

The Pets economy uses a single `sats` balance for all breed categories. In `demo-sats` wallet mode these are in-game demo sats; in `btc-sats` wallet mode they represent real BTC sats settled via an external Cashu/NIP-60 wallet.

| Tag | Meaning | Default |
|-----|---------|---------|
| `sats` | Demo-sats / BTC-sats balance | `0` |

New Nostr pets start with `0` sats and earn them from daily login bonuses, daily missions, BAO trading rewards, and battles.

#### Kind 11125 `content` JSON — BAO trade streak

For ₿AO evolution missions and reward bonuses, the profile tracks consecutive days with BAO trading activity:

```jsonc
{
  "baoTradeStreak": 2,              // consecutive days with BAO trades
  "baoTradeStreakLastDay": "2026-04-16"  // local day string of last streak update
}
```

#### Kind 11125 `content` JSON — `room_layouts` field

The `content` of kind 11125 MAY include a `room_layouts` field for per-room visual customization:

```json
{
  "room_layouts": {
    "v": 1,
    "by_room": {
      "home": {
        "wall": {
          "style": "stripes",
          "palette": ["#2a1f4e", "#3d2d6b"],
          "variant": "narrow",
          "angle": 45
        },
        "floor": {
          "style": "wood",
          "palette": ["#8b5e3c", "#6b4226"],
          "variant": "medium"
        }
      }
    }
  }
}
```

**Top-level shape:**

| Field     | Type | Description |
|-----------|------|-------------|
| `v`       | `1`  | Schema version. MUST be `1`. |
| `by_room` | `Partial<Record<PetsRoomId, RoomLayout>>` | Per-room layouts keyed by room ID. |

**`RoomLayout` shape:** `{ wall: RoomSurfaceLayout, floor: RoomSurfaceLayout }`

**`RoomSurfaceLayout` fields:**

| Field     | Required | Description |
|-----------|----------|-------------|
| `style`   | Yes      | Surface style. Walls: `solid`, `stripes`, `dots`, `gradient`. Floors: `solid`, `wood`, `tile`, `carpet`. |
| `palette` | Yes      | Array of 1–4 hex colors. |
| `variant` | No       | One of: `soft`, `medium`, `bold`, `wide`, `narrow`. |
| `angle`   | No       | Pattern rotation in degrees, normalized to 0–359. |

**Hex color validation:** Colors MUST match `/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/` (3, 6, or 8 hex digits with a leading `#`).

**Angle validation:** Angles MUST be finite numbers. Clients normalize by rounding and wrapping into 0–359: `((Math.round(angle) % 360) + 360) % 360`.

**Parser behavior:** Unrecognized room IDs are skipped. Surfaces with an invalid `style` or `palette` cause the entire room entry to be discarded. Invalid `variant` or `angle` values are ignored (treated as absent). The parser never throws — malformed data falls back to defaults. If `v` is not `1`, the entire `room_layouts` object is ignored.

Clients MUST fall back to built-in defaults for any room without a valid layout entry.

#### Kind 11125 `content` JSON — `room_furniture` field

The `content` of kind 11125 MAY include a `room_furniture` field for per-room decorative furniture placements:

```json
{
  "room_furniture": {
    "v": 1,
    "by_room": {
      "home": [
        { "id": "official:plant-small", "x": 0.85, "y": 0.72, "layer": "front", "scale": 0.9 },
        { "id": "official:clock-wall", "x": 0.5, "y": 0.18, "layer": "back" },
        { "id": "official:picture-frame", "x": 0.3, "y": 0.3, "layer": "back", "content": { "imageUrl": "https://cdn.example.com/photo.jpg" } }
      ]
    }
  }
}
```

**Top-level shape:**

| Field     | Type | Description |
|-----------|------|-------------|
| `v`       | `1`  | Schema version. MUST be `1`. |
| `by_room` | `Partial<Record<PetsRoomId, FurniturePlacement[]>>` | Per-room placement arrays keyed by room ID. |

**`FurniturePlacement` fields:**

| Field     | Required | Description |
|-----------|----------|-------------|
| `id`      | Yes      | Namespaced furniture ID. MUST match `/^[a-z][a-z0-9]*:[a-z][a-z0-9-]*$/` (e.g. `official:plant-small`). |
| `x`       | Yes      | Horizontal position, normalized 0–1 (0 = left edge, 1 = right edge). Clamped to [0, 1]. |
| `y`       | Yes      | Vertical position, normalized 0–1 (0 = top of room, 1 = bottom). Clamped to [0, 1]. |
| `layer`   | Yes      | Rendering layer: `back` (wall-mounted), `floor` (behind Pets), or `front` (in front of Pets). |
| `scale`   | No       | Size multiplier. Clamped to [0.5, 2.0]. Default `1`. |
| `flip`    | No       | Horizontal mirror. Boolean. Default `false`. |
| `variant` | No       | Named variant string (1–32 chars), validated against the item's definition at render time. |
| `content` | No       | Dynamic per-instance content. See below. |

**`FurnitureContent` fields:**

| Field      | Required | Description |
|------------|----------|-------------|
| `imageUrl` | No       | Image URL for picture frames. MUST be a valid `https:` URL; non-https URLs are rejected. |

**Per-room cap:** A maximum of 20 placements per room is enforced. Excess items beyond the cap are dropped (first 20 kept).

**Parser behavior:** Unrecognized room IDs are skipped. Items with an invalid `id`, non-finite `x`/`y`, or unrecognized `layer` are silently dropped. Invalid optional fields (`scale`, `flip`, `variant`, `content`) are ignored (treated as absent). `imageUrl` values that are not valid `https:` URLs are rejected. The parser never throws — malformed data falls back to defaults. If `v` is not `1`, the entire `room_furniture` object is ignored.

Clients MUST fall back to built-in defaults for any room without a valid furniture entry.

#### Kind 1124: Pets Social Interaction

Immutable, regular (non-replaceable) event that logs a single interaction with a Pets. These events form an append-only interaction log. They do **not** directly mutate the canonical kind 31124 state — the owner's client consolidates pending interactions into canonical stats via a checkpoint-based system.

**Event structure:**

```json
{
  "kind": 1124,
  "content": "",
  "tags": [
    ["a", "31124:<owner-pubkey>:<pets-d-tag>"],
    ["p", "<owner-pubkey>"],
    ["action", "feed"],
    ["source", "pets-page"],
    ["2140pets", "<short-id>"],
    ["item", "<item-id>"],
    ["alt", "Pets interaction: feed"]
  ]
}
```

**Content:** Empty string (`""`).

**Required tags:**

| Tag      | Description                                                                     |
|----------|---------------------------------------------------------------------------------|
| `a`      | Coordinate of the target Pets: `31124:<owner-pubkey>:<pets-d-tag>`          |
| `p`      | Owner pubkey of the target Pets                                               |
| `action` | Interaction action. Values: `feed`, `play`, `clean`, `medicate`, `boost`, `battle` |
| `source` | UI surface that originated the interaction (e.g. `pets-page`, `companion`)    |

**Optional tags:**

| Tag      | Description                                                        |
|----------|--------------------------------------------------------------------|
| `pets` | Short Pets identifier (10-hex petId extracted from canonical d-tag) |
| `item`   | Shop item ID used in the interaction, when applicable              |
| `winner` | Canonical d-tag of the winning pet, or `draw` (battle action only) |
| `mode`   | Battle payout mode: `demo` or `real` (battle action only)          |
| `prize`  | Credits awarded to the winner as a decimal integer (battle only)   |
| `duration` | Round duration in seconds as a decimal integer (battle only)     |
| `p1_health` | Final health of fighter 1, 0–100 (battle only)                  |
| `p2_health` | Final health of fighter 2, 0–100 (battle only)                  |
| `client` | Client identifier (added automatically by the publishing hook)     |

**Action values:**

| Action     | Description                              |
|------------|------------------------------------------|
| `feed`     | Feeding the Pets                       |
| `play`     | Playing with the Pets (includes music and singing) |
| `clean`    | Cleaning the Pets                      |
| `medicate` | Administering medicine to the Pets     |
| `boost`    | Recharging the Pets's energy           |
| `battle`   | Completed pet battle match (see Battle action below) |

The `pet` action is reserved for a future version.

### Battle action

When `action` is `battle`, the event logs the outcome of a match from the 2140 Pets Battle Arena. Two `a` tags identify the fighters in player order (`31124:<owner>:<fighter-1-d-tag>`, `31124:<owner>:<fighter-2-d-tag>`). The `winner` tag contains the winning pet's d-tag or `draw`. Battle-specific tags (`mode`, `prize`, `duration`, `p1_health`, `p2_health`) are optional but recommended; clients SHOULD ignore unknown battle tags so the schema can evolve.

```json
{
  "kind": 1124,
  "content": "",
  "tags": [
    ["a", "31124:<owner-pubkey>:<fighter-1-d-tag>"],
    ["a", "31124:<owner-pubkey>:<fighter-2-d-tag>"],
    ["p", "<owner-pubkey>"],
    ["action", "battle"],
    ["source", "battle-arena"],
    ["winner", "<winner-d-tag>"],
    ["mode", "demo"],
    ["prize", "50"],
    ["duration", "60"],
    ["p1_health", "34"],
    ["p2_health", "0"],
    ["alt", "Pet battle won by <winner-d-tag>"]
  ]
}
```

**Processing model:**

- Events are processed in ascending `created_at` order with event `id` (hex string comparison) as tie-breaker
- Cooldown, dedup, and clamping logic live in the projection layer, not at publish time
- Clients MUST apply a bounded recency window (6 hours) when querying kind 1124 events, regardless of checkpoint state. If a valid checkpoint `processed_until` is more recent than the window floor, clients use the checkpoint as the `since` bound instead. Interactions older than the recency window are considered stale and MUST NOT be projected onto current stats.
- Owner consolidation writes processed stats back to kind 31124 and advances the checkpoint (stored in the event's `content` JSON). This happens automatically when the owner opens the dashboard.
- After consolidation, kind 1124 events remain available as history but MUST NOT be re-applied to canonical stats. The checkpoint's `last_event_id` and `processed_until` fields delineate the boundary.

### Kind 21124: Pets Battle Sync

Ephemeral, regular event used for live state and input synchronization during a remote 2140 Pets Battle Arena match. It is **not** persisted by clients; relays MAY treat it as ephemeral.

- `kind`: `21124`
- `content`: NIP-44 encrypted JSON payload (see below).
- Required tags:
  - `p` — recipient pubkey.
  - `e` — match ID (a UUID generated by the host).
  - `t` — `battle-sync`.

#### Payload types

All payloads include a `type` field and the same `battleId`.

| Type            | Direction        | Fields                                    | Purpose                                      |
|-----------------|------------------|-------------------------------------------|----------------------------------------------|
| `battle-invite` | host → guest     | `inviterPubkey`, `inviterPet`, `prizeAmount`, `roundDurationSeconds`, `sentAt` | NIP-17 DM payload; starts the handshake      |
| `battle-accept` | guest → host     | `guestPet`                                | Guest agrees and sends their fighter         |
| `battle-decline`| guest → host     | —                                         | Guest declines the invite                    |
| `battle-cancel` | either           | —                                         | Match cancelled before or during play        |
| `battle-state`  | host → guest     | `state` (serializable snapshot)           | Authoritative world snapshot each tick       |
| `battle-input`  | guest → host     | `input` (P2 button flags)                 | Guest's local controls                       |
| `battle-finished`| host → guest    | `winner` (`0`, `1`, or `null`)            | Final result                                 |

#### State snapshot

The `battle-state` payload carries a minimal, JSON-serializable snapshot of the host simulation: fighter positions, health/energy, cooldown timers, block/hit state, and projectile positions. Pet metadata is not re-sent; both clients already know the two fighters from the invite/accept handshake.

#### Security

- All in-match payloads are NIP-44 encrypted between the two players.
- Battle invites and lifecycle messages (`battle-invite`, `battle-accept`, `battle-decline`, `battle-cancel`) use NIP-17 gift-wrapped DMs (`kind` 14 → 13 → 1059) with `subject: battle-invite`.
- The host is authoritative: the guest renders host snapshots and sends only input events.
- Match IDs are random UUIDs and events are filtered by `(kind, author, #e)` so clients only process messages from the matched opponent.

---

## Kind 33863: Fundraiser

**Author:** Agora
**App:** https://agora.spot

### Summary

Addressable event representing a **self-authored fundraising campaign**. A campaign carries marketing-style metadata (title, summary, banner image, markdown story, optional goal, optional deadline, optional country) and one or two Bitcoin wallet endpoints declared in `w` tags. Each wallet endpoint is either a public on-chain bech32(m) address (`bc1q…`, `bc1p…`) or a silent-payment code (`sp1…`, per BIP-352). The mode of each endpoint is inferred from the prefix — the client renders a QR code that combines the present endpoints and adjusts the donation-progress UI accordingly. A campaign MAY declare **at most one** endpoint per mode (at most one on-chain address and at most one silent-payment code).

The author of the event is also the beneficiary. Campaigns are never authored on behalf of someone else; the event creator owns the wallet declared in `w` and receives the donations. To stop accepting donations, the creator publishes a NIP-09 kind 5 deletion request referencing the campaign's `a` coordinate.

The kind is addressable so the creator can edit the story, banner, goal, deadline, and wallet over the life of the campaign without minting new identifiers. The `d` tag is the campaign's slug.

### Event Structure

```json
{
  "kind": 33863,
  "pubkey": "<creator-pubkey>",
  "content": "<markdown story>",
  "tags": [
    ["d", "save-the-last-bookstore"],

    ["title", "Save the Last Bookstore"],
    ["summary", "Help our 40-year-old neighborhood bookstore make rent through winter."],
    ["banner", "https://blossom.example/abc123.jpg"],
    ["imeta",
      "url https://blossom.example/abc123.jpg",
      "m image/jpeg",
      "x abc123def456...",
      "dim 1600x900",
      "blurhash LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
      "alt Storefront of the Last Bookstore at dusk"
    ],
    ["alt", "Fundraising campaign: Save the Last Bookstore"],

    ["w", "bc1p7w2k3xq9...xyz"],
    ["w", "sp1qq...verylongsilentpaymentcode..."],

    ["goal", "25000"],
    ["deadline", "1735689600"],

    ["i", "iso3166:US"],
    ["k", "iso3166"],
    ["t", "legal-defense"],
    ["t", "mutual-aid"]
  ]
}
```

A silent-payment-only campaign omits the `bc1…` `w` tag and carries only the `sp1…`:

```json
["w", "sp1qq...verylongsilentpaymentcode..."]
```

An on-chain-only campaign omits the `sp1…` `w` tag and carries only the `bc1…`:

```json
["w", "bc1p7w2k3xq9...xyz"]
```

### Content

The `content` field is the **campaign story**, formatted as Markdown. Clients SHOULD render it with the same Markdown renderer they use for NIP-23 long-form content. Empty content is permitted (e.g. for a campaign that lives entirely in its summary).

### Tags

| Tag       | Required | Description                                                                                                                                                                                                                  |
|-----------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `d`       | Yes      | Campaign slug, unique per author. Forms the addressable coordinate `33863:<pubkey>:<d>`.                                                                                                                                     |
| `title`   | Yes      | Display title of the campaign (plain text, max ~200 chars).                                                                                                                                                                  |
| `w`       | Yes      | Bitcoin wallet endpoint. The 2nd element is a single bech32(m) string: a mainnet on-chain address starting with `bc1q` (P2WPKH/P2WSH) or `bc1p` (P2TR), **or** a silent-payment code starting with `sp1` per BIP-352. A campaign MUST carry at least one `w` tag and MAY carry up to two — at most one per mode (on-chain and silent payment). |
| `summary` | Recommended | Short one-paragraph tagline shown in feed cards and previews.                                                                                                                                                              |
| `banner`  | Recommended | HTTPS URL of the wide banner image. Clients MUST sanitize the URL before rendering, and SHOULD pair the URL with a NIP-92 `imeta` tag for dimensions, blurhash, MIME type, and SHA-256.                                    |
| `imeta`   | Recommended | NIP-92 media metadata for the banner. The first `url <value>` pair MUST match the `banner` URL; clients SHOULD ignore an `imeta` whose URL does not match.                                                                  |
| `goal`    | Optional | Fundraising goal in **integer US Dollars** (no unit suffix, no decimals). Clients MAY display an estimated sat-equivalent at view time using a live exchange rate.                                                          |
| `deadline`| Optional | Unix timestamp (seconds) at which the campaign closes for new donations. After the deadline, clients SHOULD show the campaign as ended but MAY still accept donations.                                                       |
| `i`       | Recommended | NIP-73 country identifier. SHOULD be `iso3166:<code>` with an uppercase ISO 3166-1 alpha-2 country code (e.g. `iso3166:VE`).                                                                                          |
| `k`       | Recommended if `i` is present | NIP-73 external content kind. For country identifiers this SHOULD be `iso3166`.                                                                                                              |
| `t`       | Optional | User-entered discovery/category tags such as `legal-defense` or `mutual-aid`. Agora additionally tags every campaign with `t:agora` as its app marker. |
| `alt`     | Recommended | NIP-31 human-readable fallback.                                                                                                                                                                                            |

### Wallet Modes

The prefix of each `w` value selects one of two donation modes. Clients MUST detect the mode from the prefix; the event carries no other mode discriminator.

| Prefix              | Mode      | Description                                                                                                                              |
|---------------------|-----------|------------------------------------------------------------------------------------------------------------------------------------------|
| `bc1q…` / `bc1p…`   | On-chain  | Public mainnet bech32(m) address. Donations are traceable; clients show a progress bar, total raised, and donation list.                |
| `sp1…`              | Silent payment | BIP-352 silent-payment code. Donations are **unlinkable by design**. Clients MUST hide all aggregate totals and progress UI.          |

Other prefixes (`tb1…`, `bcrt1…`, `tsp1…`, lightning invoices, etc.) MUST be rejected at parse time; the campaign does not render. A campaign carrying two `w` tags of the same mode (e.g., two `bc1…` addresses) is invalid and MUST NOT render — only one endpoint per mode is permitted.

Clients SHOULD validate the bech32(m) checksum of each `w` value, not just its prefix.

### Combined QR

When a campaign declares both endpoints, clients SHOULD render a single BIP-21 URI that combines them:

```
bitcoin:<bc1-address>?sp=<sp1-code>
```

BIP-352-aware wallets pick the `sp=` parameter and use the silent-payment flow; legacy wallets fall back to the on-chain address. A single-endpoint campaign uses the standard form: `bitcoin:<bc1-address>` (on-chain only) or `bitcoin:?sp=<sp1-code>` (silent payment only).

### Donation Receipts

Donations to a campaign's on-chain endpoint MAY be acknowledged by publishing a kind 8333 receipt (see *Kind 8333: Onchain Zap* above) targeting the campaign's `a` coordinate. Receipts MUST NOT carry `p` tags — campaigns are not Nostr-identity recipients. The `amount` tag is the sum of tx outputs paying the campaign's `w` address (excluding the donor's change output).

Silent-payment donations MUST NOT publish a Nostr receipt. Doing so would defeat the unlinkability that the silent-payment mode is designed to provide.

### Querying

**Fetch a specific campaign:**

```json
{ "kinds": [33863], "authors": ["<creator-pubkey>"], "#d": ["<slug>"], "limit": 1 }
```

**Aggregate donations for an on-chain campaign:**

```json
{ "kinds": [8333], "#a": ["33863:<creator-pubkey>:<slug>"], "limit": 500 }
```

Clients MUST verify each kind 8333 event on-chain before counting it toward the campaign total, per the verification rules in the Kind 8333 section above. The campaign-wallet verification mode matches tx outputs against the campaign's declared `w` address rather than against derived Taproot addresses.

### 2140.wtf Implementation Notes

2140.wtf is not a campaign-management app — Agora is the canonical place to author campaigns. 2140.wtf renders kind 33863 events:

- in the home feed and profile feeds (toggle: `feedIncludeCampaigns`, default on);
- on a campaign's `/:nip19` route (its `naddr1…` link) via the standard addressable-event detail page, which renders the markdown story through the same pipeline as NIP-23 articles;
- as quote-embeds inside other notes, with banner + title + summary;
- as `Commenting on @{author}'s fundraiser` in NIP-22 comment threads anchored to the campaign coordinate.

2140.wtf **does** support donating to a campaign from inside the app:

- The action-bar zap button on a campaign post and the in-dialog **Zap** button route through `useCampaignZap` to send Bitcoin to the campaign's declared `w` endpoint. On-chain donations publish a campaign-mode kind 8333 receipt (with `a` and `K` tags, no `p` tag). Silent-payment donations publish no Nostr event, preserving SP unlinkability.
- The Donate dialog also exposes a BIP-21 QR + "Open native wallet" path for users without a PSBT-capable signer.
- The "raised" headline on the campaign card is fetched directly from the on-chain `w` address (cumulative `funded_txo_sum` from the configured Esplora endpoint, default mempool.space). Donations count regardless of whether the donor published a Nostr receipt; the number does not regress when the beneficiary spends from the address. Silent-payment-only campaigns show no aggregate.

2140.wtf does NOT consult `agora.moderation` labels for surfacing decisions — every parseable kind 33863 event renders.

---

## Roadstr

**Author:** Juraj Bednár  
**Spec:** https://github.com/jooray/roadstr/blob/main/nips/roadstr.md  
**App:** https://github.com/jooray/roadstr

Roadstr is a decentralized road-event reporting system — “Waze without the centralized tracking”. Drivers publish signed Nostr events for police checks, speed cameras, accidents, traffic jams, road closures, hazards, and more.

### Kinds

- **Kind 1315 — Road event report.** A regular event tagging the location with `lat`, `lon`, and multi-precision `g` (geohash) tags. The `t` tag carries the event type string (`police`, `speed_camera`, `traffic_jam`, `accident`, `road_closure`, `construction`, `hazard`, `road_condition`, `pothole`, `fog`, `ice`, `animal`, `other`). An optional human comment may be placed in `content`.
- **Kind 1316 — Road event confirmation.** A regular event referencing a kind 1315 report via an `e` tag and a `status` tag of either `still_there` or `no_longer_there`. Confirmations extend or shorten the report’s effective display lifetime.

### 2140.wtf implementation notes

2140.wtf renders Roadstr reports on a dedicated `/roadstr` map page and in feeds/cards/detail pages. The map queries kinds 1315 and 1316 by the geohash cells covering the current viewport, computes each report’s effective expiry from its type TTL and any confirmations, and only displays active markers. Users can also publish new kind 1315 reports from the map page using the current device location.

---

## Music Tracks & Playlists

### Kind 36787: Music Track

An addressable event containing metadata about an audio file. Full spec maintained externally.

**Required tags:** `d`, `title`, `artist`, `url`, `t` (with value `"music"`)

**Optional tags:** `image`, `video`, `album`, `track_number`, `released`, `duration`, `format`, `bitrate`, `sample_rate`, `language`, `explicit`, `zap`, `alt`

### Kind 34139: Music Playlist

An addressable event containing an ordered list of music track references.

**Required tags:** `d`, `title`, `alt`

**Optional tags:** `description`, `image`, `a` (track references), `t`, `public`, `private`, `collaborative`

Track references use `a` tags in the format `["a", "36787:<pubkey>:<d-tag>"]`.

### Albums (Convention)

Albums are represented as kind 34139 playlist events with a `["t", "album"]` tag. This reuses the existing playlist infrastructure while allowing clients to distinguish albums from user-curated playlists.

**Additional optional tags for albums:**
- `released` — ISO 8601 release date (e.g. `"2024-06-15"`)
- `label` — Record label name

**Example album event:**

```json
{
  "kind": 34139,
  "content": "Debut studio album featuring 12 tracks of ambient electronic music.",
  "tags": [
    ["d", "endless-summer-2024"],
    ["title", "Endless Summer"],
    ["image", "https://cdn.blossom.example/img/album-art.jpg"],
    ["t", "album"],
    ["t", "electronic"],
    ["t", "ambient"],
    ["released", "2024-06-15"],
    ["label", "Sunset Records"],
    ["a", "36787:abc123...:track-1"],
    ["a", "36787:abc123...:track-2"],
    ["a", "36787:abc123...:track-3"],
    ["alt", "Album: Endless Summer by The Midnight Collective"]
  ]
}
```

**Client behavior:**
- Clients detect albums by checking for a `t` tag with value `"album"` (case-insensitive)
- Albums display release date and label information when available
- Track ordering follows the order of `a` tags in the event
- The same detail view, playback, and commenting features apply to both albums and playlists


---

## ₿AO Court / Juror Mode

2140.wtf implements a browser-based **₿AO Court** jury system for ₿AO prediction-market disputes. Jurors register candidacy, are selected deterministically from a Bitcoin block hash, run a Pedersen distributed key generation (DKG) ceremony, commit/reveal votes, and produce a FROST threshold-signed dispute override attestation.

Because real cross-juror DKG requires multiple online participants, 2140.wtf includes a **demo simulation mode** that completes the ceremony locally while still publishing the current user's real events.

### Event kinds

| Kind  | Name                         | Description                                                            |
|-------|------------------------------|------------------------------------------------------------------------|
| 38025 | ₿AO Court Dispute            | A market outcome is disputed and an appeal is opened.                  |
| 39001 | ₿AO Court Juror Candidacy    | A juror registers for a dispute with category coverage and stake bond. |
| 39002 | ₿AO Court Jury Selection     | The selected jury and backups are announced for a dispute.             |
| 38031 | ₿AO Court DKG Commitment     | A juror publishes their Pedersen polynomial commitments.               |
| 39004 | ₿AO Court Vote Commit/Reveal | Commit/reveal phase for the juror's outcome vote.                      |
| 39005 | ₿AO Court FROST Commitment   | A juror publishes their FROST signing nonce commitment.                |
| 39006 | ₿AO Court FROST Reveal       | A juror reveals their FROST partial signature.                         |
| 39007 | ₿AO Court Attestation        | Final aggregated FROST dispute override attestation.                   |

### Kind 38025: ₿AO Court Dispute

Regular event filed by a market participant to dispute a resolved or resolving market outcome.

```json
{
  "kind": 38025,
  "pubkey": "<challenger-pubkey>",
  "content": "{\"marketId\":\"<market-d-tag>\",\"marketEventId\":\"<market-event-id>\",\"disputeId\":\"<32-byte-hex>\",\"originalOutcome\":\"YES\",\"proposedOutcome\":\"NO\",\"evidenceHashes\":[\"<sha256>\"]}",
  "tags": [
    ["e", "<market-event-id>", "", "root"],
    ["p", "<challenger-pubkey>"],
    ["dispute", "<32-byte-hex>"],
    ["market", "<market-d-tag>"],
    ["original", "YES"],
    ["proposed", "NO"],
    ["deadline", "<unix-seconds>"],
    ["appeal_type", "frost"],
    ["evidence", "<sha256>"],
    ["alt", "₿AO Court dispute abc123..."]
  ]
}
```

**Tags:**

| Tag          | Required | Description                                                                 |
|--------------|----------|-----------------------------------------------------------------------------|
| `e`          | Yes      | Root reference to the disputed market event.                                |
| `p`          | Yes      | Challenger pubkey.                                                          |
| `dispute`    | Yes      | 32-byte lowercase hex dispute identifier.                                   |
| `market`     | Yes      | Market d-tag / identifier.                                                  |
| `original`   | Yes      | Original market outcome being disputed.                                     |
| `proposed`   | Yes      | Outcome the challenger proposes.                                            |
| `deadline`   | Yes      | Unix seconds by which the appeal must complete.                             |
| `appeal_type`| Yes      | Always `frost` for this protocol.                                           |
| `evidence`   | No       | SHA-256 hashes of supporting evidence (one tag per hash).                   |
| `alt`        | Yes      | NIP-31 human-readable fallback.                                             |

### Kind 39001: ₿AO Court Juror Candidacy

Regular event published by a juror to opt into a dispute. The stake commitment is a mock bond for demo; production deployments require a confirmed on-chain bond.

```json
{
  "kind": 39001,
  "pubkey": "<juror-pubkey>",
  "content": "{\"marketId\":\"<market-d-tag>\",\"disputeId\":\"<32-byte-hex>\",\"stakeCapacitySats\":100000,\"wotScore\":80,\"categories\":[\"world\",\"crypto\"],\"bondAmountSats\":10000,\"bondAddress\":\"bc1q...\"}",
  "tags": [
    ["e", "<dispute-id>", "", "root"],
    ["dispute", "<32-byte-hex>"],
    ["market", "<market-d-tag>"],
    ["bond", "10000"],
    ["address", "bc1q..."],
    ["t", "world"],
    ["t", "crypto"],
    ["alt", "₿AO Court juror candidacy for dispute abc123..."]
  ]
}
```

### Kind 39002: ₿AO Court Jury Selection

Regular event announcing the selected jury and backups for a dispute. This event is trust-sensitive; clients MUST filter by the dispute coordinator when querying.

```json
{
  "kind": 39002,
  "pubkey": "<coordinator-pubkey>",
  "content": "{\"marketId\":\"<market-d-tag>\",\"disputeId\":\"<32-byte-hex>\",\"seed\":\"<hex>\",\"blockHash\":\"<32-byte-hex>\",\"selected\":[{\"idx\":1,\"pubkey\":\"<hex>\",\"stake\":10000}],\"backups\":[]}",
  "tags": [
    ["e", "<dispute-id>", "", "root"],
    ["dispute", "<32-byte-hex>"],
    ["market", "<market-d-tag>"],
    ["seed", "<hex>"],
    ["block", "<32-byte-hex>"],
    ["selected", "1", "<juror-pubkey>", "10000"],
    ["backup", "2", "<juror-pubkey>", "10000"],
    ["alt", "₿AO Court jury selection for dispute abc123..."]
  ]
}
```

### Kind 38031: ₿AO Court DKG Commitment

Regular event publishing a juror's Pedersen polynomial commitments.

```json
{
  "kind": 38031,
  "pubkey": "<juror-pubkey>",
  "content": "{\"disputeId\":\"<32-byte-hex>\",\"jurorIdx\":1,\"vssCommits\":[\"<33-byte-commit>\"]}",
  "tags": [
    ["e", "<dispute-id>", "", "root"],
    ["p", "<juror-pubkey>"],
    ["dispute", "<32-byte-hex>"],
    ["juror", "1"],
    ["commit", "<33-byte-commit>"],
    ["alt", "₿AO Court DKG commitment from juror 1"]
  ]
}
```

### Kind 39004: ₿AO Court Vote Commit / Reveal

Regular events used for the commit/reveal vote phase.

**Commit:**

```json
{
  "kind": 39004,
  "pubkey": "<juror-pubkey>",
  "content": "{\"disputeId\":\"<32-byte-hex>\",\"jurorIdx\":1,\"commitHash\":\"<sha256>\"}",
  "tags": [
    ["e", "<dispute-id>", "", "root"],
    ["dispute", "<32-byte-hex>"],
    ["juror", "1"],
    ["commit", "<sha256>"],
    ["alt", "₿AO Court vote commit from juror 1"]
  ]
}
```

**Reveal:**

```json
{
  "kind": 39004,
  "pubkey": "<juror-pubkey>",
  "content": "{\"disputeId\":\"<32-byte-hex>\",\"jurorIdx\":1,\"outcome\":\"NO\",\"salt\":\"<hex>\"}",
  "tags": [
    ["e", "<dispute-id>", "", "root"],
    ["dispute", "<32-byte-hex>"],
    ["juror", "1"],
    ["outcome", "NO"],
    ["salt", "<hex>"],
    ["alt", "₿AO Court vote reveal from juror 1"]
  ]
}
```

### Kind 39005: ₿AO Court FROST Commitment

Regular event publishing a juror's FROST signing nonce commitment.

```json
{
  "kind": 39005,
  "pubkey": "<juror-pubkey>",
  "content": "{\"disputeId\":\"<32-byte-hex>\",\"jurorIdx\":1,\"commitmentPackage\":{\"idx\":1,\"binder_pn\":\"<hex>\",\"hidden_pn\":\"<hex>\"}}",
  "tags": [
    ["e", "<dispute-id>", "", "root"],
    ["dispute", "<32-byte-hex>"],
    ["juror", "1"],
    ["binder_pn", "<hex>"],
    ["hidden_pn", "<hex>"],
    ["alt", "₿AO Court FROST signing commitment from juror 1"]
  ]
}
```

### Kind 39006: ₿AO Court FROST Reveal

Regular event revealing a juror's FROST partial signature.

```json
{
  "kind": 39006,
  "pubkey": "<juror-pubkey>",
  "content": "{\"disputeId\":\"<32-byte-hex>\",\"jurorIdx\":1,\"publicNonce\":{\"idx\":1,\"binder_pn\":\"<hex>\",\"hidden_pn\":\"<hex>\"},\"partialSig\":\"<hex>\"}",
  "tags": [
    ["e", "<dispute-id>", "", "root"],
    ["dispute", "<32-byte-hex>"],
    ["juror", "1"],
    ["nonce_binder", "<hex>"],
    ["nonce_hidden", "<hex>"],
    ["psig", "<hex>"],
    ["alt", "₿AO Court FROST signing reveal from juror 1"]
  ]
}
```

### Kind 39007: ₿AO Court Attestation

Regular event containing the final aggregated FROST dispute override attestation.

```json
{
  "kind": 39007,
  "pubkey": "<publisher-pubkey>",
  "content": "{\"marketId\":\"<market-d-tag>\",\"outcome\":\"NO\",\"message\":\"<sha256>\",\"disputeEventId\":\"<32-byte-hex>\"}",
  "tags": [
    ["e", "<market-event-id>", "", "root"],
    ["m", "<market-d-tag>"],
    ["p", "<group-x-only-pubkey>"],
    ["outcome", "NO"],
    ["nonce", "<64-byte-hex>"],
    ["sig", "<128-byte-hex>"],
    ["ver", "FROST-BIP340-v1"],
    ["dispute", "<32-byte-hex>"],
    ["alt", "₿AO Court FROST attestation: NO"]
  ]
}
```

### Client behavior

- **Disputes** are public UGC; anyone can query `{ kinds: [38025] }`.
- **Selection events** (kind 39002) are trust-sensitive. Clients SHOULD filter by a trusted coordinator pubkey or verify the selection deterministically from the published `seed` and `block` tags.
- **DKG commitments, votes, and FROST messages** SHOULD be filtered by the selected jurors' pubkeys to prevent spam.
- **Encrypted shares** between jurors are delivered as NIP-17 private messages (kind 14) wrapped in NIP-59 gift wraps (kind 1059).
- **Demo mode** runs the full Pedersen DKG and FROST signing locally, publishes the current user's real events, and simulates peer juror events internally for GUI completeness.
