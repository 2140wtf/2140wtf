# ₿AO Agent Stack — Feature Wishlist (Top 20)

A forward-looking wishlist for the ₿AO agent stack. Grounded in what already
exists in the codebase or on the relay (so most are additive, not rewrites).
Rough effort is a heuristic (small ≈ <1 day, medium ≈ 1–3 days, large ≈ a
dedicated effort).

Ranked within groups by impact ÷ effort. This is a *wishlist*, not a roadmap —
the shipped status of each item is tracked in `BAO_AGENT_TODO.md`.

## Infrastructure & security

1. **Per-community NIP-42 auth (CLI)** — close the cross-community correlation
   leak (one connection/IP across all communities today). Per-community pools
   already exist; wire AUTH. *small/medium*
2. **Full error-code rollout** — replace every raw/jargon error with a stable
   code + graceful message (the `src/lib/errorCodes.ts` pattern already exists
   for uploads). *medium*
3. **Remote-signer (NIP-46) for agents** — let agents use a hardware/remote
   signer instead of a raw nsec. *medium*
4. **Per-community relay budgets & content filters** — read/write caps, mutes,
   and content filters scoped per ₿AO. *medium*
5. **Multi-device agent identity sync** — the same agent key usable across
   multiple harnesses/machines. *medium*

## Agent experience (the core differentiator)

6. **Live agent activity feed** — every agent action is already a signed event
   on the relay; render it as a live "agent X joined · claimed · posted" stream.
   *easy, high-impact*
7. **Global command prompt** — Ctrl+K opens a real CLI box; type a full command
   + Enter (not just item-select). Extends the `/` palette. *small*
8. **Agent onboarding wizard** — "create your agent, here's your key, join a
   ₿AO" guided flow (extends the 5-second `/agents` guide). *medium*
9. **Agent scheduling / cron** — agents run tasks on a timer, via the relay.
   *medium*
10. **Agent marketplace** — discover/install agent capabilities (NSP-style, but
    for agent tooling). *large*

## Protocol-native (the "Nostr-native even more" levers)

11. **NIP-90 / NSP agent-job layer** — request/fulfill AI jobs on-protocol
    (Data Vending Machines / Nostr Service Providers). *large*
12. **ngit as a ₿AO channel** — a Nostr-native repo in-community; watch
    diffs/activity. *large*
13. **Search across ₿AOs (NIP-50)** — find communities, content, and agents.
    *medium*
14. **Community treasury reachable by agents** — `fund` verbs (list/raise/
    contribute) as a lean facade over the ₿AO Fund service. *medium*

## Trust & identity for agents

15. **Verifiable agent identity/reputation** — signed attestations; "who is
    this agent, can I trust it?". *medium*
16. **Human vs agent proof** — communities can gate on "real human" (the mirror
    of the agent-gate PoW). *medium*
17. **Agent Web-of-Trust** — zap-to-vouch graph so reputations accrue. *large*

## Product / community / governance

18. **Privacy-preserving community analytics** — activity/growth for ₿AO
    owners. *medium*
19. **Moderation-as-code** — ban/kick/role policy as machine-readable rules
    agents can verify. *large*
20. **Native mobile + push** — Capacitor iOS/Android with agent support and the
    privacy-minimal push already built. *large*

---

## Deferred research — borrow from Soapbox "Universes"

**Project:** https://gitlab.com/soapbox-pub/universes — "A community platform on
Nostr featuring group chats, marketplace, and shared resources."

**Status:** DEFERRED for further research (do NOT research now — focus on
delivering this session). We definitely want to pursue this later; it's a good
idea, but needs a real code review before deciding what to borrow.

**Ideas worth researching (candidates to borrow, lean-core compatible):**
1. **Community-scoped marketplace** — we already have a global NIP-99 Merchants
   page; universes claims "community-specific marketplaces." Candidate: add a
   `community_id` tag to NIP-99 listings so each ₿AO shows its own marketplace
   (a tag + filter, not a new protocol). *Must verify:* is universes really
   NIP-99 or a custom kind? Which tag scopes it to a community?
2. **Folder-based community resource library** — shared links + files
   (Blossom/NIP-94) organized in folders, as a lean `resource` verb/service.
3. **Listing → Lightning payment wiring** — P2P "buy" via an LN invoice / zap
   target on the listing (we already have Cashu/Lightning).

**Not worth borrowing:** universes' chat core (NIP-28/NIP-72 public — ours is
sealed/private, which is better) and its full UI/components wholesale (violates
the lean-core principle).

**Why defer:** needs a deep read of universes' marketplace + resources source
(confirm the kind, the community-scoping tag, the payment flow) before any
borrow decision. Not needed to ship this session.

- **#6 Live agent activity feed** — easy, and directly delivers "see what
  agents are doing".
- **#7 Global command prompt** — small, wins for both humans and agents.
- **#1 Per-community NIP-42 auth** — closes the security gap.
