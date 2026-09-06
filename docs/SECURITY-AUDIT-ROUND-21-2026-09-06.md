# Security Audit — Round 21 (2026-09-06)

**Focus:** privacy leak — burner secret key rendered in the Trollbox UI; plusfal-live onboarding gate triage.

## Findings

### F-21-1: Burner nsec rendered in the Trollbox composer (Critical — privacy)

`src/components/bao/BaoScrollChat.tsx` rendered the room burner **secret key** under the composer:

```tsx
Burner key: ${nsecEncode(sk).slice(0, 10)}…
```

Truncation is not redaction: the nsec prefix was live DOM text, capturable by screenshots, screen recordings, and screen shares — and this panel is embedded beside the fal.live live-stream page where screen sharing is a primary flow. The prefix is also stable across sessions, enabling cross-screenshot burner correlation.

**Fix:** removed the burner-key display entirely. The room-scoped secret now never enters the DOM.

### F-21-2: Room identity chip showed raw hex pubkey (Low — confusion/correlation)

The adjacent chip displayed `getPublicKey(secret).slice(0, 12)` as raw hex with the full pubkey in a tooltip — hex invites misreading it as secret material (the exact confusion reported).

**Fix:** the chip now shows a truncated **npub** (public-only, bech32) with the full npub in the tooltip, matching the user's guidance: identity strings in chat are npub-shaped, never nsec-shaped.

### Regression coverage

`src/components/bao/BaoScrollChat.secrets.test.tsx`:
1. **Source tripwire** — the component source must never contain `nsecEncode`, `Burner key`, or secret-slicing again.
2. **DOM assertion** — with the scroll client mounted and its pinned-relay socket open, `document.body.textContent` must never match `nsec1` or "burner key".

## Triage note (fal-live mobile)

The reported "fal on mobile broken" symptom reproduced in Playwright mobile emulation: a fresh authed device lands on the **onboarding questionnaire** instead of /fal-live (the page itself is fine; desktop works because local sync state exists). The `/fal-live` InitialSyncGate bypass exists for authed users but the fresh-device flow still reaches `not-found` questionnaire on other routes first. Follow-up fix queued; not part of this privacy commit.

## Verification

- `npx tsc --noEmit --incremental false` — pass
- `npx vitest run --reporter=dot --silent` — **1,872 tests passed** (185 files)
- `npx eslint --no-cache` — pass
- `npx vite build -l error` — pass
- `node scripts/security-scan.mjs` — 0 critical / 0 high
- `git diff --check` — clean
