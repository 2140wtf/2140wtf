# Podcast feeds research — podcasts tab for 2140wtf

Task #73. Researched 2026-07-29. Questions posed: the Fountain model, RSS?,
podcasts-only-not-music, podcasts on nostr. Builds on the NIP-F4 head start
in `AMETHYST_1.13_REVIEW.md` (borrow the protocol, not Amethyst's
claim-anchored discovery).

## 1. The Fountain model — what users will compare us to

Fountain is NOT nostr-native for content. Its stack:

- **Content: RSS.** The RSS feed is the source of truth for 4M+ shows.
  Fountain reads standard feeds extended with the Podcasting 2.0 namespace
  (`<podcast:value>`, `<podcast:chapters>`, `<podcast:transcript>`,
  `<podcast:person>`, `<podcast:guid>`, live-item tag).
- **Payments: Lightning V4V.** The `<podcast:value>` block in the feed
  declares Lightning recipients + splits (e.g. 45/45/10 host/cohost/guest,
  1–5% app fee). Listeners stream sats per minute, "boost" one-off payments,
  and send "boostagrams" (boost + public message shown on the episode page).
  No platform cut; settlement is direct.
- **Social: their own graph + nostr.** Followable listeners, clips, comments;
  Fountain's 2025 "Fountain for Podcasters" hosting pushes distribution over
  RSS + Lightning + Nostr.

Takeaway: the winning UX is **great podcast player first, nostr second**.
Nostr is the social/payment rail, not the catalog. Any podcasts tab that only
shows nostr-native shows will look empty next to Fountain's 4M-show catalog.

## 2. RSS? — yes, as the substrate; Podcast Index as the directory

- RSS + Podcasting 2.0 namespace is the universal substrate. Every serious
  host (Captivate, RSS.com, Blubrry, Fountain hosting) emits it.
- **Podcast Index** (podcastindex.org, Curry/Jones) is the free, open,
  donation-funded directory of those 4M+ feeds — the canonical iTunes-API
  replacement. REST API, free key, Amazon-style auth headers
  (`X-Auth-Key` / `X-Auth-Date` / SHA1 `Authorization`). Key endpoints:
  `/search/byterm`, `/podcasts/byfeedurl`, `/episodes/byguid`,
  `/charts/bycategory`. Returns `feedUrl` directly; we then fetch and parse
  the RSS ourselves (no per-episode search, thin transcripts — fine).
- `<podcast:guid>` gives a stable feed identity independent of feed URL —
  use it (fall back to feedUrl hash) when merging an RSS show with a
  nostr-native presence.

## 3. Podcasts only, not music — confirmed for v1

- NIP-F4 covers podcasts only. Music on nostr is a different ecosystem
  (Wavlake-style V4V track streaming, artist pages, albums/playlists) with
  different conventions and licensing norms.
- A merged "audio" tab would be a worse podcast app AND a worse music app.
  Ship podcasts only; revisit music if Wavlake interop demand appears.

## 4. Podcasts on nostr — NIP-F4 (draft)

Each podcast is its OWN keypair (shared ownership possible, e.g. MuSig2):

| kind  | what | notes |
|-------|------|-------|
| 10154 | show metadata (replaceable) | `title`/`image`/`description`/`website` tags, `p` author claims w/ role (host/cohost/editor); ignore kind:0 |
| 54    | episode (regular kind!) | `title`/`image`/`description`/`audio` (multi, w/ media type) tags; markdown show notes in content |
| 10064 | "podcasts I author" list | author's self-published claim; `p` tags = podcast pubkeys |
| 10054 | favorite podcasts (NIP-51) | a user's public listen list — soft recommendations |

**Authorship = bidirectional verification**: a show's `p` claim must be
counter-claimed by the author's own kind:10064. Never trust one side.

NOT in NIP-F4: RSS GUID linkage, V4V splits, zaps convention, discovery
guidance. Splits still live in the RSS `<podcast:value>` block (watch item
from the Amethyst review: honor them when the ecosystem lands a convention).

**Adoption reality:** NIP-F4 is a draft with thin real-world population.
Expect the broad relay query to return a handful of shows, not a catalog.
This is exactly why Amethyst's discovery feels like "1 account feed" — it
anchors on author claims (kind:10064) instead of querying broadly.

## 5. Discovery design for our tab (the actual fix)

Two sources, merged:

1. **Nostr-native (NIP-F4):** broad relay queries — `kinds: [10154]` and
   `kinds: [54]` across the app's full relay set (NOT claim-anchored).
   Verify authorship mutually (10154 `p` ↔ author 10064) before showing an
   "official by X" badge. Episodes are kind 54 by the show pubkey — cheap to
   page (`authors: [show]`, `kinds: [54]`, `until` pagination).
2. **RSS long tail:** Podcast Index search/charts → fetch feedUrl → parse
   RSS + Podcasting 2.0 tags locally. This is what makes the tab useful on
   day one.

Merge key: `<podcast:guid>` from the RSS feed vs. any future NIP-F4 guid
tag; until a linkage convention lands, treat them as separate entries and
prefer the nostr-native one only when the user follows the show's pubkey.

## 6. Proposed scope

**v1 (read-only, no custody — fits our constraint):**
- Podcasts tab: Podcast Index search + trending charts, NIP-F4 shows from
  broad relay queries surfaced as "on nostr" cards.
- Show page: episodes (RSS parse or kind 54), audio playback via plain
  `<audio>` (enclosure URL / `audio` tag).
- Zaps: NIP-57 to the show pubkey for NIP-F4 shows (author-verified only).
  RSS-show Lightning-address boosts = v2 (needs LNURL-pay flow).
- Follow a show: local list + (nostr shows) kind:10054 entry.

**v2 (watch items):**
- V4V streaming/boosts honoring `<podcast:value>` splits (pending ecosystem
  convention on nostr; RSS value block readable today).
- Boostagrams as kind-1 replies on kind-54 episodes.
- Cross-app comments (`podcast:socialInteract`) for RSS shows.
- Publishing tools for podcasters (own-keypair show creation) — only if
  creator demand shows up; NEVER mirror/publish on behalf of others
  (impersonation risk: kind-54 episodes must come from the show's own key).

## Sources

- NIP-F4 (draft): github.com/nostr-protocol/nips F4.md
- Fountain model: greycoder.com/fountain-a-podcast-and-music-app-with-lightning-payments/,
  adamcurry.substack.com/p/revolutionizing-media,
  9to5mac.com/2022/06/26/podcasting-2-0-the-lightning-network-and-value4value-usher-in-a-new-era-of-podcasting-thats-free-of-big-tech-control/
- Podcasting 2.0 tags: help.captivate.fm/en/article/podcasting-20-faqs-z0moaf/,
  blog.getalby.com/value-time-split-the-latest-innovation-in-podcasting-2-0/
- Podcast Index API: podcastindex-org.github.io/docs-api/
