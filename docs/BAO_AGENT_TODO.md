# ₿AO Agent Stack — Living TODO Tracker

Living tracking document. Check off items as they land; add new work here so
nothing is lost. Keep in sync with `docs/BAO_AGENT_PLAN.md`.

Legend: ✅ done · ⏳ pending · 🔵 in progress · 🧊 future/design

## URGENT — performance (add to top when active)

- [✅] Feed ~30-60s → **fixed**: the All/global feed now runs immediately (the
  `enabled: followsReady` gate was blanking it until follow+love lists resolved)
  and refetches once the lists arrive. Content shows instantly; follow/love lists
  enrich in the background. Also tightened query timeouts (10s→4s) so a slow
  relay can't stack. Verified: content at ~1-3s in the test browser.
- [🔵] Markets page — progressive loading added (real listings render as soon
  as any arrive, no full-load gate). Verify it feels instant.
- [✅] Removed broken read relay `nostr.swiss-enigma.ch` (CERT error) from
  `APP_RELAYS`.
- [✅] New users show "Anonymous" on front page / bottom of menu — fixed in
  `LeftSidebar` (now `Anon-<last5 of npub>`). Audit other non-chat surfaces.
- [✅] Follow list showing a stale/short copy — fixed in `useProfileData`
  (picks the newest kind 3, not the first relay's copy).

## Security (highest priority)

- [🔵] Global `/` palette execution — selecting a command actually runs it
  (no-arg runs; arg commands fill the input; input runs on Enter).
- [🔵] `logout` command — clear active identity (keys stay saved).
- [⏳] Mandatory encrypted channels: enforce + audit so no path emits plaintext
  into a ₿AO channel. (Compute-credit work verbs are public-by-design and must
  NOT be wrapped.)
- [⏳] CLI NIP-42 per-community AUTH + session isolation (close the
  cross-community SimplePool correlation leak).
- [⏳] Future: hidden private fundraiser via Cashu inside ₿AOs (deliberately
  sealed, separate protocol).

## Unified engine merge

- [✅] `baoCore.ts` — canonical identity + BaoRelay/BaoStore interfaces.
- [✅] `baoEngine.ts` — transport-agnostic engine, all verbs once.
- [✅] Browser adapter — `baoTermDispatch` is a thin engine adapter; `baoTermStore`
  exposes a BaoStore.
- [✅] Node adapter — `scripts/baoAdapter.ts` (fs store + per-community
  SimplePool); CLI routes ALL verbs (create/invite/join/say/read/admin/moderation/
  members/dissolve/identities/use/remove/login/logout/help) through the engine.
- [✅] Core chat verbs migrated — CLI create/invite/join/say/read now dispatch
  through the engine; ~460 lines of dead CLI-side verb logic removed.
- [✅] Global `/` palette app-wide (select + Enter executes).
- [✅] `login` verb (register/activate a key-only identity that join/create upgrade).

## CLI NIP-42 per-community AUTH
- [⏳] Per-community pools exist (baoAdapter); add NIP-42 AUTH so relays see one
  authenticated session per community. Needs careful live testing.

## Nostr-native AI

- [⏳] NSP integration: engine harness discovers NSPs (NIP-31999), talks NIP-44,
  pays via Lightning; `think`-via-NSP.
- [⏳] Shakespeare as the built-in harness AI backend (coexist with Routstr
  `think` + NSP).
- [⏳] Hermes adapter (optional, future): OpenRouter-literate harness, outside
  bao, additive via the engine seam.

## Community / code

- [🧊] ngit-as-channel: Nostr-native git repo as a ₿AO channel so agents work on
  code in-community.
- [🧊] Live agent terminal visibility: see what each agent is doing in real time.
- [⏳] Founder fundraise-import already works via `fund_id` in metadata — verify
  and document.

## Fund / markets as reached (not embedded) capabilities

**Lean-core principle:** 2140.wtf is a lean client that glues Nostr-native
services together — it does NOT embed heavy features. Fund, markets, ngit, and
NSP/AI stay outside as services the engine reaches over the protocol.

- [⏳] `fund` verbs — a lean facade over the ₿AO Fund service (list/raise,
  treasury, contribute); heavy logic stays in the service.
- [⏳] `market` verbs — a lean facade over the markets service.
- [⏳] Verify fund/market events are engine-reachable (sealed where private,
  public-by-design where discovered), service logic external.

## Other session items

- [⏳] Dead-relay cleanup follow-through: relay.ditto.pub, relay.nostr.band,
  asia.vectorapp.io still in APP_SEARCH_RELAYS / stock dictionary / some hook
  lists (damus already removed).
- [⏳] Images in chat via Blossom (`useUploadFile` + NIP-94 imeta) — currently
  "Failed to send" / no Blossom server configured.
  - **Privacy verified:** in the ₿AO chat (`encryptAttachments`), the blob is
    encrypted client-side (AES-256-GCM) before upload; key/nonce ride in the
    sealed message imeta. Blossom and anyone with the URL see only ciphertext —
    only channel members can decrypt. Voice + images already work in Buzz/Armada
    (same Nostrify stack), so this is a reachability/config issue, not
    architecture.
  - **Likely cause of "Upload failed":** default servers
    `[blossom.ditto.pub, blossom.dreamith.to, blossom.primal.net]`; `ditto` is
    dead. Need a live test to confirm which server(s) fail and swap to reachable
    ones (e.g. drop `blossom.ditto.pub`).
- [⏳] Privacy-minimal push notifications (mention/new-message alerts, minimal
  metadata).

## Release

- [✅] Merged `session/opencode-work-20260805` → `main` (fast-forward, all tests
  green). Commits continue on `main`. **NOT pushed** — per instruction, do not
  push to main; deploy is on hold.
- [⏳] Deploy / push `main` when approved (deferred).

## Deferred / later

- [🧊] Review `soapbox-pub/universes` (community platform: group chats,
  marketplace, shared resources) for borrowable patterns — **deferred to a later
  day** (lean-core compatible only; marketplace/NIP-99, community patterns).
- [⏸️] Shakespeare harness backend — **skipped for now** (per instruction).
  OpenRouter backend (`think --openrouter`) added instead.

## Log

- 2026-08-05: unified engine (core + browser + node adapters) committed; global
  `/` palette added; `dissolve` verb added; `logout` added; docs created.
- 2026-08-05: sidebar menu shows `Anon-<npub>` (not "Anonymous"); `/` palette +
  `/agents` select-then-Enter executes; terminal recognizes the logged-in app
  user; markets progressive loading; removed broken `nostr.swiss-enigma.ch`.
- 2026-08-05: docs reflect lean-core principle (glue, don't bloat — heavy
  capabilities stay external Nostr-native services).
