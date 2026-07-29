# Amethyst 1.13.x review — borrow assessment for 2140wtf

Reviewed 2026-07-29 against v1.13.0 (user-pasted changelog) + v1.13.1 (released today).
Verdicts are for 2140wtf mainnet-readiness, not general merit.

## Borrow

### 1. Podcasts via NIP-F4 (v1.12.0 #3093/#3105) — borrow the PROTOCOL, not the UX
NIP-F4: each podcast is its own keypair; `kind:10154` (replaceable) = show metadata
(title/image/description + `p` author claims), `kind:54` = episodes (title/image/`audio`
tags, show notes in content), `kind:10064` = an author's self-published "podcasts I author"
list. Author verification = mutual counter-claim: show's `p` tag must match an entry in the
author's own kind:10064. V4V splits are NOT in NIP-F4 (comes from elsewhere; Podcasting 2.0
RSS still carries them).
- Why Amethyst "shows only 1 account feed" (user report): discovery anchored on author
  claims (kind:10064) shows only podcasts claimed by accounts in view. Our podcasts tab
  should query kind:10154/kind:54 broadly (relay-wide, #t tags) AND keep an RSS/Podcast
  Index fallback for shows that never claim authorship on nostr. (Task #73.)
- Fits our constraint: read-only display, no custody.

### 2. Nutzap inbox routing fix (v1.13.0) — verify ours, borrow if missing
Amethyst fixed nutzap delivery to publish to the relays in the RECIPIENT's kind:10019
(their inbox), not the sender's relays. Our send path needs the same: parse recipient
10019 (we have the parser, cashuNip60.ts:554), publish the 9321 to its `relay` tags.
Action: verify CashuZapContent/useZaps nutzap send does this; fix if it publishes to
APP_RELAYS only.

### 3. CORD-02 §9 community dissolution seal (v1.13.1 #3767) — borrow into Concord V2
Our ₿AO chat is a Concord V2 port; Armada/Amethyst now seal community dissolution.
Without it, our clients keep dead communities alive while interop peers consider them
gone. Port to 2140wtf concord-v2 AND bao_fund (manual port rule).

## Skip

- NIP-60 CLI wallet / auto-save on mint add-remove (v1.13.0 #3333/#3380) — our
  cashuNip60 already persists on every mutation.
- NIP-29 group relay AUTH (v1.13.1 #3788) — we don't run NIP-29 groups.
- BUD-01 Blossom read-auth retry (v1.13.1 #3789) — we don't gate blobs.
- kind-9008 group/channel delete (v1.13.1 #3779) — NIP-29-shaped; our control plane
  (3302–3313) already covers admin lifecycle; revisit only if interop demands it.
- BOLT12 zaps NIP-B1 (9736/9737/10058) — no BOLT12 infra on our rails yet; monitor.
- NIP-13 PoW — would hurt mobile UX; our relay write-policy is the anti-garbage lever.
- In-app browser / NIP-5D napplets / NIP-5A nsites / BitChat geo / Git NIP-34 — out of
  scope for mainnet readiness.

## Watch (not actionable yet)

- Podcasting 2.0 V4V splits: NIP-F4 doesn't cover them; when the ecosystem lands a split
  convention, zapping episodes should honor it.
- WoT GrapeRank (v1.13.0): we have our own WoT scoring; compare rankings later if our
  feed quality diverges.
