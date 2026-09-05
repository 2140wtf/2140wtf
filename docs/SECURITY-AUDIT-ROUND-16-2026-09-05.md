# Security Audit Round 16 — 2026-09-05

## Scope

Audited dependency vulnerability gating, GitHub Actions pinning, lockfile integrity, and third-party package status.

## Finding

The production dependency audit workflow used `npm audit --audit-level=critical`, so high-severity production vulnerabilities would not fail CI. The repository's current production dependency audit is clean, but the threshold was weaker than the stated security objective.

All workflow actions inspected in this round are pinned to immutable commit SHAs. The lockfile uses integrity metadata for registry packages. Several dependencies are deprecated or on older major versions, notably Cashu and Recharts; upgrading them requires compatibility and wallet-state migration testing and was not performed speculatively in this round.

## Fix

- Changed the CI production dependency gate from `critical` to `high`.
- Included the moderate count in the workflow summary for visibility.
- Added a regression test that prevents the threshold from being silently weakened.

## Verification

- Focused CI policy test: passed
- Full Vitest suite: 1,857 tests passed across 182 files
- TypeScript: passed
- ESLint: passed
- Production build: passed
- Source security scan: 0 critical, 0 high
- Production dependency audit: 0 vulnerabilities
