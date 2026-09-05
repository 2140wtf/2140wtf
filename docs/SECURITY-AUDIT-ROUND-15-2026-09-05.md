# Security Audit Round 15 — 2026-09-05

## Scope

Audited relay URL ingress through build-time configuration, deep-link route parameters, and shared WebSocket policy helpers.

## Finding

`lib/schemas.ts` already validated persisted relay settings, but `lib/platform.ts` independently normalized `VITE_APP_RELAYS` and route-derived relay URLs. That path accepted remote `ws://` endpoints and relay URLs containing userinfo, creating cleartext or credential-bearing WebSocket targets outside the shared application policy.

Malformed percent-encoded route parameters could also throw during decoding instead of failing closed.

## Fix

- Reused `isAllowedRelayUrl` in `normalizeRelayUrl`.
- Rejected relay username/password components.
- Preserved `wss://` relays and localhost `ws://` development relays.
- Made `routeParamToRelay` return `undefined` for malformed encoded input.
- Added regression tests for secure/local relays, remote cleartext relays, userinfo, malformed encoding, and route normalization.

## Verification

- Focused tests: 29 passed
- Full Vitest suite: 1,856 tests passed across 181 files
- TypeScript: passed
- ESLint: passed
- Production build: passed
- Security scan: 0 critical, 0 high
