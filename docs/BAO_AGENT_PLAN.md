# ₿AO Agent Stack — Development Plan

The roadmap for unifying and extending the ₿AO agent stack. Living document —
updated as work lands.

## North star

**2140.wtf is a Nostr client that glues everything together — without becoming
heavy.** One product, one identity layer (Nostr), one data plane (relays). But
"glue" does **not** mean "embed": heavy capabilities live OUTSIDE as separate
Nostr-native services that talk to each other over the protocol, and the client
reaches them rather than reimplementing them.

> **Lean-core principle:** 2140.wtf is a lean orchestrator. The ₿AO community
> (Concord V2) is the sealed core; everything else — ₿AO Fund, markets, ngit
> code, NSP/AI providers — is a pluggable Nostr-native service the client and
> engine **discover and talk to** (well-known kinds, NIP-31999-style discovery),
> not a feature the client embeds. Keeping the core thin is what lets the
> platform grow without bloating the client.

The ₿AO is therefore a **unified platform whose capabilities hang off the same
sealed protocol** and interoperate:

- **₿AO community** (Concord V2) — encrypted chat, channels, moderation. *(core)*
- **₿AO Fund** — crowdfunding campaigns on the community (`fund_id` in metadata,
  founder import; see `docs/BAO_FUND.md`). *(external Nostr-native service)*
- **Markets** — prediction markets, polls, media, pets, events. *(external)*
- **Agents + AI** — the command engine; NSPs/Shakespeare for inference.
  *(engine = the glue facade)*

Goals:

1. **One command engine** for every surface (CLI, `window.bao`, `/` palette).
2. **No plaintext into channels** — every publish path is sealed (NIP-44 + wrap).
3. **Nostr-native AI** — the engine talks to NSPs (NIP-31999 + NIP-44 +
   Lightning), with Shakespeare as the built-in harness brain.
4. **Code in the community** — ngit as a ₿AO channel (external service, not
   embedded) so agents work on code inside the ₿AO.
5. **Live agent visibility** — see what each agent is doing in real time.
6. **The engine reaches Fund/markets as commands** — a facade over external
   services, keeping the client lean.

## Phase 1 — Unified engine (in progress)

The transport-agnostic engine ends the CLI-vs-terminal duplication.

```
              BaoEngine (src/concord-v2/lib/baoEngine.ts)
        all verbs implemented ONCE — create/invite/join/say/read/whoami
        identities/use/remove/logout/admin/ban/kick/channel/meta/members/
        dissolve/help — depends only on two seams + the control-plane libs
                        │
          ┌─────────────┴─────────────┐
   BaoRelay + BaoStore           BaoRelay + BaoStore
   Node adapter                   Browser adapter
   (SimplePool + fs)              (Nostrify pool + localStorage)
        │                                │
   scripts/bao-agent.ts            baoTermDispatch.ts → window.bao
   (CLI + REPL)                    Terminal.tsx + / palette
```

- `BaoRelay` — query/publish. Node: per-community SimplePool (`scripts/baoAdapter.ts`).
  Browser: the app's Nostrify pool (`baoTermDispatch.ts`).
- `BaoStore` — identity CRUD + active selector. Node: `~/.concord-live/` files.
  Browser: localStorage (`baoTermStore.ts`).
- `commands.ts` — the registry: single source of truth for help, `/` palette,
  and AGENTS.md.

Status (2026-08):
- ✅ Engine + core interfaces.
- ✅ Browser adapter wired (in-page terminal is a thin engine adapter).
- ✅ Node adapter wired (CLI's admin/moderation/members/dissolve/identity verbs
  route through the engine; per-community pool isolation).
- ✅ Global `/` palette (app-wide, not just inside a ₿AO).
- ⏳ Migrate the core chat verbs (create/invite/join/say/read) off chat-core
  onto the engine (they're richer/coupled to MCP+paradise; do a regression-safe
  pass).
- ⏳ CLI NIP-42 per-community AUTH for the chat paths (extend the pool
  isolation so relays see one authenticated session per community).

## Phase 2 — Security hardening

- ⏳ **Mandatory encrypted channels**: enforce + audit so no path emits
  plaintext into a ₿AO channel. Note: compute-credit work verbs (4971/4972/4973)
  are **public-by-design** (funder discovery) and must NOT be encrypted — that
  would break the matching protocol. A future *hidden private fundraiser* is a
  separate, deliberately-sealed protocol.
- ⏳ **CLI NIP-42 AUTH + per-community session isolation** — close the
  cross-community correlation leak (single SimplePool/IP across communities).

## Phase 3 — Nostr-native AI (NSP + Shakespeare)

- ⏳ **NSP integration**: the engine's harness discovers NSPs (NIP-31999),
  talks NIP-44, pays via Lightning — `think`-via-NSP. Anyone can run their own
  NSP; a ₿AO can self-host its NSP on a VPS.
- ⏳ **Shakespeare** as the built-in harness AI backend (coexist with Routstr
  `think` + NSP). Open source, donation-funded, same team as Ditto/Armada/Nostrify.

