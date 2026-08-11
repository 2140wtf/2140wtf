# ₿AO / Concord V2 privacy audit

Status: focused source audit, 2026-08-02. This is a design and implementation review, not a claim of formal security verification.

## Executive conclusion

Concord V2 does **not** currently publish a plaintext global “joined ₿AO” notification. Joins, leaves, kicks, roster snapshots, messages, mentions, typing authors, and work verbs are carried inside encrypted stream wraps. Generic Nostr notifications cannot inspect those inner events, and the planned native Concord notification bridge is currently inert.

That does not make membership activity invisible. The current implementation exposes several avoidable identity, timing, routing, analytics, and local-storage signals. A private ₿AO must therefore promise content confidentiality only until the issues below are resolved; it must not promise anonymous membership, invisible presence, or immediate cryptographic removal.

## Observer model

| Observer | What is currently visible |
| --- | --- |
| Public relay/indexer | Stable encrypted stream authors and traffic timing/size; public invite-bundle lifecycle; identity-authored encrypted vault kinds; direct-invite recipient and type; public kind-0 profiles |
| Community/inbox relay | The above plus IP/session timing, stream-key possession clusters from NIP-42 AUTH, and direct-invite recipient polling/delivery |
| Current member | Decrypted roster, join/leave/kick history, real inner authors, messages, mentions, work activity, typing, roles, and invite audit data for held keys |
| Removed or departed member | All retained history and keys; future activity too until a successful rekey excludes those keys |
| Local device/operator | Decrypted IndexedDB caches, invite data, community identifiers, roots, notification settings, and CLI/MCP state and logs |

## Prioritized findings

### P0 — stop leaking private route identifiers to analytics

The global Plausible integration automatically observes page URLs, while Concord routes contain stable community/channel ids and invite coordinates (`src/components/PlausibleProvider.tsx`, `src/AppRouter.tsx`). This can reveal private-room navigation and invite interest to the analytics operator.

Required change: use explicit sanitized pageviews or exclude all private/invite routes. Never send raw community ids, channel ids, naddrs, pubkeys, query strings, fragments, or referrers. Add a regression test at the analytics boundary.

### P0 — remove identity-authored Concord usage markers in strict privacy mode

Community and invite vaults are encrypted, but kinds 13302 and 13303 are signed by the user's real npub and published through the ordinary pool (`src/concord-v2/hooks/useCommunityList2.ts`, `src/concord-v2/hooks/useInvites2.ts`). Relays can observe that an identity uses Concord and correlate update timing and ciphertext size with joins, departures, or rekeys.

Required change: design a separate vault storage identity or make relay vault sync opt-in with private relays. Isolate transport, batch/jitter writes, and pad ciphertext into coarse size buckets. Continue reading the legacy kinds during migration.

### P0 — define removal honestly and require rekey completion

A leave or honest-client ban removal is not cryptographic exclusion. A former member can keep reading with copied keys until a successful refound/rekey; old history can never be revoked. Some moderation paths explicitly finish without rekey (`src/concord-v2/hooks/useModeration2.ts`, `useBanSelfRemove2.ts`, `useCommunityActions2.ts`).

Required change: distinguish `policy-muted`, `removal pending rekey`, and `cryptographically excluded`. Private communities must warn or block when exclusion cannot rotate keys, and show a completion receipt before claiming access has ended. Test using a modified client that ignores the banlist.

### P1 — stop public-profile publication as a join prerequisite

Web and agent onboarding can publish kind 0 immediately before or around an encrypted join (`src/concord-v2/pages/InviteV2Page.tsx`, `components/AgentJoinPanel.tsx`, `scripts/bao-agent.ts`, `scripts/chat-core.ts`). Shared relays and timing can correlate the public identity with the private stream.

Required change: support an encrypted community-scoped display name. Make global profile publication a separate, optional, clearly disclosed action; never send it to community relays as part of joining.

### P1 — make direct-invite metadata an explicit tradeoff

Direct invites place the recipient's real pubkey and the Concord invite classifier in relay-visible outer tags (`src/concord-v2/lib/directInvite.ts`). This reveals that a known npub received a Concord invite, although not its community or inviter.

Required change: label direct-npub invitations as privacy-weaker. Remove the outer `k=3313` classifier if bounded generic inbox scanning is acceptable, and investigate blinded rendezvous mailboxes or privacy relays. High-privacy communities should default to short-lived capability links or another unlinkable handoff.

### P1 — constrain relay and AUTH correlation

