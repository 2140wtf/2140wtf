# Security Audit Round 9 — 2026-09-05

## Scope

Media playback URLs, encrypted attachment fetches, LNURL discovery, wallet-import callbacks, and invoice callback construction.

## Confirmed findings

### 1. LNURL private-network endpoint contact

The LNURL resolver required HTTPS but did not reject loopback, RFC-1918, link-local, or local-name hosts. An untrusted profile could therefore cause the browser to contact a private service during payment resolution.

### 2. Wallet-import URL trust boundary

The Lightning-address claim/import helper accepted any string beginning with `https://` for the wallet endpoint and callback. This duplicated weaker validation and allowed private-network HTTPS targets.

### 3. Encrypted media fetch bypass

Encrypted attachments were fetched directly from their event-provided URL. The fetch path did not enforce the shared public HTTPS policy, allowing unsafe URLs to reach `fetch()` even though several display components sanitized ordinary media.

### 4. Chat video fallback and poster bypass

The chat video component used the original media URL for its fallback link and passed the poster directly to the native video element, bypassing the shared URL policy.

## Fixes

- Added `sanitizePublicHttpsUrl()` as a shared public-HTTPS validator.
- Reused the validator for LNURL discovery URLs, LNURL callbacks, invoice callback construction, wallet-import endpoints, and wallet-import callbacks.
- Applied public-URL validation before encrypted-media cache-key creation and network fetches.
- Made `useResolvedMediaSrc` fail closed for invalid media URLs.
- Sanitized chat video posters and fallback links.
- Added regression coverage for local/private HTTPS URLs, non-HTTPS encrypted media, unsafe invoice callbacks, and unsafe wallet endpoints.

## Verification

- Focused tests: 31/31 passed.
- Full Vitest suite: 1,839 tests passed across 178 files.
- TypeScript: passed.
- ESLint: passed.
- Vite production build: passed.
- Repository security scan: 0 critical, 0 high.

## Residual risk

URL validation is a client-side SSRF/privacy defense, not a substitute for network-layer egress controls. Other fixed application service endpoints remain governed by their existing configuration allowlists; future user-controlled fetch paths should use `sanitizePublicHttpsUrl()` or a stricter purpose-specific policy.
