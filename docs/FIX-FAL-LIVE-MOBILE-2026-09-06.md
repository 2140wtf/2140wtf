# Fix — fal.live mobile playback (2026-09-06)

**Symptom:** the fal.live stream/iframe failed to load or play on mobile (both signed in and out); desktop worked.

**Root cause:** the studio iframe delegated only `allow="fullscreen; clipboard-write"`. A cross-origin iframe that does **not** receive `autoplay` gets Chrome's strictest media policy. Desktop browsers often played anyway via the Media Engagement Index (fal.live visited directly, high MEI) — real phones have no engagement history for an embedded cross-origin frame, so LiveKit connected at the signal level but `play()` was rejected (`NotAllowedError`) and the stream appeared stuck/blank.

**Diagnostic evidence (mobile emulation, logged out):**
- Before: `could not playback audio … NotAllowedError: play() failed…` and `requestStorageAccess: Permission denied.`
- After adding delegation: identical probe connects the LiveKit session and the playback error is gone (verified with `--autoplay-policy=no-user-gesture-required` to emulate the user-gesture state a real phone has after tapping to navigate).

**Fix:** `src/pages/FalLivePage.tsx`
```
allow="autoplay; fullscreen; clipboard-write; storage-access"
```
- `autoplay` — required for the embedded player to start on mobile.
- `storage-access` — lets fal.live's own session state function under third-party storage partitioning instead of failing silently.

No other permissions (camera/mic/geolocation) are delegated.

**Also fixed:** `e2e/specs/fal-live-mobile.spec.ts` raced the trollbox 200ms height transition (measured `chatHeight` at exactly 44 mid-animation). The expanded-height assertion now polls until the transition settles.

**Verification:**
- Mobile e2e (375×667 and 320×568): 2/2 pass against a fresh production build
- `FalLivePage` unit tests: 6/6 pass
- Full suite: 1,872 tests pass; tsc, eslint, build, security scan clean
