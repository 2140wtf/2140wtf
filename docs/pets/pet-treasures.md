# Pet Treasures & Presence-Gated Secrets (research)

> Status: **design study, not implemented.** Captures the treasure-hunt
> extension of Pet Secrets and the GPS-spoofing analysis. Related:
> `docs/pets/pet-identity.md` (per-pet npubs).

## The problem

Pet Secrets v1 (kind 1125) supports an optional coarse `g` geohash "drop at my
location". But a geohash tag is just a claim — **anyone can tag any geohash
from their couch**, and GPS self-reports are trivially spoofed. For pure
secrets this is tolerable (a fake drop just means the secret is findable from
the wrong place), but the moment a location claim carries a *reward* —
treasure, items, sats — spoofing becomes an exploit, not a quirk.

Two external projects solve complementary halves of this.

## Prior art

### NIP-GC — Geocaching on Nostr ([treasures](https://gitlab.com/chad.curtis/treasures))

Already supported for display in 2140.wtf (kinds 37516 / 7516 are listed in
`NIP.md`). The pieces that matter for pets:

- **Kind 37516** geocache listing: `g` tags at multiple precisions, difficulty/
  terrain/size, `hint`, `mission` ("Key Quest" — a passphrase/riddle the
  finder must complete), and a **`verification` pubkey**.
- **Kind 7517** verification event: the cache's verification key must be
  obtainable **only at the location**. The finder produces a signature from it
  — a cryptographic proof of physical presence that cannot be forged remotely.
- **Kind 7516** found log, optionally embedding the kind 7517 proof.
- Type modifiers (`n` tags) already model `first-to-find` exclusive claims
  and `art` prize semantics.

### Wordsoul ([dreamith/Wordsoul](https://gitlab.com/dreamith/Wordsoul))

Binds a Nostr identity to a physical object: a spoken word plus a mark traced
on a 4×4 dot grid **deterministically derive the object's keypair**. Bearers
leave notes/letters encrypted for the next holder; handoff is offline and
in-person. The relevant insight for secrets: **knowledge only available at the
physical location derives the decryption key** — so only someone who actually
goes there can reveal the content. (License note: Wordsoul is AGPL-3.0 —
borrow the *mechanism*, reimplement the derivation, don't copy code.)

## The presence primitive: a written word, not a QR code

QR codes are impractical for hiding — nobody is pasting printed codes on
trees. The presence secret is a **passphrase the hider writes directly on the
spot** (marker on a wall, scratched on a stone, chalked under a bench). The
finder types the word they see. Two ways to use it:

1. **Decryption gating:** the treasure's secret content (or the shop-item
   claim payload) is symmetrically encrypted with a key derived from the
   passphrase (`HKDF(passphrase, cache-coordinate)`). No word, no reveal.
2. **Signing gating (NIP-GC compatible):** the passphrase *is* the
   verification key seed: `verificationPrivkey = HKDF(passphrase, cache-d-tag)`.
   The listing's `verification` tag carries the corresponding pubkey. The
   finder types the word → the client derives the key → signs a kind 7517 →
   verified found log (7516). Fully interoperable with NIP-GC verification.

**Honest security note:** a written word is low-entropy, and the listing's
`verification` pubkey is public — a motivated attacker can dictionary-attack
the phrase **remotely** and forge a find. Acceptable for low-stakes pet items,
and softened by hider guidance (use a multi-word phrase, not a dictionary
word) plus the `mission` tag (word + a riddle answerable only at the spot).
For higher-value treasures, the physical object being taken *is* the security
property — the log just records who got there first.

## Design: Pet Treasures

Reuse NIP-GC wholesale instead of inventing a parallel scheme — 2140.wtf
already renders kinds 37516/7516, so treasures get maps, found logs, and
curation lists (kind 37517, "hunts") for free.

- **A pet treasure** is a kind 37516 listing with a passphrase-derived
  `verification` keypair. The owner writes the passphrase at the spot. The
  listing references the hiding pet by `a` tag (`31124:<owner>:<d>`) alongside
  the standard tags.
