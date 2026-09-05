# Security Audit Round 13 — 2026-09-05

## Scope

External navigation, native share/deep-link handling, payment URI opening, signer-app handoff, and user-controlled app paths.

## Confirmed finding

The shared `openUrl()` helper forwarded arbitrary caller-controlled strings directly to `window.open()` or the native share sheet. While many callers supplied trusted constants, several paths consumed event/profile/task data, so unsupported schemes such as `javascript:`, `data:`, or private-network URLs could reach a browser/native navigation boundary if upstream validation regressed.

## Fixes

- Added `sanitizeOpenUrl()` with a narrow allowlist for public HTTP(S), app-relative paths, Bitcoin BIP-21, Lightning, BOLT12, Nostr Connect, Monero, and SimpleX deep links.
- Rejected control characters, protocol-relative URLs, unknown schemes, executable schemes, and private-network HTTPS URLs.
- Made `openUrl()` fail closed before invoking browser or native navigation.
- Preserved existing supported wallet, signer, payment, and app-relative navigation flows.
- Added regression coverage for safe URLs, supported deep links, unsafe schemes, local-network URLs, and `window.open` non-invocation.

## Reviewed and found safe

Third-party embed message handlers validate fixed provider origins and exact iframe sources. Existing route navigation through React Router remains separate from external URL opening.

## Verification

- Focused tests: 19/19 passed.
- Full Vitest suite: 1,850 tests passed across 179 files.
- TypeScript: passed.
- ESLint: passed.
- Vite production build: passed.
- Repository security scan: 0 critical, 0 high.

## Residual risk

The allowlist intentionally permits selected application deep-link schemes because users rely on wallet and signer handoffs. Any new scheme must be added with a purpose-specific payload validator and regression tests rather than bypassing `openUrl()`.
