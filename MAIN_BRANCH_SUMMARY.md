# 2140.wtf local `main` branch summary

**Location:** `/home/bob/Documents/2140wtf/2140wtf`  
**Branch:** `main` (and `reconcile/main`, same commit)  
**Status:** `184 commits ahead of origin/main` — not pushed yet.

## What's on this branch

This local `main` contains work from several parallel sessions. The big bundles are:

| Area | Approx. commits | Notes |
|---|---|---|
| **Cube / BAO polls** | ~17 | Hosted BAO cube embed, list/grid/cubes toggle, iframe sandbox fixes, event-passing fallback for polls BAO hasn't indexed. |
| **Pets / Blobbi / ₿AO forms** | ~30 | Sats-only economy, adult forms, rooms, battles, shop, onboarding, BAO trading rewards. |
| **Group chat (NIP-104)** | ~25 | Groups, invites, admin/promote/ban, per-epoch secrets, read cursors. |
| **Cashu / NIP-60 wallet** | ~15 | Wallet sync, Nutzap send/receive, faucet, backups. |
| **Roadstr** | ~10 | Map, marker clustering, search, popups, alerts widget. |
| **DMs / NIP-17** | ~10 | Inbox, relay fallback, immediate sent-message rendering. |
| **Branding / sidebar / themes** | ~20 | 2140.wtf rebrand, main menu order, light theme fixes. |
| **Prediction markets / ₿AO MARKETS** | ~15 | Widget, price history, charts, BTC Map links. |
| **Misc fixes** | ~45 | Privacy prefs, onboarding, settings, tests, CI, auth, etc. |

## Cube-specific commits (oldest → newest)

```
19afadbf feat(polls): add hosted cube view toggle to polls feed
7e4190f4 feat(polls,help): cube preview, load more, retry, and 2140 support card
a2f3cd27 feat(polls): render a BAO cube embed for every poll
ab7a7a23 style(polls): match BAO cube embed dimensions to official snippet
b5d34a11 feat(polls): API-first cube embed with deterministic fallback
7b6be942 feat(polls): respect VITE_BAO_API_URL for local BAO cube dev
982eba1c feat(polls): render 3D poll cubes locally using real API data
c3117be6 revert(polls): use BAO iframe/API cube instead of local renderer
a0432260 feat(polls): render BAO hosted cube for all poll cards
bed806f5 feat(polls): flat poll cards, single-column cube view, cache signer pubkey
f7025b7a fix(polls): use square aspect-ratio for cube iframe so it fits without scroll
8a37b95f feat(polls): cube view toggle in default polls feed, remove separate cubes section
cf586c62 feat(polls): cube/flat toggle, default cube view
754f1282 feat(polls): replace pollerama link with BAO polls demo; cube/txt toggle; iframe sandbox fixes
8d6a7f4c feat(polls): labeled cube/txt view toggle with icons
e3bf56c2 Avoid broken BAO cubes for polls BAO hasn't indexed
3ea0f4df fix(polls): default feed to list; only render BAO cube when indexed or fallback source
```

## Key cube files

```
src/components/HostedPollCube.tsx
src/components/PollCubeFeed.tsx
src/components/PollCubePreview.tsx
src/components/PollContent.tsx
src/hooks/useHostedCubeEmbed.ts
src/contexts/PollsViewContext.tsx
src/hooks/usePollsView.ts
src/lib/pollsViewContext.ts
```

Wiring/integration files (also contain non-cube changes):

```
src/AppRouter.tsx
src/pages/KindFeedPage.tsx
src/lib/sidebarItems.tsx
```

## Notes for other sessions

- This branch is **local only**. `origin/main` is 184 commits behind.
- If you only want the cube work cherry-picked onto `origin/main`, it needs manual extraction because the first cube commit already conflicts with current `origin/main` (AppRouter/KindFeedPage have diverged).
- The easier path is to push/merge the whole `main` branch if the other features are also wanted.
