# Security Audit Round 14 — 2026-09-05

## Scope

Audited CSRF-related authenticated requests, service-worker notification handling, browser capability policy, and deployment-facing security boundaries.

## Findings and fixes

### 1. Push notification assets could contact arbitrary HTTPS origins

The service worker accepted any HTTPS URL for notification icons and badges. The browser may fetch those assets while displaying a notification, which could disclose the user's IP address and notification timing to a third party.

**Fix:** notification assets are now restricted to same-origin URLs without embedded credentials. Invalid or external values fall back to the local application icon.

### 2. Push payload data was persisted unnecessarily

The full server-controlled `payload.data` object was passed into `Notification.data`, persisting arbitrary data in the browser even though the click handler only navigates to the local notifications page.

**Fix:** notification data is now `{}`. Only a bounded subscription tag is retained for notification grouping.

### 3. Notification fields were not uniformly bounded

Push payload title, body, asset URLs, and grouping tags could be oversized, increasing UI/storage/resource pressure.

**Fix:** title, body, asset URL, and tag values are bounded before use.

### 4. Ambient device capabilities were not explicitly denied

The document did not declare a restrictive Permissions Policy for capabilities that this app does not require, leaving policy dependent on browser and embedding defaults.

**Fix:** the HTML shell now explicitly disables camera, microphone, geolocation, display capture, motion sensors, USB, serial, and MIDI access.

## CSRF review

Authenticated barkd calls use cookies with a non-simple `X-Requested-With` header, forcing a CORS preflight for cross-origin requests. The app does not expose a credentialed simple form request, and `form-action 'none'` remains in the CSP. No additional confirmed CSRF bypass was found in this round.

## Verification

- TypeScript: passed
- Vitest: 1,853 tests passed across 180 files
- ESLint: passed
- Production build: passed
- Security scan: 0 critical, 0 high
- Added regression coverage: `src/lib/serviceWorkerPolicy.test.ts`

## Residual deployment note

The HTML meta policies provide defense in depth, but HTTP response headers remain the authoritative deployment control. Hosting configuration should continue to emit equivalent `Permissions-Policy`, CSP, and transport-security headers at the edge.
