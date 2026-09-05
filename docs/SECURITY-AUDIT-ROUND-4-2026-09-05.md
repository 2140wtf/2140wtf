# Security Audit — Round 4

**Date:** 2026-09-05
**Scope:** LNURL worker abuse limits, Cashu encrypted-storage concurrency, and GitHub Actions supply-chain hardening
**Mode:** Local-only; no push or deployment

## Executive summary

Round 4 confirmed and hardened three risk areas. The LNURL worker now bounds attacker-controlled work and rejects malformed claim material earlier. Cashu encrypted read-modify-write journals now use the cross-tab transaction lock, and the IndexedDB lock path keeps compare-and-swap operations inside the transaction. CI workflows now use immutable full-length action SHAs, disable checkout credential persistence, and retain least-privilege permissions.

## Findings and fixes

### 1. LNURL worker abuse and resource exhaustion — fixed

**Affected file:** `src/worker/lnaddrWorker.ts`

- Added per-isolate request limits for claim, release, callback, and lookup routes, with bounded bucket cleanup and `429`/`Retry-After` responses.
- Capped claim request bodies, callback URL length, forwarded NIP-57 `nostr` data, comments, and upstream callback response size.
- Added a ten-second upstream callback timeout and disabled redirects.
- Restricted registered wallet callbacks to public HTTPS URLs and rejected localhost, loopback, link-local, private IPv4, and private IPv6 destinations.
- Added strict amount bounds and safe-integer checks before proxying invoice requests.
- Corrected Schnorr signature validation from 64 hex characters to the BIP-340-required 128 hex characters.
- Added `HEAD` availability support for clients that probe LNURL names without requesting a body.
- Validated data loaded from KV before use, including callback, owner key, receipt key, and timestamp shape.

**Residual operational note:** in-memory rate limits are only an isolate-local shield. Use Cloudflare Rate Limiting or a Durable Object for account-wide enforcement at production scale.

### 2. Cashu encrypted journal races — fixed

**Affected files:** `src/lib/cashu/storage.ts`, `src/hooks/useCashuWallet.ts`, `src/lib/cashu/storage.test.ts`

- Serialized minted-quote, pending-receive, processed-token, processed-Nutzap, pending-Nutzap, and transaction read-modify-write operations through the encrypted transaction lock.
- Made pending-receive deletion asynchronous and lock-protected so a concurrent writer cannot resurrect a consumed retry entry.
- Updated wallet cleanup callers to await or explicitly handle asynchronous deletion.
- Kept the lock compare-and-swap read and conditional write inside one IndexedDB transaction, avoiding browser transaction auto-commit gaps.
- Added ownership revalidation after lease theft/tab suspension and regression coverage for invalidated locks.
- Preserved pending receive attempt counters instead of resetting them during status updates.

### 3. GitHub Actions supply-chain and credential exposure — fixed

**Affected files:** `.github/workflows/deploy.yml`, `.github/workflows/preview-browser-test.yml`, `.github/workflows/security-scan.yml`, `.github/workflows/test.yml`

- Replaced floating major-version action references with verified full-length release commit SHAs.
- Added `persist-credentials: false` to every checkout step.
- Retained read-only `contents` permissions, with Pages deployment permissions limited to the deployment workflow.
- Kept lockfile-based installs (`npm ci`) and existing workflow concurrency controls.

## Tests added or updated

- Added `src/worker/lnaddrWorker.test.ts` covering signature length, oversized bodies, `HEAD` availability, amount bounds, and per-client claim rate limiting.
- Extended Cashu storage tests for pending-receive counters and cross-tab lock ownership behavior.

## Verification

- TypeScript: passed
- ESLint: passed
- Vitest: focused worker, Cashu storage, and wallet suites pass (**84 tests**) after the final rate-limit regression assertion
- Production Vite build: passed
- Workflow action scan: all `uses:` references are full-length SHAs
- No push or deployment performed

## Round status

**Round 4 complete and committed locally.** The next round should treat Cloudflare edge-level rate limiting, worker observability, and browser multi-tab stress testing as operational follow-ups rather than assuming the in-memory shield is globally authoritative.