## Phase 4 — Hermes adapter (optional, future)

- ⏳ Hermes = a more advanced, widely-adopted harness (OpenRouter-literate),
  **outside bao**, added as an optional adapter via the engine seam. Keep both
  NSP (native/open) and Hermes (reach) working together.

## Phase 5 — Code in the community

- ⏳ **ngit-as-channel**: a Nostr-native git repo as a ₿AO channel, so AI agents
  work on code inside the community (not GitHub). Complements the existing
  founder fundraise-import (`fund_id` in community metadata).
- ⏳ **Live agent terminal visibility**: show what each agent is doing in real
  time (design needed).

## Phase 5b — Fund / markets as reached (not embedded) capabilities

Heavy capabilities stay OUTSIDE as Nostr-native services; the engine is a lean
facade that reaches them over the protocol. Nothing heavy is bundled into the
client.

- ⏳ `fund` verbs — a facade over the ₿AO Fund service: list/raise campaigns,
  see the community treasury, contribute. The heavy logic stays in the service.
- ⏳ `market` verbs — a facade over the markets service: browse/create prediction
  markets.
- ⏳ Verify fund/market events are reachable through the engine (sealed where
  community-private, public-by-design where they must be discovered), with the
  service logic external.

## Phase 6 — Other session items + ship

- ⏳ Dead-relay cleanup follow-through (ditto/nostr.band/vectorapp still in some
  lists).
- ⏳ Images in chat via Blossom (`useUploadFile` + NIP-94 imeta).
- ⏳ Privacy-minimal push notifications (mention/new-message alerts with minimal
  metadata).
- ⏳ Merge `session/opencode-work-20260805` → `main` + CI.

## Infrastructure vision (VPS / self-hosted ₿AO node)

```
Self-hosted ₿AO node (VPS) — optional, opt-in, NOT a required central server
   ├── Hermes harness   = the brain — runs AI agents (LLM loops)   [optional]
   ├── bao engine/CLI   = the hands — agents call it to act in ₿AOs
   └── relay            = the network — the community's data plane
```
Nostr-native equivalent: run a self-hosted **NSP** instead of (or alongside)
Hermes, so AI services are served over the same relays. A VPS is a deployment
option for a community that wants to control its own node — it does not
reintroduce a central authority.

## Conventions

- All verbs live once in the engine; surfaces are thin adapters.
- The registry (`commands.ts`) is the single source of truth for help/palette/docs.
- Everything is sealed (NIP-44) unless the protocol is public-by-design (work,
  orchestration manifests, markets).
- Tracking: `docs/BAO_AGENT_TODO.md`.

## How agents operate (architecture notes)

**Static site on GitHub Pages, relays as the API.** 2140.wtf has no server and no
REST API. GitHub serves static JS; the "API" is the Nostr relay set. A command
builds + signs a Nostr event client-side and publishes it over WebSocket to the
relays; other clients/agents read the same events back. Identity = the key.

**Agents do not need to visit the website.** The engine, CLI (`bao-agent`), and
`window.bao` all talk to relays directly. The invite link is self-contained (the
`#fragment` carries the bootstrap relays + token), so an agent parses the link
string and goes straight to the relays — the web page is only a human/browser UX,
never a requirement.

**Operating inside a ₿AO** — three auth layers:
1. **Identity auth** — every event is signed with the agent's key; npub = identity.
2. **Membership auth** — the agent joined via the guestbook; only members hold
   the seal keys to read/post the (NIP-44-sealed) content.
3. **Relay/session auth (NIP-42, optional)** — relays may challenge the
   connection; the agent signs the AUTH response. Per-community session
   isolation is the open CLI item.

**Invite-link processing (agent-side):** parse the URL → decode the naddr
(link-signer pubkey) + fragment (token + bootstrap relays) → fetch the kind-33301
bundle from the relays → pick the newest (or reject a revocation tombstone) →
NIP-44-decrypt with `inviteBundleKey(token)` → verify the self-certifying
`community_id` → single-use check against the guestbook → grind agent-gate PoW if
gated → seal + publish the join → save the identity. All client-side, no server.

## Innovation split (inherited vs ours)

| | Inherited (Concord / Armada / Buzz / Ditto) | Ours (2140.wtf) |
|---|---|---|
| Crypto / protocol | sealed gift-wraps, NIP-44, invite bundles, guestbook, control plane, refound, invite codec | — |
| Agent layer | — | **one transport-agnostic engine** + `bao-agent` CLI + `window.bao` + `/` palette + `/agents` onboarding |
| Product | base app stack (Ditto fork) | ₿AO markets, fund, pets, WoT filter, earning (Routstr/Cashu), NIP-85 stats |
| Orchestration | — | orch claims, agent-gate PoW, single-use sweeps |

So our innovation is **not "the CLI"** — it is the **agent operating layer**: making a
serverless, sealed protocol operable by AI agents, with the CLI as its headless
face and `window.bao`/`/` palette as the in-browser surfaces.
