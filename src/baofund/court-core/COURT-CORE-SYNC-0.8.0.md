# court-core vendor sync — bao-court v0.8.0 (5710aa5)

Synced `src/baofund/court-core/` from `baocommunity/bao-court` tag **v0.8.0**
(local mirror at v0.8.0-2-g5342ebf, includes the post-tag test PRs). The npm
dep `@bao/court#v0.8.0` was already bumped (PRs #197/#198); this sync brings
the vendored engine to parity.

## What changed

**New modules (copied in clean):**
- `courtConfirmationMachine.ts` — universal-confirmation pipeline state machine
- `batchAttestation.ts` — batch Merkle tree + kind-39007 batch attestation events
- `epochCohort.ts` — epoch cohort derivation / handoff ordering

**Updated files (v0.8.0 changes applied):**
- `crypto.ts` — v2 attestation message (`buildAttestationMessageV2`,
  `ATTESTATION_MESSAGE_DOMAIN_V2`, tagged extension fields)
- `selection.ts` — reputation-weighted selection (`weightFn`,
  `zeroStakeAllowed`, `weightedPriority`, `ResolvedSelectionParams`)
- `liquidEscrow.ts` — **breaking:** `LiquidEscrowParams` now requires
  `funderXOnly` (refund leaf no longer reuses the oracle key);
  `locktimeToPush` rewritten to minimal signed script-number encoding
- `lnSettlement.ts` — hold/plan binding checks (dispute+round match,
  payment-hash-vs-witness verify, bond disputer pinning, hold-amount match)
- `index.ts` — re-exports for the three new modules + v2 attestation message

**Unchanged (34 files):** already content-identical to v0.8.0 — no action.

**New tests vendored:** `__tests__/batchAttestation.test.ts`,
`__tests__/courtConfirmationMachine.test.ts`, `__tests__/epochCohort.test.ts`
(vitest + @noble only — no new deps). Suite: 47 → 124 passing.

## Client-local adaptations preserved

1. **ASCII dash normalization (all files).** The vendored engine normalizes
   Unicode dashes (`—` U+2014, `–` U+2013, `‑` U+2011) to ASCII `-` in
   comments and string literals; the engine carries zero non-ASCII dashes.
   Synced/new files were re-normalized the same way, so comments and error
   messages differ from upstream by dashes only. Any future sync must
   re-apply this normalization (and normalize copied tests too, since some
   upstream tests assert on error-message text).
2. **No other divergences found.** Imports are unrewritten relative `./`
   paths; the `simulateVotes` gating (`appealCoordinator.ts:179,239,557,606,675`)
   and `courtProtocolEvents.ts` legacy handling flagged by the audit are
   upstream v0.8.0 code, not client-local edits. No demo paths, simulator
   hooks, or import rewrites exist in the vendored set.

## Verified

- `npx vitest run src/baofund/court-core` → 7 files / 124 tests passed
- `npx tsc --noEmit` → exit 0
- `npx vite build` → exit 0
