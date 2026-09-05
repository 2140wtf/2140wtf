# Security Audit Round 18 — 2026-09-05

## Scope

Investigated GitHub CodeQL's high-severity **Clear text storage of sensitive information** alert and reconciled GitHub's dependency warning with the repository's current lockfile audit.

## CodeQL finding

The CodeQL data-flow trace identified `src/lib/cashu/auctionCommit.ts` as serializing sealed auction reveal secrets (`valueSats` and nonce) into `localStorage` through `secretsMap()` and `persistSecrets()`.

These values are sensitive because they reveal a bidder's hidden maximum or seller's reserve and are required to open a published commitment.

## Fix

- Removed all localStorage/sessionStorage reads and writes from the auction commitment secret journal.
- Replaced persistent storage with a bounded, tab-memory `Map` capped at 256 entries.
- Kept the existing synchronous API used by proxy bidding and settlement code.
- Added regression tests proving browser storage is never accessed and cleanup removes secrets from memory.
- This intentionally makes sealed commitments tab-scoped; if the tab closes before reveal, the commitment is treated as unavailable rather than persisting the secret in cleartext.

## Dependency audit reconciliation

GitHub displayed 5 high and 2 moderate dependency findings on the default branch. On the current branch:

- `npm audit --audit-level=high`: 0 vulnerabilities
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities

The discrepancy should be rechecked in GitHub's Dependabot alert details, which may reference the default branch, an older lockfile snapshot, or transitive development tooling. Deprecated packages remain a separate compatibility task and were not upgraded speculatively.

## Verification

- Focused auction secret tests: passed
- Full Vitest suite: 1,861 tests passed across 183 files
- TypeScript: passed
- ESLint: passed
- Production build: passed
- Source security scan: 0 critical, 0 high
- Current dependency audit: 0 vulnerabilities