- **The prize is a pet shop item**, not generic loot: the finder logs a
  verified find (kind 7516 + embedded 7517), and the client's shop layer
  credits the item to the finder's pet inventory. This ties the real-world
  hunt directly into the existing pets economy (food, toys, furniture) and
  gives owners a reason to walk their pets to real places.
- **First-to-find** `n` modifier models single-claim treasures; the `F` tag
  locks the winner.

## Design: presence-gated secrets

For secrets (words, not objects), apply the same presence primitive in either
of two flavors:

1. **Verification-key flavor (NIP-GC style):** the secret's NIP-44 ciphertext
   stays addressed to a pet, but the "reveal" requires a kind 7517-style
   signature from the passphrase-derived key written at the drop site. Cost:
   the hider must physically visit and write the word — fine for deliberate
   drops, heavy for casual ones.
2. **Derived-key flavor (Wordsoul style):** the secret is encrypted to a key
   derived from something only present at the location (a word on a sign, a
   drawn mark). No pet-addressing needed; whoever physically goes there can
   derive and read. Cost: the physical anchor must be durable and guessable
   only in person.

Both are compatible with kind 1125 as an extension (a `verification` tag or a
`gated` marker); neither is required for v1, where `g` remains a discovery
hint and nothing of value rides on location honesty.

## Spoofing risk summary

| Claim | Spoofable? | Mitigation |
|---|---|---|
| Secret tagged with a geohash (v1) | Yes, trivially | None needed — `g` is a hint, no reward attached |
| "I found a treasure" | Yes, without verification | Kind 7517 proof signed by the passphrase-derived key (word written on-site); brute-forceable in principle — keep stakes low |
| "I read the location secret" | Yes, unless gated | Derived-key or verification-key gating |
| Treasure physically present | No (it's *there*) | Physical presence is the security property |

## Secret modes (design space)

| Mode | Location | Reveal key | Status |
|---|---|---|---|
| **A — addressed** | none required | recipient owner's key (NIP-44) | shipped (`pets-secret`) |
| **B — public geo** | public on the map | word written at the spot | shipped (`pets-secret:geo`) |
| **C — private drop** | shared privately | word written at the spot | **analyzed, not built** |

### Mode C: private drops (plan first, don't code yet)

Idea: bury a word-gated secret like mode B, but DON'T advertise the location
publicly — deliver the location to one specific pet over NIP-17 DM. The word
stays physical (never sent), so presence is still enforced; only the invited
pet knows where to look. A secret spot for exactly one pet.

The identity wrinkle (flagged during design): NIP-17 DMs are signed and
encrypted by **owner** keys — so "pet-to-pet DM" is really owner-to-owner
with pets as the characters. True pet-to-pet encryption needs pet keys, and
deriving those from the owner nsec is rejected (breaks NIP-07/NIP-46 logins —
see `pet-identity.md`).

Resolution: **mode C doesn't need pet keys at all.** It composes existing
pieces: a mode-B geo secret event minus its public discoverability + a NIP-17
gift wrap carrying `{ geohash, refEventId }` (never the word). The pet is the
character, the owner is the courier — same mediation model as mode A, which
users already accept. Pet keys only become *necessary* when pets act
autonomously (agents), which is the bunker path in `pet-identity.md`.

Open design questions before building C:

- Where does the geo secret event live so non-invitees can't stumble on it?
  Options: publish without `g` tags (event exists but is unlocated; salt tag
  still gates decryption — invitee gets the location via DM), or keep the
  event off relays entirely and carry ciphertext inside the DM (simplest, but
  loses relay persistence / multi-device).
- UX: does the invite read like the pet whispering a treasure map? ("Follow
  me. Bring a marker home.")
- Revocation/reshare: an invitee can forward the location — acceptable?

## Suggested sequencing

1. Pet Secrets v1 (kind 1125) — shipped.
2. Location-gated geo secrets (kind 1125 `pets-secret:geo`, word-derived
   keys, map browse + reveal) — shipped. This validates the written-word
   presence primitive end to end.
3. Pet Treasures: hide flow (37516 + passphrase-derived verification key,
   owner writes the word on-site), find flow (enter the word → derive key →
   7517 → 7516 → shop-item credit).
4. Word-gating combined with pet-addressed secrets (a kind 1125 addressed
   secret that ALSO requires the word), if hunts prove the mechanics.
