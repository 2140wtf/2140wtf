# Audit — production login-loop report + repo state verification (2026-09-06)

Scope: user-reported "production login stuck in a loop, does not allow to log
in". This round verifies what is actually deployed, verifies the deployed
artifact end-to-end, reproduces the full login flow against production with a
throwaway key (read-only against relays — no publishes, no user credentials),
and records findings that need an operator decision.

## 1. What is deployed (verified via GitHub, not local state)

- Production origin: `2140wtf/2140wtf` (GitHub Pages, custom domain 2140.wtf).
- Latest deploy: `5a565bcbe` (PR #124, 2026-09-06T08:08Z) — CI green at that
  SHA: Test, Security Scan, CodeQL, Deploy to GitHub Pages all `success`.
- PR lineage for the current chat architecture:
  - #121 "restore 2140 Social Trollbox" — squash-merged as `bc72e15f`
    (verified: tree of PR head `4c62bda71` is byte-identical to `bc72e15f`).
  - #122 "embed only the encrypted Trollbox room" — supersedes the
    iframe + NIP-22242 parent-auth handshake with the in-page
    `BaoScrollChat` locked to the Trollbox room.
  - #123 / #124 — security audit campaigns (relay pinning, schema salvage).

Local note: the `fix/2140-social-chat-complete` checkout is the merged PR #121
head; its upstream branch was deleted after the squash merge, so the local
remote-tracking ref was stale (now pruned). The branch diverges (1 ahead / 4
behind) purely as a squash artifact — its content is fully contained in main.

## 2. Deployed artifact integrity (all checks pass)

- `index.html` references 180 hashed assets → all HTTP 200.
- Extracted every chunk reference from the 179 deployed JS files → 323 unique
  `assets/*.js` references → all HTTP 200 with
  `content-type: application/javascript` (spot-checked bodies are real JS, not
  the 404 HTML fallback).
- Deployed `/sw.js` is byte-identical to `public/sw.js` on `main` and to a
  fresh `dist/sw.js` built from `5a565bcbe`.
- A fresh `npm run build` of `5a565bcbe` succeeds (BUILD_EXIT=0). Note: chunk
  hashes differ from the deployed build because CI injects
  `VITE_PETS_BATTLE_ESCROW_*` vars — expected; the deployed artifact is
  internally consistent (every chunk its own JS references exists).


## 3. Login flow reproduction against production (headless Chromium)

Method: throwaway key generated locally, discarded after the run. No user
credentials, no publishes — login writes only local storage; relays receive
read (REQ) traffic only, and the probe never triggers a publish action.

Observed, current deploy (`5a565bcbe`):

1. Landing page renders; "Log in" opens the dialog (Key/Nostr/Remote/Passkey/LN
   tabs all render; no console errors).
2. Key tab: invalid-nsec input is rejected by validation ("Invalid secret key
   format…") with no network side effects.
3. Valid throwaway nsec submit → dialog closes → `InitialSyncGate` shows
   "Syncing your settings…" → sync hard-timeout (5 s) → questionnaire
   ("Skip and continue to app") → skip → **authenticated app renders**
   (anon identity mode as designed for a fresh key).
4. `nostr:login` persisted (`present`); full page reload restores the session:
   no log-in button, user still active. Two consecutive reproduction runs,
   identical result.
5. Across all probes: **0 console errors, 0 failed (≥400) requests, exactly 1
   load event per navigation** — no reload loop, no navigation loop.
6. The same flow reproduced on a local `vite preview` of the fresh `main`
   build with identical results.

The only console warning observed was a relay-read timeout
("Failed to fetch contact list from relays: TimeoutError") in the sandbox —
read-side, non-fatal, and the sync hard-timeout handled it.

## 4. Loop candidates examined and ruled out (code-level)

- **Chunk-error recovery loop** (`useWindowChunkErrorRecovery` +
  `ChunkErrorBoundary`): guarded once per session via
  `sessionStorage['chunk-error-recovery']`, reset 5 s after boot; with the
  artifact intact (section 2) there is no recurring trigger.
- **Service-worker reload loop** (`main.tsx` `controllerchange`): reloads only
  when a controller existed at startup, once per page lifetime
  (`reloadingForServiceWorker` guard); deployed sw.js matches the repo.
- **Route redirect loops**: no `/login` route exists (login is modal-only);
  the only unconditional redirects are legacy-path `Navigate`s
  (`/bao/chat → /community`, `/streams → /videos`, …), none cyclic.
- **`InitialSyncGate` stuck spinner**: `useInitialSync` races a 5 s hard
  timeout, and `skipSync`/`markComplete` persist a local sync timestamp so the
  gate cannot re-gate after a skip (the `#123` unstick fix is deployed).
- **`NostrSync` settings write loop**: the `useUserRelays` migration is
  one-shot (`userRelaysToggled` localStorage marker) and settings application

## 5. Findings requiring an operator decision (from the repo audit)

- **F1 (policy conflict, operator call needed).** `src/lib/baosocial/rooms.ts`
  ships live room join capabilities (`k` invite secret, `w` welcomer, `r`
  routing id — 384-char fragment, SHA-256 prefix `8f0b18927293…`) and the
  security scanner explicitly allowlists that file (added in #123). AGENTS.md
  §3 says a room being "public" does not make its admission capability public
  data, and the scanner's own NOTE flags the `adm-open` rows. Either rotate
  and move capabilities out of tracked source, or record an explicit, dated
  policy decision. (No secret values reproduced here, per §3.7.)
- **F2 (medium).** `LiveStreamChat` (NIP-53 kind-1311) publishes plaintext
  chat to the user's global relay pool (public relays included) gated only by
  a default-**on** pref (`liveChat: true`), signed with the real key, no
  pseudonymization. Recommend default-off, relay isolation, or pseudonymized
  identity for 1311.
- **F3 (low).** `useNostrPublish.onSuccess` logs the full signed event
  (`console.log("Event published successfully:", data)`, main:238) — logs
  message content to the console. Log the event id instead.
- **F4 (medium, supply chain).** `npm audit`: 5 advisories (2 high `fast-uri`
  SSRF/host-confusion via `@modelcontextprotocol/sdk`→`ajv`; 3 moderate
  `fflate` Zip64 loop, `qs` DoS). `fast-uri` and `qs` are embedded in the
  tracked, shipped `public/bao-chat-mcp.mjs` bundle. Not CI-gated; recommend a
  controlled bump plus an `npm audit --omit=dev` CI gate.

## 6. Open question — pinning the user-visible loop

The loop could not be reproduced on `5a565bcbe` from a clean session. To pin
it, capture from an affected user/device:

1. Login method used (Key / Nostr extension / Remote NIP-46 / Passkey).
2. Exact behavior: page reload cycle (URL gains `?_cb=…`), dialog reopening,
   spinner stuck on "Syncing your settings…", or signer prompt repeating.
3. Browser console output at the moment of the loop (errors + the URL bar).
4. Whether it reproduces in a private window (rules out stale service-worker
   / cache state) and on web vs the native app.

A stale service worker serving a pre-#122 cached `index.html` on a long-lived
tab is the leading hypothesis for a device-specific loop; the recovery path
(`recoverFromChunkError`) already clears caches + unregisters the SW, so a
single manual hard-reload should confirm or clear it.

## 7. Verification appendix

- `node scripts/security-scan.mjs` on `main`: 1845 files, Critical 0 / High 0.
- Fresh build of `5a565bcbe`: BUILD_EXIT=0.
- Pre-merge checklist for this docs-only branch: see PR description (tsc,
  eslint, vitest, build run in the worktree).
- Probe scripts used were ephemeral `/tmp` files (not committed), per the
  debug-scripts lifecycle rule.
