# Security Audit Round 11 — 2026-09-05

## Scope

Sensitive-data leakage through diagnostics, API error handling, authentication parsing, and wallet transaction flows.

## Confirmed findings

### 1. Invalid login identifiers were logged

The current-user hook logged `login.id` when a login failed to parse. Nsec login identifiers contain the encoded private key, so malformed or unsupported login data could expose credential material in browser developer tools or log collection.

### 2. Bitcoin broadcast response bodies were logged

The broadcast path logged the complete Esplora response body on failure. Although the code comment noted that the body could contain raw transaction or wallet data, the body was still emitted to the console.

## Fixes

- Replaced invalid-login identifier logging with only the login type and error class.
- Replaced full broadcast-body logging with HTTP status and response length.
- Added a regression test proving a sensitive broadcast response body is not passed to `console.warn`.

## Reviewed

- Encrypted nsec login storage remains encrypted at rest and refuses plaintext persistence when encryption is unavailable.
- Existing recursive telemetry redaction covers nsec, NWC, bunker, private-key, seed, and proof fields.
- Existing API clients generally avoid placing response bodies in user-facing errors; this round specifically closed the remaining Bitcoin broadcast console leak.

## Verification

- Focused tests: 82/82 passed.
- Full Vitest suite: 1,840 tests passed across 178 files.
- TypeScript: passed.
- ESLint: passed.
- Vite production build: passed.
- Repository security scan: 0 critical, 0 high.

## Residual risk

Browser console output remains observable to users and browser extensions. New diagnostics must continue to avoid identifiers, tokens, raw API bodies, transaction payloads, and exception objects that may contain request context.