New communities default to a broad union that includes public feed and stock relays (`src/concord-v2/hooks/useCommunityActions2.ts`). Concord transport authenticates multiple held stream keys on a session, allowing a relay to build a key-possession and epoch graph (`src/concord-v2/lib/concordTransport.ts`).

Required change: default private communities to an intentionally chosen minimal relay set. Isolate sockets at least per community and preferably per plane/channel, avoid authenticating historical keys until backfill, and offer private relay/proxy modes. Add an instrumented-relay observer test.

### P1 — generic notifications by default

Foreground notifications locally display sender and decrypted content previews. A future native subscription design would carry room names, identifiers, stream addresses, and conversation keys, although it is not currently registered (`src/hooks/useForegroundNotifications.tsx`, `src/concord-v2/lib/concordNotifications2.ts`).

Required change: default to “New encrypted community activity.” Sender, room, task, and content previews must be separate opt-ins. Do not activate native background support before protected storage, lock-screen policy, removal cleanup, key zeroization, and backup behavior are reviewed.

### P1 — minimize decrypted local retention

Decrypted rumors, membership motion, invites, roots, notification scopes, and agent state persist locally, often until final logout (`src/concord-v2/lib/rumorStore.ts`, `inviteInbox.ts`, `purgeConcordStorage.ts`, `scripts/chat-core.ts`, `scripts/bao-chat-mcp.ts`). Decline, leave, or ban does not reliably purge per-community data.

Required change: provide session/TTL/retained modes, per-community deletion, confirmed purge across tabs, and an explicit retain-history choice. Redact MCP audit arguments and rotate logs. Prefer OS-protected secret storage for native/headless use.

### P2 — reduce member-visible presence and recruitment graphs

Every key holder can see the roster, membership motion, observed-author presence, invite provenance, and typing activity. These are encrypted from outsiders but are still privacy-sensitive inside a community.

Required change: separate authorization from roster visibility; support hidden or role-limited membership, community-scoped pseudonyms, admin-only invite provenance, and disabled-by-default typing for high-privacy communities. Never project this information into Project Passport, discovery, reputation, or public work evidence.

### P2 — make invite preview network access consensual

Invite pages and embeds resolve bundles before acceptance, revealing view timing to bootstrap relays. Capability URLs can also leak through history, screenshots, extensions, logs, or clipboard systems even though fragments are not sent in ordinary HTTP requests.

Required change: require a click to load private previews in privacy mode, scrub the fragment from visible history after parsing, set `Referrer-Policy: no-referrer`, never log `location.href`, and explain that the URL is a bearer capability.

## Verified protections to preserve

- Ordinary joins, leaves, roster events, messages, mentions, task verbs, and typing authors are not plaintext public events.
- Outer stream `p` tags are random and do not expose mentioned users or members.
- Trust-sensitive stream access is kept out of the shared application pool and foreign-author queries/publications are rejected.
- Invite previews use an ephemeral relay identity rather than the logged-in identity.
- Direct-invite outer authors are single-use and the transport is closed after delivery.
- A completed rekey provides forward exclusion from new epochs, while correctly not pretending to erase history.
- Generic push/native notification infrastructure does not currently receive Concord payloads.

## Privacy release gates

No Project Passport, reputation, or public evidence feature may consume Guestbook, community-list, invite, roster, presence, notification, typing, or private-channel data.

Before claiming “private membership”:

1. raw private route analytics is eliminated;
2. strict privacy mode emits no identity-authored Concord-specific vault event;
3. joining emits no identity event to community relays;
4. relay-observer fixtures document every outer event, REQ, AUTH, timing, and size signal;
5. removal language is tied to verified rekey completion;
6. local retention and purge controls are testable;
7. native notifications remain disabled or pass a separate privacy/security review;
8. protocol and UI documentation use the observer model above rather than “encrypted means invisible.”

## Recommended implementation order

Apply one small, reversible change per reviewed slice. Do not combine protocol redesign, storage migration, relay changes, notification work, and UI changes in one release. Each slice needs a narrow observer-based regression test, the full existing test suite, a documented rollback, and its own local commit before the next slice begins.

1. Sanitize/disable analytics on private and invite routes only.
2. Make join-time public-profile publication optional without redesigning identity.
3. Correct removal wording/state presentation before changing the rekey protocol.
4. Add a manual per-community purge before introducing retention or storage encryption.
5. Prototype and review vault/relay changes separately; do not migrate stored keys in the first privacy patch.
6. Evaluate direct invites, transport isolation, previews, roster visibility, and notifications as independent changes.
7. Run an independent relay-observer and compromised-client review before enabling any new public work projection.
