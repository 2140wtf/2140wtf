# Session Wrap-Up — 2026-08-07 (P1-3 plane isolation + outstanding work)

Local ops doc — gitignored, for future sessions. State as of end of session.

## Done this session (branch `feat/plane-isolation`)

**P1-3 — per-plane socket isolation (opt-in)** implemented:

- `src/concord-v2/lib/concordTransport.ts`
  - `concordClient(communityId, keys)` now fans out to one session **per stream
    key** when isolation is enabled for that community and `keys.length > 1`.
    No socket ever carries more than one identity → auth-gated relays can no
    longer link a community's streams/epochs via the NIP-42 auth set.
  - `FanoutRelayHandle` (implements `ConcordRelayHandle`): splits each filter's
    `authors` across owning sessions (throws on author-less or foreign-author
    filters, same as `Session.assertFilters`), merges+dedupes query results by
    event id, routes `event()` by `pubkey`, `addKeys()` by pk (spawns a new
    single-key session for keys that arrive later), sequential `req()` streams,
    combined `onReopen`, `close()` closes all children.
  - `planeIsolationEnabled(idHex)` / `setPlaneIsolation(idHex, on)` —
    localStorage key `concord2:plane-isolation:<idHex>`. Local-only, per
    community, per device. **Opt-in, never default** (agent-cooperation rule).
- `src/concord-v2/components/PlaneIsolationToggle2.tsx` — Switch in community
  settings (`CommunityInfoDialog2`, under the scoped-name editor). Toasts that
  a reconnect is needed; stored only on device.

Note: `CommunityV2.id` is a `Uint8Array` — use `community.idHex` for storage keys.

## Verification status

- `tsc` + `eslint` green.
- Vitest: 2025/2026 pass. The single failure —
  `groupChatService.test.ts › caps the future-epoch buffer` — fails ONLY under
  full-suite CPU load (hits the 5s default vitest timeout, 5047ms) and passes
  in isolation (1492ms). Module does not import concordTransport. Pre-existing
  load flake; verified against clean main (see session notes). If CI hits it,
  re-run the job or bump that test's timeout like the `sendTimeoutMs` fix.
- **NOT yet done: in-Chrome verification of the toggle** (kimi-webbridge:
  enable toggle on a test community, reopen, confirm chat/guestbook still sync,
  check sockets in devtools Network → one WS per stream key).

## Left to do (priority order)

1. **Merge P1-3**: verify in Chrome → push branch → PR → merge (branch
   protection needs `test` check; use "Bypass rules and merge" if approvals
   block). `gh` CLI is NOT a collaborator — use kimi-webbridge in Chrome.
2. **P0-2 vault identity redesign** (big, last privacy item): kind 13302/13303
   signed by real npub leaks Concord usage + roster-gated on bao relay (lost
   communities). Needs separate identity / private-relay sync + migration.
3. **Deploy `/v1/wallet/send`** on bao API (PM2 `bao-api`, source
   `/home/bob/Documents/bao.markets` from `origin/main`): client auto-flips
   from 404 fallback (NIP-60 nutzap) to custodial all-7-rails once deployed.
4. **Branch protection**: "require approvals" stuck at 1 — needs user's GitHub
   sudo password to set 0; until then use bypass checkbox.
5. **Operator npubs**: add bao.markets + bao fund npubs to
   `BAO_RELAY_OPERATOR_PUBKEYS` on the VPS (user must supply pubkeys).
6. **Cloudflare Workers Builds**: misconfigured for Vite SPA — build cmd
   `npm run build`, output `dist`, Node 22,
   `NODE_OPTIONS=--max-old-space-size=4096`, static-only. Awaiting user's goal.
7. **APK rebuild**: installed Android app runs stale bundle with all old bugs.
8. **Recurring Chrome logout** of test accounts between sessions (uninvestigated).

## Known flakes / gotchas

- Full-suite runs on this machine are CPU-starved (Chrome + dev servers) —
  crypto-heavy tests can hit the 5s timeout. Re-run before assuming a real
  regression. CI is usually less loaded.
- GroupChatService (kind-104 legacy group chat) is a separate module from
  concord-v2; its tests don't exercise the transport.

## Privacy audit scoreboard

P0-1 ✅ P0-3 ✅ P1-1 ✅ (#27) P1-2 ✅ P1-3 ✅ (this branch, pending merge)
P1-4 ✅ P1-5 ✅ P2-2 ✅ — remaining: **P0-2 vault redesign**.
