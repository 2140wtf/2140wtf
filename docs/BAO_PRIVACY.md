# ₿AO community privacy model & hardening guide

What a relay hosting a Concord V2 (₿AO) community can and cannot see, and
what operators and users can do about the residual leaks.

## What relays CANNOT see (by design)

Everything meaningful is encrypted before it leaves the client:

- **Messages** — kind-1059 wraps signed by derived stream keys (not member
  keys), one random ephemeral `p`-tag per wrap, encrypted content. No member
  npubs, no community name, no channel tags, no plaintext.
- **Control plane** — community name, description, relay list, member roster,
  grants, and channel definitions are sealed editions: ciphertext at rest.

## What leaks today

1. **Traffic shape** — timing, volume, and byte size of a community's
   encrypted traffic on each relay it uses. This is the primary leak.
2. **Direct-invite handoffs** — a direct (owner-vetted) invite gift-wraps to
   the invitee and `p`-tags their real pubkey once. Anonymous invite-link
   joins have no such tag. (The UI now says this at the decision point.)
3. **Client query patterns** — members' clients REQ the relay for the
   community's streams, so the operator learns which IPs care about which
   stream pubkeys.
4. **Censorship** — a relay can drop or refuse the community. Availability
   risk, not confidentiality.

## Mitigations

### For community owners

- **Sensitive community → one relay you control.** Every additional relay is
  another observer of traffic shape. The create dialog pre-selects the full
  feed relay set for reach; pare it down for private work.
- **Prefer invite links over direct invites** when member anonymity matters —
  link joins are anonymous; direct invites p-tag the invitee.
- **Auth-gated reads** — host the community on a relay that requires NIP-42
  auth for reads, so strangers can't even fetch the ciphertext.

### For relay operators (relay.bao.network)

Status: strfry with a **write-policy** kind allowlist (see
`infra/relay-write-policy/` in bao.markets) — only kinds our own software
produces are accepted. Reads are unrestricted.

Hardening options for read auth on community kinds (1059/21059, Concord
control kinds):

1. **Authed companion relay** (recommended) — run a second strfry with
   NIP-42 `authRequired` for sensitive communities; communities opt in by
   choosing it as their only relay. Clients already do NIP-42 auth for
   write; read-auth reuses the same handshake.
2. **Auth proxy in front of strfry** — a thin WebSocket proxy that requires
   NIP-42 before forwarding REQs for the community kinds, passing everything
   else through. More moving parts than a second relay.
3. **Do nothing** for the public ₿AO relay — ciphertext-only traffic is the
   designed threat model; read auth is only for communities that need
   traffic-shape privacy too.

### Client-side (already done)

- Queries across communities are batched into one REQ per relay, which mixes
  traffic between communities.
- The create dialog and invite dialog spell out the leak model so users can
  make informed choices instead of discovering them later.
