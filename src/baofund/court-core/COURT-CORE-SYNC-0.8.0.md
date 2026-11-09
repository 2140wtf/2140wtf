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

---

# court-core vendor sync — bao-court v0.8.1 (9590d8a)

Synced the v0.8.1 delta into `src/baofund/court-core/` from `baocommunity/bao-court`
tag **v0.8.1** (9590d8a, "v2 attestation validation - in-band finality binding
enforced", PR #35) and bumped the npm dep `@bao/court` `#v0.8.0` → `#v0.8.1`.

## What changed

**Updated files:**
- `validator.ts` - adds the v2 attestation validator: `hashSignerSetRoot`
  (canonical signer-set commitment under `BAO-Court/SignerSet/v1`),
  `AttestationV2ValidationContext` (epoch/tier/threshold/signer-set pins),
  `validateAttestationEventV2`, and `validateCourtAttestation` (accepts both
  shapes; v2 detected by the `epoch` tag). The v1 validator remains frozen.
- `index.ts` - re-exports `COURT_SIGNER_SET_DOMAIN`, `hashSignerSetRoot`,
  `validateAttestationEventV2`, `validateCourtAttestation`,
  `AttestationValidationContext`, `AttestationV2ValidationContext`.

**New tests vendored:** `__tests__/attestationV2Validator.test.ts` (11 tests).
Suite: 124 → 135 passing.

## Client-local adaptations applied this sync

1. **ASCII dash normalization** as documented above (em/en/word-joiner dashes
   and box-drawing U+2500 section rules → ASCII `-`; `©` and `→` are kept,
   matching the rest of the vendored tree).
2. **Test env fix in `attestationV2Validator.test.ts`:** `kp()` wraps the
   `node:crypto` `randomBytes(32)` result in `Uint8Array.from(...)`. Under the
   client's jsdom vitest environment the Buffer realm's Uint8Array fails the
   cross-realm `instanceof` check in `@noble/curves`' `abytes()`
   ("secretKey expected Uint8Array of length 32, got type=object"). Upstream
   runs tests in a node environment and does not need this.

## Verified

- `npx vitest run src/baofund/court-core` → 8 files / 135 tests passed
- `npx tsc --noEmit` → exit 0
- `npx vite build` → exit 0

---

# court-core vendor sync — bao-court v0.8.4 (c06d039)

Synced the v0.8.1→v0.8.4 delta into `src/baofund/court-core/` from
`baocommunity/bao-court` tag **v0.8.4** (c06d039; v0.8.2/v0.8.3 were the
machine-hardening and adversarial-suite commits, v0.8.4 the validator
security-round-1 hardening) and bumped the npm dep `@bao/court`
`#v0.8.1` → `#v0.8.4`.

## What changed

**Updated files (adversarial hardening, upstream PRs #36/#37):**
- `courtCeremonyCore.ts` — adds `isCanonicalUtf8Text` (UTF-8 round-trip
  check: rejects lone surrogates so two distinct strings cannot share one
  canonical byte form) and `assertStateArrays` (fail-closed guard for
  tampered/restored states with non-array ledger fields);
  `normalizeCeremonyRoster` now rejects a non-array `participantIndices`.
- `courtVoteMachine.ts` — non-object events fail closed; `assertStateArrays`
  on `participantIndices`/`allowedOutcomes`/`commits`/`reveals`; outcome
  canonical-UTF-8 checks in all three hash builders and the ballot
  construction; unknown event types throw instead of silently returning an
  unfrozen clock-advanced copy.
- `courtConfirmationMachine.ts` — same fail-closed pattern (non-object
  events, `assertStateArrays`, ladder-shape guard, canonical outcome in
  `assertBoundedOutcome`, unknown-type throw).
- `courtDkgMachine.ts` — state freeze discipline (`freezeCourtDkgMachineState`)
  on every transition; non-object events and non-array ledgers fail closed.
- `courtSigningMachine.ts` — state freeze discipline
  (`freezeCourtSigningMachineState`); re-derives and pins
  `signingSessionHash` in `assertSigningRecordInvariants` (a tampered
  outcome/roster/attempt binding is rejected before any commitment or
  partial is accepted); canonical outcome check; non-object events fail
  closed.
- `validator.ts` — v2 field bounds (`MAX_V2_MARKET_ID_BYTES` 1024 /
  `MAX_V2_OUTCOME_BYTES` 256 / `MAX_V2_ROUND_BYTES` 64; the frozen v1
  validator stays byte-compatible and unbounded); enforces the
  `expectedDisputeEventId` / `expectedMarketId` / `allowedOutcomes` context
  pins on the v2 path (FINDING-3 — previously declared but never enforced);
  `validateCourtAttestation` refuses v1-shaped events when v2-only policy
  fields (`expectedEpoch`/`minTier`/`minThreshold`/`expectedSignerSetRoot`/
  `signerSet`) are requested (FINDING-1 downgrade refusal).

**New tests vendored:** `__tests__/adversarialMachines.test.ts` (1295 lines,
four ceremony machines + core adversarial suites) and
`__tests__/attestationValidator.adversarial.test.ts` (655 lines, v2
validator replay/downgrade/field-confusion/unicode/signature/threshold
games). Suite: 135 → 569 passing (the adversarial suites are heavily
parameterized).

## Client-local adaptations applied this sync

1. **ASCII dash normalization** as documented above (em/en/word-joiner
   dashes → `-`; box-drawing U+2500 section-rule dividers → `-`; `©`,
   `→`, `≠`, `≥`, `…` and the tree diagram `├─`/`└─` are kept, matching
   the existing vendored tree; unicode test-data literals in
   `attestationValidator.adversarial.test.ts` are kept verbatim — they are
   the subject of the canonicalization tests).
2. **jsdom `kp()` fix in `attestationValidator.adversarial.test.ts`:**
   same adaptation as the v0.8.1 sync — `kp()` wraps `randomBytes(32)` in
   `Uint8Array.from(...)` (jsdom realm's Uint8Array vs node:crypto Buffer
   realm; `abytes()` cross-realm check).
3. **`run()` harness signature in `adversarialMachines.test.ts`:** the
   events parameter is `readonly unknown[]` (cast to `E` at the reduce
   call). The client tsconfig typechecks `__tests__` (upstream excludes
   them from its main tsconfig), and inline event literals widen `type`
   to `string`, which no longer assigns to the closed machine event
   unions now that unknown event types fail closed. The harness feeds
   deliberately hostile events; the runtime guards are the assertion.
4. No other divergences. The jsdom `kp()` fix in
   `attestationV2Validator.test.ts` is untouched (that file did not change
   between v0.8.1 and v0.8.4) and remains in place.

## Verified

- `npx vitest run src/baofund/court-core` → 10 files / 569 tests passed
- `npx vitest run src/hooks src/components/bao-court` → green
- `npx tsc --noEmit` → exit 0
- `npx vite build` → exit 0
