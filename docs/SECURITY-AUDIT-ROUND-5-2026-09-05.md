# Security Audit — Round 5

**Date:** 2026-09-05
**Scope:** nsite signer RPC concurrency, signer input validation, and permission persistence
**Mode:** Local-only; no push or deployment

## Executive summary

Round 5 hardened the nsite-to-parent signer boundary. Origin and iframe-source checks were already present in `SandboxFrame`, but valid messages could still arrive concurrently. The parent signer hook now serializes requests, bounds the queue, cancels queued work when the preview unmounts, and validates signer inputs before invoking the user's key. Persisted permission records now fail closed when malformed or oversized data is present.

## Findings and fixes

### 1. Concurrent signer requests could overwrite the permission prompt — fixed

**Affected file:** `src/hooks/useNsiteSignerRpc.ts`

The injected provider serializes its own calls, but the parent-side `SandboxFrame` handler accepts independently delivered messages. Multiple valid RPC messages could therefore enter the hook concurrently. Because the hook has one prompt resolver, a later request could replace the resolver for an earlier request, leaving a request unresolved or applying a decision to the wrong operation.

Fixes:

- Added a parent-side FIFO RPC queue as defense in depth.
- Limited queued/in-flight requests to 32 per preview.
- Preserved one active permission prompt at a time.
- Rejected new work after component unmount and cancelled queued work cleanly.
- Rejected an active prompt on unmount so iframe callers receive an RPC error rather than hanging indefinitely.

### 2. Signer RPC accepted unbounded or malformed input — fixed

**Affected file:** `src/hooks/useNsiteSignerRpc.ts`

Before signing or encryption, the hook now validates:

- BIP-340 event kind range and integer shape.
- Event content length.
- Event tag count, item count, and item length.
- 64-hex public keys for encryption/decryption peers.
- Plaintext and ciphertext maximum lengths.

Malformed input is rejected before reaching the signer implementation.

### 3. Malformed persisted permission records were trusted — fixed

**Affected file:** `src/lib/nsitePermissions.ts`

Permission JSON is browser-reachable and may be corrupted or modified by another script. The loader now validates the complete record shape, operation type, sign-event kind, pubkey, timestamps, site identifiers, and collection sizes. Invalid records are discarded and permission lookup fails closed to `ask`.

New writes also reject invalid scopes and permission values rather than persisting unusable records. Allowances and permission lists are bounded to prevent localStorage-driven resource exhaustion.

## Tests added

- `src/hooks/useNsiteSignerRpc.test.tsx`
  - Verifies simultaneous signer requests are prompted and resolved in FIFO order.
  - Verifies malformed event and encryption parameters are rejected before signer calls.
- `src/lib/nsitePermissions.test.ts`
  - Verifies malformed JSON and invalid permission shapes fail closed.
  - Verifies scoped allow/deny decisions and replacement behavior.
  - Verifies invalid writes are ignored.
  - Verifies clearing one user/site scope does not affect another.

## Verification

- TypeScript: passed
- ESLint: passed
- Vitest: **1,826 tests passed**
- Production Vite build: passed
- Security scan: **1,810 files; 0 critical, 0 high**
- No push or deployment performed

## Round status

**Round 5 complete and committed locally.** Remaining operational follow-ups include multi-tab conflict handling for permission writes and browser-level stress tests for iframe teardown during an in-flight signer call.
