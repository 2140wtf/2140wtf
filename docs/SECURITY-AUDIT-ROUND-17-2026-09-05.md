# Security Audit Round 17 — 2026-09-05

## Scope

Audited API response parsing and long-lived server-sent event streams used by the BAO verification UI.

## Finding

`fetchScoreJobEvents()` appended arbitrary SSE chunks to an in-memory buffer and parsed arbitrary JSON objects into typed events. A hostile or broken API could keep the connection open, grow the buffer without bound, emit oversized frames, or generate unlimited malformed events, causing memory and UI pressure.

## Fix

- Added a 512 KiB total stream limit.
- Added a 32 KiB frame/buffer limit.
- Capped collected events at 512.
- Capped token deltas at 8 KiB.
- Validated event types and safe integer job IDs before exposing frames to callers.
- Cancels the reader and fails closed when the total stream exceeds its limit.
- Ignores malformed/schema-invalid frames without trusting them.

## Verification

- Focused BAO fundraising tests: 22 passed
- Full Vitest suite: 1,859 tests passed across 182 files
- TypeScript: passed
- ESLint: passed
- Production build: passed
- Source security scan: 0 critical, 0 high
- Production dependency audit: 0 vulnerabilities
