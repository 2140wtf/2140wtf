# Security Audit Round 12 — 2026-09-05

## Scope

Browser cache/service-worker review, untrusted binary/text response handling, SVG processing, encrypted backups, and media resource exhaustion.

## Confirmed findings

### 1. Unbounded encrypted-media response buffering

Encrypted attachment fetching called `response.arrayBuffer()` without a per-response maximum. A malicious or compromised media host could return a very large ciphertext response and force excessive browser memory allocation before decryption failed.

### 2. Unbounded encrypted-backup response buffering

Backup retrieval called `response.text()` without a hard response-size limit. The backup hash check happened only after the entire response was buffered.

### 3. Custom SVG URL and response trust gap

Custom pet-form SVG fetches accepted event/profile URLs without the shared public-HTTPS policy and buffered the complete response before hash verification and sanitization.

## Fixes

- Added `readResponseBytes()` with declared `Content-Length` checks, streaming byte accounting, and buffered-response limits.
- Limited encrypted media downloads to 256 MiB per response.
- Limited encrypted backup downloads to 4 MiB per response.
- Limited custom-form SVG downloads to 512 KiB per response.
- Applied public-HTTPS validation before fetching backup and custom SVG URLs.
- Added regression coverage for oversized streamed/buffered responses and private-network backup URLs.

## Reviewed and found safe

Production service-worker registration uses `updateViaCache: 'none'`, and development mode unregisters existing service workers to avoid stale asset hijacking. Existing SVG sanitizers already enforce strict element/attribute allowlists and size caps after content acquisition.

## Verification

- Focused tests: 50/50 passed.
- Full Vitest suite: 1,846 tests passed across 179 files.
- TypeScript: passed.
- ESLint: passed.
- Vite production build: passed.
- Repository security scan: 0 critical, 0 high.

## Residual risk

The limits are intentionally selected for current application use cases; legitimate future media types may require a purpose-specific larger limit. All new untrusted binary/text fetches should use the bounded reader before decoding or parsing.
