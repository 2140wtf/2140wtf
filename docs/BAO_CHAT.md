# ₿AO Chat (Concord V2 communities)

₿AO chat is the Concord V2 communities surface (`/bao/chat`): encrypted,
relay-per-community group workspaces with roles, invites, threads, and
moderation. Entry points: `src/pages/BaoCommunitiesPage.tsx` (community rail)
and `src/concord-v2/pages/ConcordV2Page.tsx` (the workspace).

## Web-of-trust agent filter

Each community workspace can filter its roster and timeline by the viewer's
web of trust, so agent/bot spam can't flood a channel.

**How agents are identified.** Concord V2 has no explicit bot marker on its
roster (roles are owner/admin/moderator plus custom permission roles; the
Buzz `bot` role and the NIP-24 `bot: true` profile flag exist but neither is
part of the Concord roster). The filter therefore applies to **all
non-exempt members** and is surfaced in the UI as an "agent filter" — agents
are who it catches in practice. Exempt (never filtered):

- the viewer (the WoT anchor, distance 0),
- community-role holders: owner, admins, moderators — they are already
  vouched for by the community's own trust structure, and moderators must
  always see each other.

**Model.** Scores come from `src/lib/wot.ts` via `useWot(memberPubkeys)`
(`src/hooks/useWot.ts`): a depth-2 BFS over kind-3 contact lists anchored at
the current user, yielding `{ score, distance, followersWithin }` per member.
A member is filtered when `distance === null || distance > maxDistance`
(default `maxDistance` = 2, `DEFAULT_WOT_AGENT_MAX_DISTANCE`). The pure
decision logic lives in `src/lib/wotFilter.ts` (`partitionMembersByWot`,
`isOutsideWot`, `wotBadge`/`wotBadgeLabel` for the trust dots) with unit
tests in `src/lib/wotFilter.test.ts`.

**Fail-open guarantees.** Nobody is hidden while scores are still loading
(zero scores from a not-yet-loaded graph are indistinguishable from
"unreachable"), nor when the anchor has no kind-3 contact list at all (an
empty graph can't tell friends from spam). Members with no score entry stay
visible. The filter only bites once a non-empty follow graph has resolved.

**UX.**

- *Trust dots* (`src/components/chat/MemberList.tsx`): every visible member
  row gets a small fixed-size dot — green = you follow them (1 hop),
  primary = in your web of trust (2 hops), amber = outside but vouched by N
  in your network, muted = outside your web of trust. No dot while loading
  or for the viewer's own row; details are in the native tooltip.
- *Toggle*: "Filter agents by web of trust" switch at the top of the member
  panel, persisted per community.
- *Roster*: filtered members collapse behind an expandable
  "N filtered agents" row at the bottom of the member list.
- *Timeline*: messages from filtered pubkeys are hidden from the channel
  timeline. The choke point is `ConcordV2Page`: it passes
  `MessageTimeline` a copy of the chat transport with `messages` filtered,
  so the shared `MessageTimeline` component and the wire engine are
  untouched. Thread panels and reply context keep the full message set.

**Storage.** The toggle persists in the app config as
`wotAgentFilterByCommunity: Record<string, boolean>`, keyed by
`c2:${communityIdHex}` (the same scope-key shape as `mutedCommunities` /
`notifLevels`), via `AppContext.updateConfig` — the lightest existing
per-community pattern (`lastChannelByServer` works the same way). Schema:
`RuntimeAppConfigSchema` in `src/lib/schemas.ts`.

## Pet bodies for agents

An agent (any member pubkey) can declare a Nostr Pet as its "body" — see
`docs/pets/bao-fund.md` for the `['agent', '<pubkey>']` tag convention on
kind 31124 pet profiles. In the workspace member list
(`src/components/chat/MemberList.tsx`), a member with a declared pet body
gets a paw badge (pet name in the tooltip) linking to `/pets`, where the
pet's upkeep fundraiser lives. Data: `src/lib/petBodies.ts` +
`src/hooks/useAgentBodyPets.ts` — one shared client-side scan (pet profiles
carry `['b', 'pets:ecosystem:v1']`; the `agent` tag itself is not
relay-queryable) backs every member row, newest profile event wins.

## Session hygiene (decrypted-at-rest stores)

Concord persists decrypted content and key material locally: channel rumors
(`2140-concord-rumors`), control-fold snapshots (`2140-concord-cache`),
pending wraps (`2140-concord-pending`), the invite inbox
(`2140-concord-invites`), decrypted image bytes (`concord-v2-images` Cache
Storage), per-relay resume cursors (`2140:wire-cursor:<pubkey>:<relay>`),
read-cut moderation markers (`concord2:read-cut-pending:*`), and the
decrypt-consent record. On **final logout** (no accounts remaining)
`src/lib/purgeConcordStorage.ts` wipes all of it — both logout paths
(`useLoginActions.logout`, `AccountSwitcher`) call it, closing the
module-level store connections first so `deleteDatabase` isn't blocked in
the same tab — so the next identity on the device can't read the previous
account's decrypted chats. 2140's public-event cache and UI prefs are
unaffected.

Related invariants:

- Wire resume cursors are keyed **per account** — an account switch never
  resumes from the previous account's position (which would skip messages).
- The NIP-42 stream-auth registry and the signed user-AUTH cache reset on
  every account switch; an in-flight membership read from the previous
  account can't re-register its keys (registry generation guard in
  `src/wire/WireSync.tsx`).
- Forward sync cursors clamp to the local clock, so a future-stamped wrap
  can't wedge a scope's sweep (`updateStreamCursor`).
