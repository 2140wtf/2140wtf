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

---

# court-core vendor sync — bao-court v0.8.5 (e2d3667)

Synced the v0.8.4→v0.8.5 delta into `src/baofund/court-core/` from
`baocommunity/bao-court` tag **v0.8.5** (e2d3667, "release: v0.8.5 — round-2
cross-module hardening (PR #41) versioned (#42)") and bumped the npm dep
`@bao/court` `#v0.8.4` → `#v0.8.5` (lockfile re-resolved via explicit
`npm install @bao/court@github:baocommunity/bao-court#v0.8.5`; resolves to the
exact tag commit e2d3667).

## What changed (round-2 cross-module adversarial audit, upstream PR #41)

**Updated files:**
- `validator.ts` - `AttestationV2ValidationContext` gains
  `expectedBatchMerkleRoot`: the v2 `batch` tag must be PRESENT and match
  (fail-closed), added to `V2_ONLY_POLICY_FIELDS` (refused on v1-shaped
  downgrades); docstring hardening - loud MUST-pin-`expectedGroupPubkey`
  warnings on `validateAttestationEventV2` / `validateCourtAttestation` /
  batch context (unpinned consumers accept any valid signature); the
  v1-downgrade error message now lists `expectedBatchMerkleRoot`.
- `batchAttestation.ts` - docstring hardening only: group-key MUST-pin note
  on the batch context, batch-membership scope on `buildBatchMerkleTree`
  (verdictHash leaves bind no epoch/cohort - consumers MUST dedupe by
  verdictHash), and what `verifyCaseInBatch` does/does not pin.
- `courtConfirmationMachine.ts` - ledger re-verification after snapshot
  restore: new `assertValidConfirmationLedger` (canonical confirmHash
  recomputation, roster membership, hex well-formedness, per-index and
  event-id uniqueness for the confirmation AND challenge ledgers) called at
  `resolve_round` and `finalize`; domain-reuse note on the
  vote-machine `COURT_VERDICT_DOMAIN` import.

**New tests vendored:** `__tests__/adversarialCrossModule.test.ts` (1015
lines, six chained cross-module adversarial sequences: epoch-rotation
replay, batch membership double-counting, foreign-key tier elevation,
machine-state replay/double-finalize, mass-vote ledger cross-round leakage,
verdict-domain substitution). Suite: 569 → 592 passing.

## Client-local adaptations applied this sync

1. **ASCII dash normalization** as documented above (em/en/word-joiner
   dashes and box-drawing U+2500 section-rule dividers → `-`; `©`, `→`,
   `←`, `≠`, `≥`, `…` and the tree diagram `├─`/`└─` are kept, matching the
   existing vendored tree).
2. **No other adaptations needed this time:** the new test file derives keys
   from fixed hex via `hexToBytes` (no `node:crypto` `randomBytes`, so the
   jsdom `kp()` `Uint8Array.from` fix does not apply) and drives the
   machines through directly-typed `reduce*` calls (no generic `run()`
   harness, so the `readonly unknown[]` event-typing adaptation does not
   apply). The prior jsdom fixes in `attestationV2Validator.test.ts` /
   `attestationValidator.adversarial.test.ts` are untouched.

## Verified

- `npx vitest run src/baofund/court-core` → 11 files / 592 tests passed
- `npx vitest run src/hooks src/components/bao-court` → 257 passed
- `npx tsc --noEmit` → exit 0
- `npx vite build` → exit 0

---

# court-core vendor sync — bao-court v0.9.1 (6a5f30a)

Synced the v0.8.5→v0.9.1 delta into `src/baofund/court-core/` from
`baocommunity/bao-court` tag **v0.9.1** (6a5f30a; v0.8.6..v0.9.0 were the
multi-round ladder and property-sweep commits) and bumped the npm dep
`@bao/court` `#v0.8.5` → `#v0.9.1` (lockfile re-resolved via explicit
`npm install @bao/court@github:baocommunity/bao-court#v0.9.1`; resolves to the
exact tag commit 6a5f30a).

## What changed (multi-round ladder machine + round-3 findings fixes)

**Updated files:**
- `courtConfirmationMachine.ts` - the multi-round ladder machine: a
  `resolve_round` no longer settles a challenged case directly - it parks in
  the new `round_resolved` phase, where the host plays `concede` (the round
  outcome becomes final -> `fee_settlement`) or `escalate` (a new ladder
  round with an expanded roster, bounded by the new `maxLadderRounds` case
  param). Roster expansion rules (superset-of-previous allowed, roster >= 3
  enforced at creation - finding r3-6), per-round `roundFlip` /
  `outcomeHistory` records, and reputation-weighting across rounds
  (final-round weight 1.0, earlier rounds decayed).
- `validator.ts` - typed `CourtSignerSetError` family for `hashSignerSetRoot`
  (r3-5, message text unchanged); `validateCourtAttestation` guards
  `event.tags` and answers the typed `{ valid, error }` shape instead of a
  raw TypeError (r3-3); docstring-only cache-semantics note on the
  nostr-tools `verifyEvent` memoization (r3-4, no code change).
- `batchAttestation.ts` - `verifyCaseInBatch` validates the event shape
  (tags array) BEFORE the proof-leaf recomputation so malformed events get
  the typed `{ valid, reason }` result, never a raw TypeError (r3-2).

**New tests vendored:** `__tests__/multiRoundLadder.test.ts` (471 lines -
concede/escalate paths, roster expansion, ladder-cap enforcement),
`__tests__/propertiesConfirmation.test.ts` (732 lines, seeded property
sweep PC1-PC6 incl. the r3-6 roster rule), `__tests__/propertiesBatch.test.ts`
(526 lines, PB1-PB6d), `__tests__/propertiesValidator.test.ts` (465 lines,
PV1-PV6), `__tests__/r3Findings.test.ts` (178 lines, regression locks for
r3-2/r3-3/r3-5/r3-6). **Updated tests synced:** `adversarialMachines.test.ts`
+ `courtConfirmationMachine.test.ts` + `adversarialCrossModule.test.ts`
(concede/`round_resolved` inserted into the phase drivers/legality matrix;
the quorum-shortfall case moved to a 3-member roster per r3-6) and
`confirmationPipeline.test.ts` (first time vendored - end-to-end
confirmation pipeline with real Schnorr signatures).

## Client-local adaptations applied this sync

1. **ASCII dash normalization** as documented above (em/en/word-joiner
   dashes and box-drawing U+2500 section-rule dividers → `-`; `©`, `→`,
   `≥`, `…` and the ladder/tree diagram `├─`/`└─`/`┌─`/`─┐` glyphs are
   kept, matching the existing vendored tree).
2. **jsdom `kp()` fix, new location `confirmationPipeline.test.ts`:** its
   `keypair()` wraps the `node:crypto` `randomBytes(32)` in
   `Uint8Array.from(...)` (same cross-realm `abytes()` issue as the v0.8.1
   sync - jsdom vitest environment vs node:crypto Buffer realm). The
   property suites need no fix: they derive keys via `hexToBytes` (fresh
   jsdom-realm `Uint8Array`) or `finalizeEvent`.
3. **`run()` harness `readonly unknown[]` typing in
   `adversarialMachines.test.ts`** re-applied to the updated file (same
   rationale as v0.8.4 - the client tsconfig typechecks `__tests__`).
4. **Client hook impact checked:** `useCourtConfirmations` (and the
   bao-court components) derive status from OBSERVED relay events
   (kinds 38026/39015/39016/39018) and never reduce machine state, so the
   new `round_resolved` phase / `escalate`/`concede` events do not affect
   the read path; `verifyCaseInBatch`'s exported signature is unchanged.
   Hooks + bao-court suites pass unchanged.

## Verified

- `npx vitest run src/baofund/court-core` → 17 files / 674 tests passed
- `npx vitest run src/hooks src/components/bao-court` → 40 files / 257 passed
- `npx tsc --noEmit` → exit 0
- `npx vite build` → exit 0

---

# court-core vendor sync — bao-court v0.10.2 + PR #73 (a66baa4)

Synced the v0.9.1→v0.10.2 delta into `src/baofund/court-core/` from
`baocommunity/bao-court` tag **v0.10.2** (8910a88) plus main `a66baa4`
(PR #73, docs/proofs only — no engine surface) and bumped the npm dep
`@bao/court` `#v0.9.1` → `#v0.10.2` (lockfile re-resolved via explicit
`npm install @bao/court@github:baocommunity/bao-court#v0.10.2`; resolves to
the exact tag commit 8910a88). The upstream delta spans v0.9.2..v0.10.2:
clock ledgers (F-12), crypto-literature audit (A-1/A-2/A-3), adversarial
nostr/parser hardening, the unified error taxonomy (errors.ts), the
complexity pass machine/event splits, the shared test-helpers kit, and the
JSDoc/documentation rounds.

## What changed

**New modules (copied in clean):**
- `errors.ts` — unified `CourtError` taxonomy (code + invariant); 176 plain
  `throw new Error` sites upstream are now typed domain errors. Consumer
  impact: additive (names/messages unchanged; `instanceof CourtError` new).
- `eventsCommon.ts` + `eventsParse.ts` — `events.ts` split (parser
  hardening; `events.ts` keeps the public surface, imports unchanged).
- `confirmationMachineTypes.ts` / `confirmationMachineCore.ts` /
  `confirmationMachineHandlers.ts` — `courtConfirmationMachine.ts` split
  (reducer dispatch tables); public surface unchanged.

**Updated files:** all other engine modules refreshed to a66baa4
(crypto.ts PoK domain/concat-boundary hardening, courtSigningMachine/
courtDkgMachine monotonic clock ledgers, validator v2 pin enforcement +
dispatch tables, selection/signing/escrow/liquidEscrow/lnSettlement
reorganizations, index.ts re-exports).

**New tests vendored:** `invariantAssertions.test.ts` (v0.9.2),
`cryptoLiteratureAudit.test.ts` (v0.9.3), `adversarialNostr.test.ts`
(v0.9.4), `modelChecking.test.ts` + `modelCheckingCore.ts` +
`differentialParity.test.ts` + `reference/*` + `errorTaxonomy.test.ts`
(v0.10.1), `adversarialParserFuzz.test.ts` (v0.10.2, upstream rename of
`courtFuzz.test.ts` which this engine never vendored), the shared
`__tests__/helpers/` kit (#61) and `__fixtures__/model-check-summary.json`
(read by modelChecking.test.ts; upstream path layout works unmodified).

**Updated tests synced:** adversarialMachines, adversarialCrossModule,
attestationV2Validator, attestationValidator.adversarial, batchAttestation,
confirmationPipeline, courtConfirmationMachine, epochCohort, independentDkg,
multiRoundLadder, properties{Batch,Confirmation,Validator}, r3Findings,
regressions (all re-based onto the helpers kit where upstream did).

## Client-local adaptations applied this sync

1. **ASCII dash normalization** as documented above (em/en/word-joiner
   dashes → `-`; box-drawing U+2500 SECTION-RULE runs → `-`, tree-diagram
   glyphs `├─ └─ ┌─ ─┐ ┤` kept; `©`, `→`, `≤`, `≥`, `…`, `§` kept).
   `differentialParity.test.ts` carries raw binary fixture bytes and is
   copied byte-exact with NO normalization.
2. **jsdom `kp()` fix, relocated to `__tests__/helpers/keys.ts`:** upstream
   consolidated the keypair helpers into `schnorrKeypair()` /
   `schnorrKeypairHex()` (node:crypto `randomBytes`); both now wrap in
   `Uint8Array.from(...)` (same cross-realm `abytes()` issue as v0.8.1).
   With the consolidation, the per-file fixes from earlier syncs
   (attestationV2Validator, attestationValidator.adversarial,
   confirmationPipeline) are absorbed into the shared helper — those files
   now import `schnorrKeypair as kp` from helpers and need no local edit.
   `adversarialNostr.test.ts` `finalizeEvent(template, randomBytes(32))`
   got the same wrap at its call site.
3. **`run()` harness typing, relocated to `__tests__/helpers/machines.ts`:**
   upstream's `drive()` keeps `readonly E[]`; the client version is
   `readonly unknown[]` with a cast at the reduce call (same rationale as
   v0.8.4 — the client tsconfig typechecks `__tests__`, inline event
   literals widen `type` to `string`).
4. **Fixture path in `__tests__/helpers/fixtures.ts`:** upstream reads the
   fixture with `new URL('../../__fixtures__/…', import.meta.url)`; under
   the client's jsdom vitest environment `new URL` does not resolve
   relative hrefs against a `file:` base (it re-resolves against the
   document URL → ERR_INVALID_URL_SCHEME). Rewritten to the client pattern
   `dirname(fileURLToPath(import.meta.url))` + `join(...)`.
5. **Not vendored (unchanged policy):** upstream `docs/`, `scripts/`
   (reproduce.sh, cross-check.mjs, model-check.mjs, bench helpers), `bench/`
   — the engine carries code + tests + the committed model-check fixture
   only. The model-check EXPLORER script stays in bao-court; the committed
   fixture pins the full-sweep results for the vitest side.

## Verified

- `npx vitest run src/baofund/court-core` → 24 files / 838 tests passed
  (was 17 files / 674)
- `npx vitest run src/hooks src/components/bao-court` → 43 files / 277 passed
- `npx tsc --noEmit` → exit 0
- `npx vite build` → exit 0

---

# court-core vendor sync - bao-court v0.11.0 (eb91297)

Synced the a66baa4 -> v0.11.0 delta into `src/baofund/court-core/` from
`baocommunity/bao-court` tag **v0.11.0** (eb91297, "release: v0.11.0 -
review-response round + verification campaign") and bumped the npm dep
`@bao/court` `#v0.10.2` -> `#v0.11.0` (lockfile re-resolved via explicit
`npm install @bao/court@github:baocommunity/bao-court#v0.11.0`; resolves to the
exact tag commit eb912977c06a1ab2614bf0d021620926be8c10d9). The upstream delta
spans bao-court PRs #77-#88: the settlement-binding judge leaf (#78),
attribution (#84), the R25 quorum default (#85), the scale campaign (#86), the
mutation campaign (#87) and the docs/proofs rounds (#79-#83, #88).

## What changed

**New modules (copied in clean):**
- `attribution.ts` - attributable FROST signing sessions (Theorem 6,
  `docs/proofs/attribution.tex.md`). A bare FROST aggregate is an ordinary
  BIP-340 signature and attributes nothing; this module publishes the session
  as the evidence: `buildSigningJournal` (round-1 nonce commitments, round-2
  partials, signer set, threshold, aggregate), `hashSigningJournal`, and
  `verifyAggregateAttribution`, which re-verifies every partial against its
  signer's certified verification share, re-runs `s = sum s_i`, and checks the
  aggregate against the pinned group key - so a failing partial is attributed
  to its index and a non-reconstructing journal is itself evidence. Pure
  computation, no I/O; journalling is the host's job. Exports
  `SIGNING_JOURNAL_DOMAIN`, `AttributionError` and the journal types.
  **Consumer impact: additive** - nothing in the client imports it.

**Updated files:**
- `liquidEscrow.ts` - upstream #78 (settlement binding): new
  `buildCourtJudgeLeaf({winnerXOnly, groupXOnly})` and
  `isCourtJudgeLeaf(scriptHex, keys)`. The judge slot holds the standing
  cohort key and that key signs the SPEND's tapscript sighash in a second
  session; the builder refuses role collapse (winner == group) and non-x-only
  inputs, and produces bytes identical to `buildTaprootLeaves`'s judge leaf.
  The legacy single-oracle builder is byte-compatible and untouched. Doc
  comment now separates the two builders explicitly.
- `courtConfirmationMachine.ts` + `confirmationMachineCore.ts` +
  `confirmationMachineTypes.ts` - upstream #85 (**R25**): the factory DEFAULT
  `confirmQuorum` is now the roster supermajority `confirmSupermajority(N)` =
  ceil(2N/3) instead of 1 (one compromised juror could previously confirm every
  case). An explicit smaller quorum stays ALLOWED and every existing snapshot
  still restores; the factory RECORDS `quorumBelowSupermajority: boolean` in
  the state so policies and auditors can gate on it.
- `index.ts` - re-exports `confirmSupermajority`, the attribution surface and
  the two judge-leaf builders + their types.

**New tests vendored:** `__tests__/attribution.test.ts` (7 tests: forged
partial attribution, missing partial, non-reconstructing aggregate, wrong
signer set, verification-share pin, wrong group key, malformed-record
fail-closed), `__tests__/mutationClosures.test.ts` (the 8 spec holes the
upstream 53-mutant campaign found, closed with pins) and `__tests__/scale/`
(`corpus.ts`, `index.ts`, six seeded corpora + `scaleCampaign.test.ts` - the
CI-bounded FAST profile of every campaign: 250 confirmation sequences, 15,000
tallies, 40 Merkle batches, 250 real signed v2 attestations, 200 selection
draws, 100,000 canonical encodings).

**Updated tests synced:** `courtConfirmationMachine.test.ts` (+84 lines: the
R25 default/flag suite), `errorTaxonomy.test.ts` (+3: `AttributionError`) and
`invariantAssertions.test.ts` (+2: `SIGNING_JOURNAL_DOMAIN`).

**Not vendored (unchanged policy):** upstream `docs/`, `scripts/`, `bench/`,
`proofs/` and the release/paper files. The committed model-check fixture
(`__fixtures__/model-check-summary.json`), `__tests__/modelCheckingCore.ts` and
`__tests__/differentialParity.test.ts` were already at v0.11.0 bytes - no
change.

## Quorum check (the one machine-parameter change this round)

The client is unaffected, verified rather than assumed:
- No client code constructs a confirmation machine. The court hooks use only
  `batchAttestation` (`verifyCaseInBatch`) and `courtVoteMachine`
  (`hashCourtVerdict`); confirmation status is DERIVED from observed relay
  events (kind 39007/39018), so there is no quorum assumption to re-derive.
  `grep` for `confirmQuorum` / `createCourtConfirmationMachine` outside
  `src/baofund/court-core` returns nothing but the fund attestation panel's
  unrelated sat-weighted `quorumPct` helper.
- The vendored engine tests pin the old behaviour explicitly
  (`__tests__/helpers/machines.ts` `CONFIRM_DEFAULTS.confirmQuorum: 1`, which is
  upstream's own helper), so R25 changed no existing test's expectation.

## Client-local adaptations applied this sync

1. **ASCII dash normalization** as documented above, applied to every copied
   file (em/en/word-joiner dashes -> `-`; U+2500 section-rule runs ->
   `-` of the same width; tree glyphs, `©`, `→`, `≤`, `≥`, `…`, `§` kept).
2. **No new adaptations were needed:** upstream did not change
   `__tests__/helpers/{keys,machines,fixtures}.ts`,
   `__tests__/adversarialNostr.test.ts`, `__tests__/modelCheckingCore.ts` or
   `__tests__/differentialParity.test.ts` in this delta (diffs against v0.11.0
   are the client adaptations only, so they were left byte-unchanged). The new
   scale corpora use seeded generators and hex secrets - no `randomBytes`, so
   the jsdom `Uint8Array.from(...)` shim is not required.

## Verified

- `npx vitest run src/baofund/court-core` -> 27 files / 874 tests passed
  (was 24 / 838)
- `npx vitest run src/hooks src/components/bao-court` -> 42 files / 274 passed
  (a first run flaked on the unrelated `useCashuWallet.test.tsx`
  `waitFor` under host load; re-run green, and that file passes 62/62 alone)
- `npx tsc --noEmit` -> exit 0
- `npx vite build` -> exit 0

---

# court-core vendor sync - bao-court v0.12.0 (0364180)

Synced the v0.11.0 -> v0.12.0 delta into `src/baofund/court-core/` from
`baocommunity/bao-court` tag **v0.12.0** (0364180, "docs(changelog): remove
duplicated v0.12.0 section"; the release itself is 4d26c1c) and bumped the npm
dep `@bao/court` `#v0.11.0` -> `#v0.12.0` (`npm install
@bao/court@github:baocommunity/bao-court#v0.12.0`; the lockfile resolves to the
exact tag commit 0364180cc9d221cfb44cb14977d45de1c980547b). The upstream delta
spans bao-court PRs #89-#94: the round-2 audit (#90), the escalation-authority
witness machine change (#92), the derived economic cap + deterministic budget +
provenance reconciliation (#93) and the changelog dedup (#94).

## What changed

**Machine change (the one code change in this delta): the escalation move is
now witness-bound in the MACHINE, not the host API.**

- `confirmationMachineTypes.ts` - the `escalate` event gains `authority`
  (`'challenger' | 'host'`), `challengerIdx`, `challengerPubkey`,
  `requestHash`, `bondProofHash` and `roundIndex`; new
  `CourtEscalationAuthority` / `CourtEscalationRecord` types; the state gains
  the frozen `hostEscalation` policy flag (default false, fail-closed when
  absent) and the append-only `escalationLog`.
- `confirmationMachineHandlers.ts` - `onEscalate` previously IGNORED its event
  (a host that spoke the reducer directly kept the appeal power). It now
  validates: phase `round_resolved` + ladder cap; `roundIndex ===
  ladderRound + 1` (no replay onto a later round); `authority` must be one of
  the two; a challenger escalation needs a safe-integer roster index for a
  case participant, 32-byte lowercase hex pubkey/request/bond hashes, and a
  `bondProofHash` matching a bond the machine ALREADY accepted; a host
  escalation needs the frozen `hostEscalation` policy and must carry no
  challenger request. The accepted witness is appended to `escalationLog`.
- `confirmationMachineCore.ts` - `freezeState` deep-freezes the escalation log.
- `courtConfirmationMachine.ts` - factory records `hostEscalation` and an
  empty `escalationLog`; new `challengerEscalationEvent(state, now, witness)`
  and `hostEscalationEvent(state, now)` builders (they construct, the reducer
  verifies); `reduceCourtConfirmationMachine` normalises a pre-0.12 snapshot
  whose `escalationLog` is ABSENT to `[]` (a non-array value is still refused
  by `assertStateArrays`).
- `index.ts` - re-exports the two builders and the two escalation types.

**Vendored tests:**
- NEW `__tests__/escalationWitness.test.ts` (304 lines, 12 tests: unwitnessed
  escalate is a typed error, only `ladderRound + 1` opens, outsider challenger
  refused, malformed hashes refused, foreign bond refused, host authority
  refused by default / legal under the frozen policy, append-only log,
  pre-0.12 snapshot normalisation, `ladder_pending` reachable ONLY through a
  witnessed escalation).
- NEW `__tests__/helpers/budget.ts` (deterministic simulation budget helper,
  `SIM_BUDGET_MS`, default 30 s, replacing the 5 s wall-clock gate).
- Updated: `courtConfirmationMachine.test.ts`, `multiRoundLadder.test.ts`,
  `propertiesConfirmation.test.ts`, `adversarialMachines.test.ts`,
  `adversarialNostr.test.ts`, `mutationClosures.test.ts`,
  `scale/confirmationCorpus.ts`, `helpers/asserts.ts`, `helpers/machines.ts`,
  `modelChecking.test.ts`, `modelCheckingCore.ts` (probes the four illegal
  escalations at every reachable state),
  `__fixtures__/model-check-summary.json`.

**Not vendored (unchanged policy):** upstream `docs/` (`REVIEW_ROUND_2.md`,
`RELEASE_VERIFICATION_v0.11.0.md`, `FORMAL_INVARIANTS.md` INV-ESC-1..7,
paper), `scripts/` (`cross-check.mjs`, `mutation/pass2-postclosure.json`),
`bench/`, `proofs/`. `__tests__/simulateCourt.test.ts` stays unvendored (it has
never been part of the client subset).

## Hook/client check (the client is unaffected, verified not assumed)

- **No client code constructs a confirmation machine or plays `escalate`.**
  `grep` for `createCourtConfirmationMachine` /
  `reduceCourtConfirmationMachine` / `CourtConfirmationMachineEvent` /
  `escalationLog` / `ladder_pending` / `round_resolved` outside
  `src/baofund/court-core` returns nothing (the only "escalation" hits are the
  unrelated DM cool-down in `src/baofund/dm/`).
- The court hooks read EVENTS, not machine state: `useBaoCourtSelection` reads
  the kind-38030 selection event, `useBondEscrow` builds stake commitments,
  `useDemoCourtRoom`/`baoCourtSimulator` read votes/attestations. Confirmation
  status is derived from observed relay events (kind 39007/39018), so the new
  `escalationLog`/`hostEscalation` state fields have no reader to break.
- Event-shape risk is confined to the vendored engine's own tests, which are
  updated with the machine (the old bare `{type:'escalate', now}` literal is now
  a typed rejection by design - that is the fix, and `__tests__/helpers/
  machines.ts` gained the witnessed-move helpers upstream).

## Client-local adaptations applied this sync

1. **ASCII dash normalization, per file, matching each file's established
   convention** (the tree is not uniform, so the transform was inferred per
   file by reproducing the v0.11.0 bytes exactly before writing v0.12.0):
   em/en/figure/non-breaking dashes -> `-` and U+2500 runs -> `-` of the same
   width for `confirmationMachineCore.ts`, `confirmationMachineHandlers.ts`,
   `confirmationMachineTypes.ts`, `index.ts`, `escalationWitness.test.ts`,
   `helpers/budget.ts`, `helpers/asserts.ts`, `helpers/machines.ts`,
   `courtConfirmationMachine.test.ts`, `multiRoundLadder.test.ts`,
   `propertiesConfirmation.test.ts`, `adversarialMachines.test.ts`,
   `adversarialNostr.test.ts`, `mutationClosures.test.ts`,
   `scale/confirmationCorpus.ts`, `modelChecking.test.ts`;
   `courtConfirmationMachine.ts` keeps the single box glyphs that draw the
   phase diagram (`├─`, `─┐`) and flattens only the multi-character rules;
   `__tests__/modelCheckingCore.ts`, `__tests__/differentialParity.test.ts`
   and `__fixtures__/model-check-summary.json` stay raw upstream copies as
   before (they were never normalized - re-normalizing them would be a
   456-character diff of strings the model-check fixture asserts).
2. **`helpers/machines.ts` `drive()` cast re-applied** (`readonly unknown[]` +
   `event as E`): the client tsconfig typechecks `__tests__`, where inline
   event literals widen `type` to `string`.
3. **`adversarialNostr.test.ts` `Uint8Array.from(randomBytes(32))` re-applied**
   for the jsdom realm `instanceof` check in `@noble/curves`' `abytes()`.
4. No new adaptations were required: `helpers/keys.ts`, `helpers/fixtures.ts`
   and `differentialParity.test.ts` are not in this delta, and the new
   `escalationWitness.test.ts` / `helpers/budget.ts` use seeded or hex material
   (`randomBytes` only through the existing `helpers/keys.ts` wrapper), so the
   jsdom shims are already in place.

## Verified

- `npx vitest run src/baofund/court-core` -> 28 files / 886 tests passed
  (was 27 / 874; +1 file `escalationWitness.test.ts`, +12 tests)
- `npx vitest run src/hooks src/components/bao-court` -> 42 files / 274 passed
- `npx tsc --noEmit` -> exit 0
- `npx vite build` -> exit 0 (built in 7.98s; pre-existing chunk-size and
  cashuWallet dynamic-import warnings only)

---

# court-core vendor sync - bao-court v0.13.0 (c456fb4)

Synced the v0.12.0 -> v0.13.0 delta into `src/baofund/court-core/` from
`baocommunity/bao-court` tag **v0.13.0** (c456fb4) and bumped the npm dep
`@bao/court` `#v0.12.0` -> `#v0.13.0`.

## What changed

**Updated engine files (6):**
- `confirmationMachineTypes.ts`, `confirmationMachineHandlers.ts`,
  `confirmationMachineCore.ts`, `courtConfirmationMachine.ts` - **per-round
  escalation bond (R31, r30-1).** The bond was a membership test: one accepted
  challenge bond authorised every ladder round, so escalation was a free option
  worth `sum 3^r b0` at the protocol cap. New wire:
  `CourtEscalationRecord.roundBondProofHash`, `escalate.roundBondProofHash`, and
  the frozen policy `CourtConfirmationMachineState.requireRoundBond` (**default
  `false`**). `onEscalate` refuses an absent per-round witness when required,
  the relabelled membership bond, and a hash an earlier round consumed;
  `assertValidEscalationLog` re-derives all three rules at `finalize`.
  **Additive for this client**: no escalate path is constructed in app code, and
  the default keeps v0.12 semantics for existing cases/snapshots.
- `courtInbox.ts` - durable-inbox durability fix (T-1): provenance is capped at
  the first 64 distinct sources, so a wrap delivered by 65+ relays can no longer
  produce a snapshot `fromSnapshot` refuses (which lost the whole inbox on the
  next restart).
- `index.ts` - root re-exports for the three new economics modules.

**New modules (copied in clean):**
- `ladderEconomics.ts` - `deriveMaxLadderRounds`, `deriveLadderFlipRound`,
  `escalationOptionEv`, `ladderCapWithinBound`, `ladderSignBoundary`,
  `escalationBondMultiple`, `cumulativeLadderBondMultiple`.
- `penaltyAging.ts` - `agePenalties` / `pairedJurorWeight` (decay pairing at the
  commitment's `lambda = ln2/3`, anchored at the weight floor).
- `quorumEconomics.ts` - `captureProbability`, `quorumCapCorrection`.

**Tests vendored (8 new files, +106 tests):** `ladderEconomics`,
`penaltyAging`, `perRoundBond`, `quorumEconomics`, `reviewRound3`,
`r30SealGames`, `r30MarmotTransport`, `r30InboxOutboxLoad`; plus updated
`escalationWitness`, `modelChecking`(+`Core`), `helpers/fixtures`,
`helpers/machines`, the `scale/` corpora + `witnessCorpus` /
`epochRotationCorpus` / `finalityCorpus`, and `__fixtures__/model-check-summary.json`.

**Deliberately not vendored:**
- `__tests__/r30MultiProcessCeremony.test.ts` - it drives
  `scripts/court/multi-process-ceremony.mjs` through `tsx`; this client vendors
  neither the engine's `scripts/` tree nor `tsx`, so the gate cannot run here.
  Upstream bao-court CI keeps it.
- `docs/` and `scripts/` deltas (`PER_ROUND_BOND.md`, `REVIEW_ROUND_3.md`,
  `MULTI_PROCESS_CEREMONY.md`, proofs, campaign harnesses) - unchanged
  convention: this client vendors the engine + tests + fixtures only.

## Client-local adaptations preserved

1. **ASCII dash normalization** re-applied to the engine sources and the
   vendored tests (em/en dashes and box-drawing rules -> `-`; single `─`
   adjacent to a diagram tee/corner is kept).
2. **`__tests__/modelCheckingCore.ts` and `__fixtures__/model-check-summary.json`
   stay RAW upstream copies**, per the v0.12.0 note - they are asserted
   against each other, so normalizing one (or both) is a string diff for no
   behaviour change.
3. **`helpers/machines.ts` `drive()` cast**, **`helpers/keys.ts`
   `Uint8Array.from(randomBytes(...))`** and **`helpers/fixtures.ts`
   dirname+join path resolution** re-applied (three-way merge, clean) - the
   jsdom realm shims.
4. No new adaptations were required: `adversarialNostr.test.ts` and
   `differentialParity.test.ts` are not in this delta.

## Verified

- `npx vitest run src/baofund/court-core` -> 36 files / 992 tests passed
  (was 28 / 886; +8 files / +106 tests)
- `npx vitest run src/hooks src/components/bao-court` -> 42 files / 274 passed
- `npx tsc --noEmit` -> exit 0
- `npx vite build` -> exit 0 (pre-existing chunk-size / dynamic-import warnings only)

# court-core vendor sync - bao-court v0.13.1 (bedb476)

Synced the v0.13.0 -> v0.13.1 delta into `src/baofund/court-core/` from
`baocommunity/bao-court` tag **v0.13.1** (bedb476, verified: the tag points at
origin/main on the day of the sync) and bumped the npm dep
`@bao/court` `#v0.13.0` -> `#v0.13.1` (lockfile resolved sha
`bedb476ec1ce3589a6e28d49f40661ac8e794ed1`).

Delta = bao-court PRs #102-#106: the Byzantine-relay ceremony campaign (R33),
the review-round-4 attack on the v0.13 surface, the registered-findings sweep
(R34), the round-35 readiness review and the release bump.

## What changed

**Updated engine files (4):**
- `confirmationMachineCore.ts`, `confirmationMachineHandlers.ts` - two
  review-round-4 machine fixes, both *stricter*, neither adds a wire field:
  - **two-challenger bond billing (r33-1, exploitable, fixed).** The reducer
    compared a round bond only with the *escalator's own* membership bond, so
    juror B could bill its rung to juror A's accepted challenge bond: A's
    witness burned, B free, the wrong payer in the ledger. `onEscalate` and
    `assertValidEscalationLog` now refuse ANY already-accepted challenge bond.
  - **complete escalation ledger + barrier before every rung (r33-5,
    exploitable, fixed).** The barrier's "short log" exemption (kept for
    pre-0.12 snapshots) was a free option once log records consume bond hashes:
    deleting a record un-consumed its bond. The barrier now demands one record
    per opened round whenever the log is non-empty or `requireRoundBond` is
    true, and `onEscalate` re-runs it before opening a rung (previously only
    `onFinalize` did), so a restored snapshot cannot seat a panel on a spent
    bond and then brick at finalize. The legacy deletion residual
    (`requireRoundBond` false, no records) is documented and pinned.
  **Additive for this client**: no escalate path is constructed in app code,
  no snapshot shape changes, and every existing case restores unchanged.
- `ladderEconomics.ts` - **sign-based bound (r33-6, exploitable, fixed).**
  `deriveMaxLadderRounds` clamped to `[1, MAX_LADDER_ROUNDS]`, so at
  `a_f <= rho/(rho+beta)` it returned `1` and `ladderCapWithinBound` blessed a
  *profitable* first rung, contradicting its own `E[pi] < 0 for every R <=
  derived` contract. `0` now means "no safe depth" (upward-only clamp) and
  `ok` is decided by the sign (`maxLadderRounds < deriveLadderFlipRound`), not
  by comparing with `derivedCap`. **Consumer impact: none in-tree** - nothing
  in the client reads `derivedCap`; any future host must treat `0` as "refuse
  every ladder".
- `penaltyAging.ts` - **`Infinity` from finite overflow (r33-9, fixed).**
  `pairedJurorWeight` rejects a non-finite `earned` weight (finite `w0` and a
  finite `bonusMultiplier` can still overflow `Number.MAX_VALUE`), because the
  weight is a lottery/selection input and `Infinity` silently dominates every
  downstream comparison.

**Tests vendored:**
- `__tests__/reviewRound4.test.ts` (NEW, 487 lines) - every case is either a
  CLOSURE (red before the fix) or a named `(registered ...)` pin, so a future
  fix turns the pin red on purpose. Imports only the engine root + helpers.

**Deliberately not vendored (unchanged convention):**
- `__tests__/r33ByzantineRelay.test.ts` (NEW upstream) and the updated
  `__tests__/r30MultiProcessCeremony.test.ts` - both drive
  `scripts/court/multi-process-ceremony.mjs` through a child process; this
  client vendors neither the engine's `scripts/` tree nor `tsx`.
  `__tests__/simulateCourt.test.ts` (updated upstream) imports
  `../scripts/simulateCourt`, which is not vendored either.
- `docs/` and `scripts/` deltas (`REVIEW_ROUND_4.md`, `READINESS_REVIEW.md`,
  `MULTI_PROCESS_CEREMONY.md`, `PER_ROUND_BOND.md`, the refreshed paper,
  proofs, campaign harnesses) - engine + tests + fixtures only, as always.

## Client-local adaptations preserved

1. **ASCII dash normalization** re-applied to the four engine files and the new
   test: em dash (U+2014), en dash (U+2013) and box-drawing U+2500 runs -> `-`, with a
   single `─` kept only when adjacent to another box-drawing glue character
   (the state-diagram tees/corners in `courtConfirmationMachine.ts`). The
   normalizer reproduces all 107 previously-synced files byte-for-byte, so the
   transform is unchanged.
2. **`__tests__/modelCheckingCore.ts` and `__fixtures__/model-check-summary.json`
   stay RAW upstream copies** (`differentialParity.test.ts` likewise), per the
   v0.12.0 note - they are asserted against each other.
3. The three jsdom realm shims (`helpers/machines.ts` `drive()` cast,
   `helpers/keys.ts` `Uint8Array.from(randomBytes(...))`, `helpers/fixtures.ts`
   dirname+join) and the `adversarialNostr.test.ts` `Uint8Array.from` shim were
   not in this delta - untouched.
4. No new adaptations required. `helpers/ids.ts` used by the new test is
   already vendored and unmodified upstream.

## Verified

- `npx vitest run src/baofund/court-core` -> 37 files / 1,013 tests passed
  (was 36 / 992; +1 file / +21 tests from `reviewRound4`)
- `npx vitest run src/hooks src/components/bao-court` -> 46 files / 319 passed
- `npx tsc --noEmit` -> exit 0
- `npx vite build` -> exit 0 (pre-existing chunk-size / dynamic-import warnings only)
- The R35 client security fixes (#210) are untouched by this sync: the delta is
  engine-only plus the dep bump, and the client suite above covers them.

# court-core vendor sync - bao-court head bd5e788 (post-v0.13.1, next release v0.13.2)

Synced the v0.13.1 -> head delta into `src/baofund/court-core/` from
`baocommunity/bao-court` **head `bd5e788`**
(`bd5e788670d95f9c7e23dab58e62313a3e7b6ad9` = `origin/main`, three commits past
tag `v0.13.1`/`bedb476`; `git describe` = `v0.13.1-3-gbd5e788`) and pinned the
npm dep `@bao/court` `#v0.13.1` -> `#bd5e788670d95f9c7e23dab58e62313a3e7b6ad9`
(lockfile resolved sha updated to the same commit). **No new tag exists
upstream**, so the package `version` stays `0.13.1`; the next release is
v0.13.2. The sha was resolved from GitHub directly
(`git ls-remote https://github.com/baocommunity/bao-court refs/heads/main`).

Delta = bao-court PRs #107 (review round 5), #108 (mutation campaign 2) and
#109 (review round 6).

## What changed

**Updated engine files (3), all *stricter*, none adds a wire field - every
existing case/snapshot restores unchanged:**
- `confirmationMachineHandlers.ts`, `confirmationMachineCore.ts` - **one bond
  witness, one challenger (r38-1, exploitable, fixed).** The challenge ledger
  deduped by `idx` only, so a juror that posted nothing could name a bonded
  juror's `bondProofHash` as its own, mint an "accepted" challenge with a bond
  it never paid, and then escalate: the `(idx, bondProofHash)` pair test of
  r29-1 is satisfied once the borrowed record exists, and the r33-1 rule ("no
  accepted challenge bond may be relabelled as a per-round bond") assumes the
  hash has exactly one owner. `onAcceptChallenge` now refuses a proof hash
  already bound to another roster index and `assertValidConfirmationLedger`
  re-derives the same uniqueness on restore (a STATE property: the machine
  holds the ledger).
- `confirmationMachineHandlers.ts` - **borrowed standing at `escalate` (r40-1,
  exploitable, fixed).** `onEscalate` ran only the *log* barrier while its
  witness test reads `state.challenges`, so a hand-restored snapshot binding one
  hash to two indices satisfied `(idx, bondProofHash)` for a juror that posted
  nothing: a rung opened on a borrowed bond, a round panel was seated, and the
  case could then only brick at `resolve_round`. `onEscalate` now re-derives the
  challenge ledger before the witness is used.
- `confirmationMachineHandlers.ts` - **`open_ladder_round` ran NO barrier
  (r40-2, exploitable, fixed).** It is the transition that actually spends a
  panel seat, and it validated the round number, cap, deadline and roster only:
  a restored `ladder_pending` snapshot with the escalation record DELETED still
  opened round k+1, un-consuming the bond that record paid with and bricking
  later at `resolve_round`. It now runs `assertValidEscalationLog` **and**
  `assertValidConfirmationLedger` first. No consumer impact for legal states (a
  640-state legal-state hunt across every policy/ladder/authority combination is
  pinned upstream, 0 refusals).
- `confirmationMachineCore.ts` - **`ladder_pending` round bound (r37-1, fixed
  in #108).** The completeness rule knew about the `ladder_pending` half-step,
  the "round the case never opened" check did not, so the barrier refused the
  very mid-escalation snapshots a host legitimately restores. The bound now
  includes the pending rung.
- `confirmationMachineTypes.ts` - JSDoc only: `bondProofHash` uniqueness is a
  state invariant, and the registered residual **r40-3** (uniqueness is not
  ownership - a derivable witness is first-come-first-served, so the host's bond
  verifier must bind the witness to the event author). Nothing in this client
  derives a witness.

**Tests vendored:** `__tests__/reviewRound5.test.ts` (NEW, 750 lines),
`__tests__/reviewRound6.test.ts` (NEW, 936 lines) and
`__tests__/mutationClosuresV013.test.ts` (NEW, 144 lines). All three import only
the vendored engine + `helpers/ids.ts` (already vendored, unmodified upstream).

**Deliberately not vendored (unchanged convention):**
- `docs/` deltas (`REVIEW_ROUND_5.md`, `REVIEW_ROUND_6.md`,
  `MUTATION_TESTING_V013.md`, refreshed `MUTATION_TESTING.md`,
  `PER_ROUND_BOND.md`, `FORMAL_INVARIANTS.md`, `CHANGELOG.md`) - engine + tests
  + fixtures only, as always.
- `scripts/mutation/` (`check-catalogue.mjs` NEW, `mutants.mjs`,
  `run-mutants.mjs`, `spot-check.mjs`, the two `pass*-v013*.json` run artefacts) -
  this client vendors no `scripts/` tree and no `tsx`.

## Client-local adaptations preserved

1. **ASCII dash normalization** re-applied to the three engine files and the
   three new tests: em dash (U+2014), en dash (U+2013), U+2011 and box-drawing
   U+2500 -> `-`. None of the six files carries a box-drawing glue character, so
   the "keep a single `-` adjacent to a tee/corner" exception did not apply and
   the result is byte-identical to the normalizer's output. The three engine
   files are byte-equal to normalized upstream head; the rest of the vendored
   tree was already at v0.13.1 parity.
2. **The hunk-level apply, not a file overwrite**: the three engine files were
   patched with only the upstream hunks so pre-existing normalized text is
   untouched.
3. **`__tests__/modelCheckingCore.ts`, `__tests__/differentialParity.test.ts`
   and `__fixtures__/model-check-summary.json` stay RAW upstream copies** (they
   are asserted against each other) - untouched, not in this delta.
4. The three jsdom realm shims (`helpers/machines.ts` `drive()` cast,
   `helpers/keys.ts` `Uint8Array.from(randomBytes(...))`, `helpers/fixtures.ts`
   dirname+join) and the `adversarialNostr.test.ts` `Uint8Array.from` shim were
   not in this delta - untouched.

## Verified

- `npx vitest run src/baofund/court-core` -> 40 files / 1,066 tests passed
  (was 37 / 1,013; +3 files / +53 tests from the three new suites)
- `npx vitest run src/baofund/court-core/__tests__/{reviewRound5,reviewRound6,mutationClosuresV013}.test.ts`
  -> 3 files / 53 tests passed
- `npx vitest run src/hooks src/components/bao-court` -> 49 files / 351 passed
- `npx tsc --noEmit --incremental false` -> exit 0
- `npx vite build` -> exit 0

# court-core vendor sync - bao-court v0.13.2 (8bac1bc)

Synced the bd5e788 -> v0.13.2 delta from `baocommunity/bao-court` tag
**v0.13.2** (`8bac1bc` = release commit, one commit before `origin/main`
`1b33b2f`) and pinned the npm dep `@bao/court`
`#bd5e788670d95f9c7e23dab58e62313a3e7b6ad9` -> `#v0.13.2` (lockfile re-resolved
via `npm install --package-lock-only @bao/court@github:baocommunity/bao-court#v0.13.2`;
resolves to the exact release commit `8bac1bc298c88e5b7ed1eb8e63d77f4361d7f18f`,
version `0.13.2`).

## What changed

**No engine change.** `git diff --stat bd5e788..v0.13.2` is docs/manifest only
(`CHANGELOG.md`, `README.md`, `docs/CROSS_CHECK.md`,
`docs/FROST_COURT_ORACLE_PAPER.md`, `package.json` version) - the v0.13.2
machine behaviour (review-rounds 4-6 fixes, sign-based ladder bound, strict
round-bond default) was already vendored in the previous bd5e788 sync. The
post-tag commit `1b33b2f` (#111) adds `docs/REVIEWS_INDEX.md` plus cross
references, also docs-only. **`src/baofund/court-core/` is byte-unchanged by
this sync**, and no client adaptation had to be re-applied.

**Review round 7 is not vendored: it is in flight upstream.** The reviews index
records it as "in flight at the time of this index" and `docs/REVIEW_ROUND_7.md`
does not exist at `origin/main`; it arrives with its own upstream PR.

**Changed files in this sync (2):** `package.json` (dep pin) and
`package-lock.json` (resolved sha + version). Docs deltas stay unvendored, as
always (engine + tests + fixtures only).

## Verified

- `npx vitest run src/baofund/court-core` -> 40 files / 1,066 tests passed
  (unchanged from the bd5e788 sync - docs-only delta)
- `npx vitest run src/hooks src/components/bao-court` -> 49 files / 351 passed
- `npx tsc --noEmit --incremental false` -> exit 0
- `npx vite build` -> exit 0

# court-core vendor sync - bao-court v0.14.0 (081fb8c)

Synced the v0.13.2 -> v0.14.0 delta from `baocommunity/bao-court` tag
**v0.14.0** (`081fb8c` = release commit, bao-court #114) and pinned the npm dep
`@bao/court` `#v0.13.2` -> `#v0.14.0` (lockfile re-resolved via
`npm install --package-lock-only @bao/court@github:baocommunity/bao-court#v0.14.0`;
resolves to the exact release commit
`081fb8cc688343fcc47bfaca797365617dbd8de1`, version `0.14.0`).

Delta = bao-court PRs **#112** (review round 7 - the r41-1 finality forgery) and
**#113** (the escalation request wire, H-6) plus the release bump.

## What changed

**Updated engine files (3) + 1 new module:**
- `confirmationMachineHandlers.ts` - **`finalize` minted a verdict from a vote
  ledger it never re-derived (r41-1, exploitable; fixed).** For a CHALLENGED
  case the verdict's evidence is the LAST round's vote ledger (`ladder.votes` ->
  `supportingEventIds` -> the hash preimage). `resolve_round` re-derives it, but
  a restore skips transitions and `finalize` validated the confirmation ledger,
  the outcome history and the escalation log - not the votes. A snapshot parked
  at `fee_settlement` (reachable through `concede`, an entry round 6 had recorded
  as a non-reader of the challenge pool) could carry duplicate ballots,
  off-roster voters or an outcome outside the frozen ballot, and `finalize`
  returned `final` with that outcome and a canonical `verdictHash` - the market
  pays the side both panels voted against. `finalize` now runs
  `assertValidMassVoteLedger` (challenged cases only) and re-derives the verdict
  from the append-only `outcomeHistory` record via the new `deriveFinalVerdict`,
  requiring the vote ledger to agree on round, majority and the exact winning
  event-id set; the supporting set comes from the HISTORY, not the
  attacker-shaped vote list. **`verdict.upheld`** was copied from the snapshot
  and is not in the hash preimage (a restore could flip the meaning of a verdict
  whose hash still verified) - it is derived now
  (`record.outcome === proposedOutcome`) and a disagreeing pending verdict is
  refused with a typed `CourtConfirmationTransitionError`. **Consumer impact
  here: none for legal states** - a 40-flow walk (both policies x both
  authorities x depths 1-5 x never-challenged) finalizes identically and mints
  identical hashes, and this client constructs no confirmation machine (hooks
  derive status from relay events).
- `courtEscalationRequest.ts` (NEW, 317 lines) - **the challenger's escalation
  request as a versioned wire codec carrying the per-round bond witness (H-6).**
  The machine has accepted `roundBondProofHash` since R31 and strict is the
  default for new cases since v0.13.2, but the artefact a client could submit had
  no field for it: the host body is `additionalProperties: false` and the
  request-hash preimage omitted the witness, so a strict case's escalation was
  refused no matter what a client sent (transport could not precede
  enforcement), and two different round bonds hashed to one request hash.
  Surface: `buildCourtEscalationRequest` (validate + normalise),
  `serializeCourtEscalationRequest` / `parseCourtEscalationRequest` (canonical
  JSON, strict about unknown fields - a silently dropped field is the defect),
  `courtEscalationRequestPreimage` / `hashCourtEscalationRequest` (**domain
  v2**, witness in the preimage, `'-'` sentinel when absent) and
  `escalationRequestToMachineEvent` (the reducer's `escalate` event: the wire
  supplies the challenger's claims, the CASE supplies `challengerIdx`,
  `roundIndex` and `now`). **Additive: nothing in the client imports it** - the
  escalation UI still emits decisions, so adopting the v2 wire is a follow-up.
- `index.ts` - re-exports the new module (`COURT_ESCALATION_REQUEST_DOMAIN`,
  `COURT_ESCALATION_REQUEST_VERSION`, `MAX_ESCALATION_REQUEST_ROUND`, the
  builders/codec/hash/to-event helpers and the `CourtEscalationRequest` type).
- `ladderEconomics.ts` - JSDoc only: `deriveMaxLadderRounds`'s monotonicity
  sentence ran backwards (measured grid 0.30...0.95 -> caps 0...5, so a LESS
  accurate jury gets the SHALLOWER ladder); corrected and pinned (r41-T1-doc).

**Tests vendored:** `__tests__/reviewRound7.test.ts` (NEW, 19 cases: the four
r41-1 closures - all red on the previous head - the non-reader probes, the
over-strictness walk, the sign-rule edge probes and two doc pins) and
`__tests__/escalationRequestWire.test.ts` (NEW, 12 cases: round-trip, the strict
wire-refusal matrix, the strict path ACCEPTING a transported round bond, the
hash binding the witness, a pinned known-answer digest and the doc pin). Both
import only vendored engine modules + `helpers/ids.ts`.

**Deliberately not vendored (unchanged convention):** the `docs/` delta
(`REVIEW_ROUND_7.md` NEW, `PER_ROUND_BOND.md`, `FORMAL_INVARIANTS.md`) and
`CHANGELOG.md` - engine + tests + fixtures only, as always.

## Client-local adaptations preserved / applied this sync

1. **ASCII dash normalization** re-applied to the three engine files and the two
   new tests: em dash (U+2014), en dash (U+2013), U+2011 and box-drawing U+2500
   -> `-`. The three engine files are byte-equal to normalized upstream v0.14.0
   (verified: normalizing the 1b33b2f copies reproduces this tree byte-for-byte,
   so the diff is exactly the upstream delta - 132/13/7 lines).
2. **jsdom file-read shim in `__tests__/reviewRound7.test.ts`.** jsdom does not
   resolve a relative href against a `file:` base, so `readFileSync(new URL(rel,
   import.meta.url))` throws `The URL must be of scheme file` (upstream runs the
   node environment). The one live `readFileSync(new URL(...))` (r41-T1-doc,
   which reads the vendored `ladderEconomics.ts`) now uses the documented
   `dirname(fileURLToPath(import.meta.url))` + `join` pattern, same shim as
   `helpers/fixtures.ts`. Same class as the previously recorded shims.
3. **Two doc pins are `it.skip`ped, not weakened:** each
   reads upstream documents this tree does not vendor
   (`docs/PER_ROUND_BOND.md`, `docs/FORMAL_INVARIANTS.md`) -
   `escalationRequestWire` "PER_ROUND_BOND.md says the transport ships BEFORE
   the policy is enforced" and `reviewRound7` "(r41-T4) the upgrade checklist
   and the entry-matrix correction are IN the docs". Both are marked with an
   `ADAPTED (2140wtf)` comment at the call site. The ordering they pin is stated
   in the vendored `courtEscalationRequest.ts` header and the r41-1 behaviour is
   pinned by the four closures, so no executable claim is lost.
4. Upstream's `docs/REVIEW_ROUND_7.md` records review round 7; it is not
   vendored here (docs convention), so the round's findings are summarised in
   this section instead.

## Verified

- `npx vitest run src/baofund/court-core` -> 42 files, 1,095 passed / 2 skipped
  (was 40 / 1,066; +2 files, +29 passing, +2 documented skips = 31 new cases)
- `npx vitest run src/baofund/court-core/__tests__/{reviewRound7,escalationRequestWire}.test.ts`
  -> 2 files / 29 passed / 2 skipped
- `npx vitest run src/hooks src/components/bao-court` -> 49 files / 351 passed
- `npx vitest run src/baofund/lib/codecSafety.test.ts` -> 9 passed
- `npx tsc --noEmit --incremental false` -> exit 0
- `npx vite build` -> exit 0

---

# court-core vendor sync - bao-court v0.14.1 (bc28ff3)

Synced the v0.14.0 -> v0.14.1 delta from `baocommunity/bao-court` tag
**v0.14.1** (`bc28ff3` = release commit, bao-court #116) and pinned the npm dep
`@bao/court` `#v0.14.0` -> `#v0.14.1` (lockfile re-resolved via
`npm install --package-lock-only @bao/court@github:baocommunity/bao-court#v0.14.1`;
resolves to the exact release commit
`bc28ff3404ce2546fe9cb2f6de25419b2dbd9a9d`, version `0.14.1`).

Delta = bao-court PR **#115** (review round 8 - the escalation transport attacks)
plus the release bump #116.

## What changed

**Updated engine files (3):**
- `courtEscalationRequest.ts` (+321/-33) - **review round 8, four defects in the
  codec, two of them exploitable.**
  - **r8-2 (exploitable): the wire->reducer mapping bound nothing.**
    `escalationRequestToMachineEvent` filled `challengerIdx` from the bond owner
    and then forwarded the wire's `challengerPubkey`, implying a pairing it
    cannot see (the machine state carries indices, not pubkeys). Measured on
    v0.14.0: a bonded challenger minted an escalation whose append-only
    `escalationLog` named **another juror's** pubkey (attribution forgery, the
    r29-2 harm at mint time); a request signed to escalate past round 1 was
    accepted at round 3 (`roundIndex` comes from the case, the wire `round` was
    inert, so it was replayable on every rung of a legacy case); and a request
    for one case reduced on another (`caseId` was hashed but never compared).
    The mapper now REQUIRES the host's `CourtEscalationBinding` - the case id it
    ROUTED on and the pubkey NIP-98 PROVED - and refuses a disagreement with
    either, or a `round` that is not the round being resolved; an ambiguous bond
    ledger (one hash, two owners) is refused rather than resolved by
    `Array.find`. **Source-compatible** (the 4th parameter is optional in the
    type) but behaviour-breaking by design: a 3-argument call now throws instead
    of minting an unbound escalation.
  - **r8-1 (exploitable): `caseId` was encoded lossily.** The preimage is
    `TextEncoder`-encoded and an unpaired UTF-16 surrogate becomes U+FFFD, so
    `"...:1\uD800"` and `"...:1\uFFFD"` - two different ids, two different
    wires - produced the SAME request hash (the r7 H-6 collision one field
    over, on the value hosts dedupe and audit by). `caseId` is now canonical
    UTF-8, NUL-free and bounded at `MAX_ESCALATION_CASE_ID_BYTES` (256), which
    makes the encoding injective (2,000-id sweep pinned).
  - **r8-3/r8-4/r8-5:** `concession` was a truthiness test (`"true"`, `1`, `{}`,
    `null` all parsed to `false`, dropping a signed flag the hash committed to)
    - a non-boolean is now a typed refusal at `parse` and at `build`; `parse`
    resolved DUPLICATE JSON keys silently (`JSON.parse` keeps the last, so one
    digest covered many byte strings and an auditor read a witness the machine
    never saw) - the raw text is now scanned at depth 1 (after decoding, so
    `"c\u0061seId"` counts) and a repeated field is a typed refusal, with the
    host contract "hand `parse` the body text, not a parsed object"; and `build`
    read every field TWICE (a getter/`Proxy` could fail the check on one value
    and populate another, or escape as a raw `TypeError`) - fields are now
    snapshotted exactly once.
- `confirmationMachineHandlers.ts` (+14) - **r8-6: `resolve_round` appended onto
  a history that outran nothing.** A restored `ladder_vote_closed` snapshot with
  `ladderRound = 4` and ONE record appended round 4, producing `[1,4]` - a
  history no later barrier accepts, so the case could never finalize again (the
  r40-2 brick, value-locked). `onResolveRound` now requires
  `outcomeHistory.length === ladder.round - 1`, which the live path always
  satisfies; a legal two-round ladder still resolves `[1,2]` (pinned).
- `index.ts` (+2) - re-exports `MAX_ESCALATION_CASE_ID_BYTES` and the
  `CourtEscalationBinding` type. **No new subpath** in this delta.

**Tests vendored:** `__tests__/reviewRound8.test.ts` (NEW, 694 lines / 34 cases
- 13 red on v0.14.0: the two exploitable closures, the four PARTIAL closures,
  the four finality paths re-attacked from the outside, the registered
  consistent-forgery boundary and the over-strictness controls) and
  `__tests__/escalationRequestWire.test.ts` (+13 lines - the new host binding is
  threaded through the six mapping calls). Both import only vendored engine
  modules + `helpers/ids.ts`.

**Deliberately not vendored (unchanged convention):** the `docs/` delta
(`REVIEW_ROUND_8.md` NEW, `PER_ROUND_BOND.md`, `REVIEWS_INDEX.md`) and
`CHANGELOG.md` - engine + tests + fixtures only, as always.

**Consumer impact here: none yet.** Nothing in the client constructs an
escalation request or a confirmation machine (hooks derive status from relay
events, the escalation UI emits decisions), so the binding is a follow-up, not a
break. Both machine changes are *stricter*: no wire field was added, so existing
cases/snapshots restore unchanged, and a host restoring a tampered snapshot gets
a typed refusal where it used to brick.

## Client-local adaptations preserved / applied this sync

1. **ASCII dash normalization** re-applied to the three engine files and the two
   tests (em dash U+2014, en dash U+2013, U+2011, box-drawing U+2500 -> `-`).
   Verified by reproduction: normalizing the `081fb8c` copies reproduces this
   tree byte-for-byte, so the diff is exactly the upstream delta (14/321/2
   lines on the engine files).
2. **The doc pin stays `it.skip`ped, not weakened** -
   `escalationRequestWire` "PER_ROUND_BOND.md says the transport ships BEFORE
   the policy is enforced" reads an upstream document this tree does not vendor.
   The ordering it pins is stated in the vendored `courtEscalationRequest.ts`
   header, which IS asserted by the wire suite above. Marked with an
   `ADAPTED (2140wtf)` comment at the call site.
3. **No new jsdom shim needed:** `reviewRound8.test.ts` performs no file reads
   (its only `docs/` reference is a comment naming `REVIEW_ROUND_8.md`), so the
   `dirname`+`join` shim recorded for `reviewRound7` is untouched.
4. Upstream's `docs/REVIEW_ROUND_8.md` records review round 8; it is not
   vendored here (docs convention), so the round's findings are summarised in
   this section instead.

## Verified

- `npx vitest run src/baofund/court-core` -> 43 files, 1,129 passed / 2 skipped
  (was 42 / 1,095 / 2; +1 file, +34 passing = the 34 round-8 cases)
- `npx vitest run src/baofund/court-core/__tests__/{reviewRound8,escalationRequestWire}.test.ts`
  -> 2 files / 45 passed / 1 skipped (the vendored doc pin)
- `npx vitest run src/hooks src/components/bao-court` -> 49 files / 351 passed
- `npx vitest run src/baofund/lib/codecSafety.test.ts` -> 9 passed
- `npx tsc --noEmit --incremental false` -> exit 0
- `npx vite build` -> exit 0

---

# court-core vendor sync - bao-court v0.15.0 (fe47ba4)

Synced the v0.14.1 -> v0.15.0 delta from `baocommunity/bao-court` tag
**v0.15.0** (`fe47ba454deb28832fe35ca373746adb740eead3` = release commit,
bao-court #126) and pinned the npm dep `@bao/court` `#v0.14.1` -> `#v0.15.0`
(lockfile re-resolved to the exact release commit; installed version `0.15.0`).

Delta = bao-court PR **#120** (independent Python wire + 100k differential),
**#121** (10x corpus), **#122** (review round 10), **#123/#124** (Lean 4 ladder
+ escalation ledger, Apalache), the **R52 exact ladder bound** and the release
bump #126.

## What changed

**Updated engine files (6):**

- `ladderEconomics.ts` (+233) - **SEMANTICS, not docs.** `deriveMaxLadderRounds`
  is now the safe predicate itself: `max{d : R*D^d < A^d*(R+B)}`, evaluated in
  `BigInt` on the exact rational each parameter's decimal text names (`0.03`
  -> `3/100`, not the nearest double). No logarithm and no floating-point
  comparison remain on the decision path; `0` still means "no safe depth".
  **Seven exact-boundary rows changed** (`a_f = 1/2` with `beta = 3rho/7rho/
  15rho/31rho` -> caps 1/2/3/4, were 2/3/4/5; `beta = 7rho/9` -> 1, was 2) and
  `derivedCap = flipRound - 1` is now an **equality**; every `rho = beta`
  configuration (flip 7/5/4/3/2, cap 5/4/3/2/1) is unchanged. `rho + beta`
  overflow no longer reads as a perfect jury. **Client impact: none** - nothing
  in this tree reads the ladder bound (it is the HOST's creation-time gate;
  the client only renders court status).
- `courtEscalationRequest.ts` (+397) - r9-1 case ids validated EXACTLY (the
  `trim()` fold gave one digest to `"court:X "`, `"court:X\t"` and
  `"court:X\u3000"`; the host binding no longer folds symmetrically), r9-2
  `bondTxid` COMPARED with the accepted challenge record, r9-3 a signed
  CONCESSION can no longer be minted as an ESCALATION, r9-4 the mapper refuses
  a snapshot whose `ladderRound` and `ladder.round` disagree, r10-1 refusal
  echoes escape `Cc/Cf/Zl/Zp/Cs` and are bounded (`quoteWireValue`), r10-3 the
  binding lives inside the SIGNED bytes
  (`courtEscalationRequestSignedContent` + `escalationRequestBindingFromSignedEvent`),
  and the four raw `TypeError` escapes the independent wire found are typed.
- `confirmationMachineCore.ts` (+44), `confirmationMachineHandlers.ts` (+35) -
  r10-4 `assertRoundCountersAgree` in `finalize`/`escalate`/`open_ladder_round`
  (a fee-settlement snapshot with `ladderRound 3` / `ladder.round 2` FINALISED
  round 2's YES over round 3's NO), plus the r9-3/r9-4 barriers.
- `courtConfirmationMachine.ts` (+23) - the machine factory surface for the
  above; no wire field was added, so existing cases/snapshots restore unchanged.
- `index.ts` (+3) - re-exports `courtEscalationRequestSignedContent`,
  `escalationRequestBindingFromSignedEvent` and the `CourtEscalationRequestEvent`
  type. No new subpath.

**Tests vendored:** 5 modified (`reviewRound6`, `reviewRound7`, `scale/corpus`,
`scale/index`, `scale/scaleCampaign` - the r40-4/R52 boundary expectations move
to cap 1 / flip 2 and the campaign gains the three new corpora) and 7 new
(`reviewRound9` 734 lines, `reviewRound10` 940, `ladderBoundExact` 438, 
`findingR46` 179, `mechanisedArtifacts` 578, `differentialWire` 352,
`scale/{escalationTransportCorpus,ledgerBarrierCorpus,bondAlgebraCorpus}`).
All import only vendored engine modules, `helpers/` and `@noble/*` - no new
dependency.

**Deliberately not vendored (unchanged convention):** the `docs/` delta
(`DIFFERENTIAL_WIRE.md`, `REVIEW_ROUND_9.md`, `REVIEW_ROUND_10.md`,
`SCALE_CAMPAIGN_V2.md`, `docs/proofs/07-mechanised-escalation.tex.md`,
refreshed paper/README/CROSS_CHECK/EVALUATION/REVIEWS_INDEX/PER_ROUND_BOND),
`proofs/` (Lean 4 + Quint), `scripts/` (the differential harness, campaign,
mutation) and `CHANGELOG.md` - engine + tests + fixtures only, as always.

## Client-local adaptations preserved / applied this sync

1. **ASCII dash normalization** re-applied to all 20 copied files (em dash
   U+2014, en dash U+2013, U+2011, box-drawing U+2500 -> `-`). Verified by
   reproduction: normalizing the `bc28ff3` copies reproduced the previous tree
   byte-for-byte, so the diff is exactly the upstream delta.
2. **`differentialWire.test.ts` - the harness-backed cases are SKIPPED, not
   weakened.** The suite drives `scripts/differential/{wire_ref.py,run.mjs}` and
   reads the committed `results/*.json`, none of which is vendored here, and one
   pin reads `docs/DIFFERENTIAL_WIRE.md`. A `HAS_HARNESS` guard (path existence +
   `python3`) skips those 5 cases and the doc pin; the four DECIDED corners
   (D1 whitespace set, D2 typed refusal, D3 double semantics, D4 canonicality)
   run in process and stay asserted.
3. **`reviewRound7.test.ts`** - the `dirname`+`join` jsdom shim (relative URL
   against a `file:` base throws `ERR_INVALID_URL_SCHEME` here) and the
   `it.skip` on the doc pin were re-applied to the REWRITTEN upstream text (the
   r41-T1 case now pins cap 1 / flip 2 / `E[pi](2) = 0`), so the skip stays a
   skip on the new assertion, not a stale duplicate.
4. **`escalationRequestWire.test.ts`** is unchanged upstream in this delta, so
   its existing `it.skip` doc pin stands untouched.
5. No new dependency, no new jsdom shim (the new in-process suites read nothing).
6. **`scale/escalationTransportCorpus.ts` - `prependMember` uses index-based
   insertion instead of `text.replace('{', ...)`.** CodeQL flags the
   string-pattern form on code changed by this PR (`js/incomplete-sanitization`:
   the replacement re-supplies the searched character). Behaviour is identical
   for a JSON object text - the fixture crafts malformed wire text at a known
   position - and the intent is now explicit (`startsWith` guard + `slice`).
   Upstream keeps the `replace` form; this is the only divergence in the
   vendored TESTS that is neither a dash nor a skip.

## Consumer impact here: none

Nothing in the client constructs an escalation request or a confirmation
machine (hooks derive status from relay events; the escalation UI emits
decisions), so r9-3/r9-4/r10-3 are stricter-and-unused here, and the ladder
bound has no client call site. `@bao/court` is imported for TYPES and a few
constants (`BAO_COURT_DISPUTE_KIND`, court kinds) only.

## Verified

- `npx vitest run src/baofund/court-core` -> 49 files, **1,231 passed / 6 skipped**
  (was 43 / 1,129 / 2; +6 files, +102 passing, +4 documented skips)
- `npx vitest run src/hooks src/components/bao-court` -> 49 files / 351 passed
  (one full-suite run showed 4 load flakes - `useCashuWallet` x3 and the 2,000-
  event r36 retention case at 82 s; all 82 cases of those two files pass in
  isolation 35 s, so they are load-sensitive, not regressions)
- `npx vitest run src/baofund/lib/codecSafety.test.ts` -> 9 passed
- `npx tsc --noEmit --incremental false` -> exit 0
- `npx vite build` -> exit 0 (49.5 s, chunk-size advisory only)

---

# court-core vendor sync - bao-court v0.15.1 (e489fe5)

Small round: the v0.15.0 sync landed earlier the same day (#217), so this
carries ONLY the `v0.15.0 -> v0.15.1` delta (bao-court #128 review round 11 +
#129 release) into `src/baofund/court-core/` and moves the dep `@bao/court`
`#v0.15.0` -> `#v0.15.1`. `v0.15.1` is an ANNOTATED tag; it resolves to commit
`e489fe594b59d41615f1700a01a99006d4740e73` (package version `0.15.1`), which is
what the lockfile records.

## What changed (4 engine files + 1 new test; no export, no wire field, no signature)

- `courtEscalationRequest.ts` - **r11-1 + r11-2.** The refusal echo is now
  TOTAL: `quoteWireValue` escaped `Cc/Cf/Zl/Zp/Cs` but only four of the ten
  echo sites used it, so `event.kind` from the wire and `state.ladderRound` /
  `state.phase` from a restored snapshot were interpolated raw (`"3\nESCALATION
  ACCEPTED"` forged a log line inside the barrier's own refusal message); the
  64-character budget is now spent on the ESCAPED output (a legal 60-char
  zero-width id echoed 387 characters, now 59 plus `...`); the walk is by code
  point, so the clip cannot split a surrogate pair or half an escape; and new
  `quoteWireUnknown` never calls `toString` (`String(Object.create(null))` used
  to throw a raw `TypeError` OUT of a refusal). The signed-event binder
  validates the event SHAPE (kind/id/pubkey/sig/created_at/content/tags) before
  `verifyEvent`, so `tags: null` is a typed refusal instead of
  `Cannot read properties of null (reading 'map')`.
- `confirmationMachineCore.ts` - r11-1 on the counters barrier: its refusal
  echoes both counters through a total `quoteCounter` (a restored
  `ladderRound: "3\nESCALATION ACCEPTED"` is described, never stringified), and
  the doc comment no longer claims the reverted pre-dispatch placement.
- `confirmationMachineHandlers.ts` - **r11-3.** `flag_clawback` was the one
  ladder reader the round-10 sweep missed: it stamped the clawback record with
  `state.ladderRound` without `assertRoundCountersAgree`, so a restored
  `fee_settlement` snapshot (`ladderRound 3` / `ladder.round 2`) wrote a round-3
  clawback on a round-2 case. It is now behind the same barrier as `finalize`,
  `escalate`, `open_ladder_round` and `resolve_round`.
- `ladderEconomics.ts` - **DOCSTRING ONLY, no behaviour change.** It now states
  the edge round 11 measured: parameters are rationalised from `String(number)`,
  so `beta: 3 * 0.1` is a DIFFERENT rational from `0.3` and admits one round
  more at the exact boundary. The numeric export, `deriveMaxLadderRounds`, is
  byte-identical to v0.15.0.
- `__tests__/reviewRound11.test.ts` (new, 828 lines) - the attack suite for the
  three fixes plus the exact-bound pin.

**Not vendored (unchanged policy):** `CHANGELOG.md`, `docs/REVIEW_ROUND_11.md`
and the release `package.json`. No `__fixtures__` or `__tests__/reference`
change in this delta; the committed model-check fixture is untouched.

## Client-local adaptations applied this sync

1. **ASCII dash normalization** on all 5 copied files (em/en/non-breaking dash
   -> `-`), the standing rule. Proven, not asserted: normalizing the v0.15.0
   copies of the 4 modified files reproduces this tree's previous bytes exactly,
   so the delta is the only change in them.
2. **No new adaptations were needed.** `reviewRound11.test.ts` imports only
   `vitest`, `nostr-tools/pure` and relative `../` engine paths - no `fs`, no
   `dirname`+`join` jsdom shim, no `scripts/` harness case (so no
   `HAS_HARNESS` guard), no doc pin. It runs in process, whole.

## Client call sites (verified by grep, not assumed)

- `quoteWireValue` / `quoteWireUnknown` / `quoteCounter` are module-private; the
  client cannot import them and never did.
- The client does not construct escalation requests or `flag_clawback` events at
  all (`grep` for `courtEscalationRequest`, `escalationRequestToMachineEvent`,
  `flag_clawback` outside `src/baofund/court-core` is empty), so the tightened
  barriers change no client path. The engine is carried for parity and for its
  suite.

## Verified

- `npx vitest run src/baofund/court-core` -> **50 files, 1,252 passed / 7
  skipped (1,259)** (was 49 / 1,231 / 6: exactly +1 file and +21 tests, all from
  `reviewRound11.test.ts`). One extra `skipIf` case parks in this worktree's
  install - `scripts/differential` is not vendored and `tsx` is not installed
  here, so `differentialWire.test.ts`'s harness case skips; no test was
  weakened and no engine assertion changed.
- `npx vitest run src/baofund/court-core/__tests__/reviewRound11.test.ts`
  (verbose) -> 21/21 passed, no skips.
- `npx vitest run src/hooks src/components/bao-court` -> 49 files / 351 passed
  (unchanged from #217, as expected: no client call site).
- `npx vitest run src/baofund/lib/codecSafety.test.ts` -> 9 passed
- `npx tsc --noEmit --incremental false` -> exit 0
- `npx vite build` -> exit 0 (1m 27s)
- `npm ci` re-resolved `@bao/court` to **0.15.1** from
  `github:baocommunity/bao-court#v0.15.1` (lock: commit
  `e489fe594b59d41615f1700a01a99006d4740e73`), so the pin is real rather than
  a hand-edited lockfile entry.

---

# court-core vendor sync - bao-court v0.15.2 (a797362)

Small round again: v0.15.1 landed hours earlier (#218), so this carries ONLY the
v0.15.0 -> v0.15.2 delta, which is really the v0.15.1 -> v0.15.2 step (bao-court
#127 mutation campaign 3, #131 review round 12, #132 release) plus the dep bump
`@bao/court` `#v0.15.1` -> `#v0.15.2` (annotated tag resolving to commit
`a7973621c8437e9c940a7132cc020506ce3d72c9`, package version `0.15.2`).

## What changed (4 engine files + 1 NEW engine module + 2 new tests; no export,
no wire field, no signature)

- `courtEcho.ts` - **NEW (module-private).** The escape path is now ONE
  implementation. On v0.15.1 a mechanical sweep found **66 raw interpolation
  sites** across four files (`confirmationMachineHandlers.ts` 44,
  `confirmationMachineCore.ts` 9 incl. `state.ladderRound`,
  `courtConfirmationMachine.ts` 3 incl. the front-door `event.type`,
  `courtEscalationRequest.ts` 10 that were literals by convention only).
  Measured on v0.15.1: `Object.create(null)` as `event.type` threw a raw
  `TypeError` **and ran caller code inside a refusal**, and a newline in an
  outcome was echoed verbatim into the operator log. The module exports
  `quoteWireValue` / `quoteWireUnknown` / `quoteCounter`, whose value return is
  runtime-total (never `toString`, never throws).
- `confirmationMachineCore.ts` - **r12-1: the counters barrier accepted
  AGREEMENT as integrity.** Round 11 made the barrier's *message* total but left
  the invariant `===`, so a restored snapshot with BOTH counters forged to the
  same non-integer (`"3\nESCALATION ACCEPTED"`, `2.5`, `-1`) passed and
  `flag_clawback` then persisted the forged round. `assertRoundCountersAgree`
  now enforces the field's **write domain** (a non-negative safe integer) on
  both counters and requires `ladderRound === 0` when no ladder is open.
- `confirmationMachineHandlers.ts` / `courtConfirmationMachine.ts` /
  `courtEscalationRequest.ts` - the raw sites in each go through the shared
  module; no transition, state field or refusal CLASS changed.
- The echo **clip** was documented as 64 characters and returned 65, and counted
  UTF-16 units (40 astral characters measured 65; now 63). The budget is spent
  on the escaped output and the walk is by code point, so a clip cannot split a
  surrogate pair or half an escape.
- `__tests__/reviewRound12.test.ts` (new, ~1.2k lines) - the round-12 attack,
  including a **STATIC totality sweep** that discovers every file constructing
  `CourtConfirmationTransitionError` and refuses any unquoted interpolation (with
  a teeth test and a one-implementation assertion), plus a 20,000-shape fuzz of
  the event validator, and `__tests__/mutationClosuresV014.test.ts` (new) - the
  campaign-3 closures.

**Not vendored (unchanged policy):** `CHANGELOG.md`, `docs/REVIEW_ROUND_12.md`,
`docs/MUTATION_TESTING_V014.md`, `docs/CAMPAIGN_REPORT.md`, the release
`package.json` and the `scripts/mutation/` campaign artefacts. No
`__fixtures__` or `__tests__/reference` change in this delta, so the committed
model-check fixture is untouched.

## Client-local adaptations applied this sync

1. **ASCII dash normalization** on all 7 copied files (em/en/non-breaking dash
   and box-drawing section rules -> `-`), the standing rule. Proven, not
   asserted: normalizing the **v0.15.1** copies of the 4 modified engine files
   reproduces this tree's previous bytes exactly (checked byte-for-byte against
   `HEAD:src/baofund/court-core/*.ts`), so the vendor delta is the only change in
   them. (Note: `reviewRound11.test.ts`, added last round, kept its U+2500
   section rules - a one-off deviation from the rule; it is left as-is here
   since it is not in this delta.)
2. **No new adaptations were needed.** `reviewRound12.test.ts` already uses
   `dirname(fileURLToPath(import.meta.url))` + `join`, so the jsdom
   relative-`file:` shim (adaptation 2) is not required, and it imports only
   `vitest`, `node:fs`, `node:path`, `node:url`, `nostr-tools/pure` and relative
   `../` engine paths - no `scripts/` harness case (no `HAS_HARNESS` guard), no
   doc pin, no `tsx`. Its static sweep runs against this tree's own engine files
   and passes unmodified.

## Client call sites (verified by grep, not assumed)

- `courtEcho.ts` and `quoteWireValue` / `quoteWireUnknown` / `quoteCounter` are
  module-private and referenced nowhere outside `src/baofund/court-core`
  (`grep` empty).
- The client's 14 `@bao/court` imports are types plus event-kind constants and
  the selection/dispute builders; none constructs the confirmation machine, an
  escalation request or a `flag_clawback` event (`grep` for
  `courtConfirmationMachine`, `confirmationMachine*`, `courtEscalationRequest`,
  `flag_clawback` outside `src/baofund/court-core` is empty). The tightened
  barrier therefore changes no client path; the engine is carried for parity and
  for its suite.

## Verified

All numbers below were taken while ANOTHER session ran a 40-core burn on this
box (`bao-court--test-r51-determinism/loaded-run.sh`, load average ~80), which
made every wall-clock-budgeted property test 5-20x slower. Read them with that
in mind; the failures listed are timeouts, not assertions.

- `npx vitest run src/baofund/court-core` (50 of 52 files; `modelChecking`'s
  three exhaustive sweeps are > 38 min each under that load) -> **1,258 passed
  / 7 skipped / 2 failed (1,267)**. Both failures are `Error: Test timed out`
  in the *properties* family (e.g. `propertiesValidator` PV1, 20 s budget,
  73 s actual) - files that do not touch this delta - and
  `propertiesBatch` PB1/PB4 times out IDENTICALLY at the pre-sync v0.15.1
  baseline under the same load (measured, see the bao.markets PR), so the
  failure is environmental, not a regression.
- The two files this delta actually adds:
  `npx vitest run src/baofund/court-core/__tests__/reviewRound12.test.ts
  src/baofund/court-core/__tests__/mutationClosuresV014.test.ts` -> **2 files /
  35 tests passed**. This includes round 12's STATIC totality sweep, which
  discovers the four files constructing `CourtConfirmationTransitionError` in
  THIS tree and asserts `courtEcho.ts` is the only definer of the escape
  helpers - i.e. the client-local copies are swept, not upstream's.
- `npx vitest run src/hooks src/components/bao-court` -> 42 files / 325 tests,
  27 failed in 6 files, all under load. Sampled in isolation,
  `useCourtConfirmations.r35.security.test.ts` -> **14/14 passed** (88 s), so
  these are the same wall-clock/timeout class; no client call site imports the
  changed engine.
- `npx vitest run src/baofund/lib/codecSafety.test.ts` -> 9 passed
- `npx tsc --noEmit --incremental false` -> exit 0
- `npx vite build` -> exit 0 (4m15s)
- `npm install @bao/court@github:baocommunity/bao-court#v0.15.2` re-resolved the
  dep to **0.15.2** (lock: commit
  `a7973621c8437e9c940a7132cc020506ce3d72c9`) and `node_modules/@bao/court`
  reports `0.15.2`, so the pin is real rather than a hand-edited lockfile entry.

---

# court-core vendor sync - bao-court v0.15.3 (6128129)

The second small round of the day: v0.15.3 closes the defect the v0.15.2 sync
found. That release's r12-1 clause ("no `ladder` => `ladderRound` must be 0") was
true of every state the machine produces and false of the shape a host persists,
and upstream's `docs/LANE-PROJECTION.md` cites the measurement by PR number
(bao.markets #2488: 42 of 185 host court tests red across 8 suites). v0.15.3
replaced the SHAPE test with a PROVENANCE test.

Dep bump: `@bao/court` `#v0.15.2` -> `#v0.15.3` (annotated tag resolving to
commit `6128129074fc8958f5f0e6d9deaf86b39ed19d81`, package version `0.15.3`;
`node_modules/@bao/court` reports 0.15.3).

## What changed (6 engine files + 2 new test assets; no wire field, no signature)

- `confirmationMachineTypes.ts` - **`projection?: 'lane'`** on
  `CourtConfirmationMachineState` (type `CourtConfirmationStateProjection`).
  ABSENT on every state the factory and the reducer produce - so "absent" means
  FULL state, by construction - and `'lane'` on a host projection.
- `confirmationMachineCore.ts` - `assertRoundCountersAgree(state, entry)` takes a
  **required** reader: a declared lane at `ladderRound >= 1` with no `ladder` is
  accepted by `escalate` (and the transport mapper) and REFUSED by
  `open_ladder_round`, `resolve_round`, `flag_clawback` and `finalize`. The write
  domain (non-negative safe integer) is unchanged on BOTH shapes, so r12-1's
  exploits still fail; escalating does not launder the marker away.
- `confirmationMachineHandlers.ts` / `courtConfirmationMachine.ts` - pass the
  reader at each site; an unknown marker is a typed refusal at the front door.
- `courtEscalationRequest.ts` - the mapper calls the barrier with `'transport'`
  instead of re-deriving r9-4, and no longer demands a `ladder` record.
- `bondVerification.ts` + `index.ts` - new `CourtBondRef` codec (`BOND_RAILS`,
  `BOND_NETWORKS`, `UNBONDED`, `formatCourtBondRef`, `parseCourtBondRef`) and the
  `CourtConfirmationStateProjection` type, root-exported.
- New tests: `__tests__/overStrictness.test.ts` (25 cases - the 12-shapes x
  11-readers matrix asserted both ways plus a sweep that fails if any exported
  `assert(state)` re-stricts the lane without an allow-listed reason) and
  `__tests__/helpers/watchdog.ts` (the load-normalised timeout helper the suite's
  `wd` calls now import). `__tests__/helpers/budget.ts` is REMOVED upstream.

**Not vendored (unchanged policy, plus one new exclusion):** `docs/*`,
`scripts/*`, `proofs/`, `bench/`, `vitest.config.ts`, and - new this round - the
test-harness pair `__tests__/helpers/determinism.setup.ts` +
`__tests__/determinism.test.ts`: that test asserts the package's own
`vitest.config.ts` installed the watchdog, and the client runs its suite under
the app's vitest config, so vendoring it would add a red assertion about a config
the client does not use. `helpers/watchdog.ts` IS vendored (the suite's `wd`
helper imports it, and it degrades gracefully without the setup file).

## Client-local adaptations applied this sync

1. **ASCII dash normalization** on every copied file, with the established
   per-file rules preserved (files that kept em dashes upstream -
   `differentialParity.test.ts`, `modelCheckingCore.ts`, the model-check fixture -
   still keep them; `reviewRound11.test.ts` still keeps its box rules). Proven,
   not asserted: normalizing each file's v0.15.2 copy reproduces this tree's
   previous bytes exactly for the 24 modified engine/test files.
2. **The seven semantic adaptations are re-applied verbatim** (they are not
   dash-related, so a re-copy drops them): the jsdom `dirname`+`join` shim in
   `helpers/fixtures.ts` and `reviewRound7.test.ts`, `Uint8Array.from(...)` in
   `helpers/keys.ts`, the `readonly unknown[]` dispatch in `helpers/machines.ts`,
   the index-based `prependMember` in `scale/escalationTransportCorpus.ts`, and
   the three `it.skip` doc pins / `HAS_HARNESS` guard in
   `escalationRequestWire.test.ts` + `differentialWire.test.ts`.

## Client call sites (verified by grep, not assumed)

- `projection` is a protocol field on the vendored state only: no client file
  constructs a `CourtConfirmationMachineState`, and the client's `@bao/court`
  imports are types, event-kind constants and the selection/dispute builders.
- `CourtBondRef` / `parseCourtBondRef` / `formatCourtBondRef` are new root
  exports nothing imports yet (they are the bond-reference shape the host-side
  court work will adopt; the client's bond handling is unchanged).
- The barrier change is invisible here: the client never reduces a confirmation
  machine (the host that does is bao.markets, wired in bao.markets#2488).

## Verified

Taken while ANOTHER session ran a 40-core burn on this box (load average ~62), so
wall-clock budgets are the only thing that fails - no assertion in the suite
regressed.

- `npx vitest run src/baofund/court-core` (52 of 53 files; `modelChecking`'s
  three exhaustive sweeps are > 30 min each under that load) -> **1,293 passed /
  7 skipped (1,300)**, 52 files green. That includes the new
  `overStrictness.test.ts` (25 cases) and the re-applied client adaptations
  (the first run caught the one I had missed - `adversarialNostr.test.ts`'s
  `Uint8Array.from(randomBytes(32))` - which is exactly what the adaptation
  re-application is for; it is fixed and the file is 20/20).
- `npx vitest run src/hooks src/components/bao-court` -> 49 files / 351 tests,
  12 failed in 4 files, all wall-clock: `useCourtConfirmations.r36` times out on
  a 2,000-event signing flood at its 20 s budget and passes 20/20 with
  `--testTimeout=180000` (91 s); `useCashuWallet.test.tsx` (0 references to the
  court engine, untouched by this sync) fails 5-7 of 62 in `waitFor` on wallet
  construction, a count that changes run to run.
- `npx tsc --noEmit --incremental false` -> exit 0
- `npx vite build` -> exit 0 (3m06s)
- `npm install @bao/court@github:baocommunity/bao-court#v0.15.3` re-resolved the
  dep to **0.15.3** (lock: commit `6128129...`), so the pin is real rather than a
  hand-edited lockfile entry.

---

# court-core vendor sync - bao-court v0.16.2 (f0de7cd3)

Dep bump: `@bao/court` `#v0.15.3` -> `#v0.16.2` (annotated tag resolving to
commit `f0de7cd38ccdd129480a001d99ede76346eb3430`, package version `0.16.2`;
`node_modules/@bao/court` reports 0.16.2).

**This is NOT a docs-only round for this tree.** bao.markets was already at
v0.16.0 when v0.16.2 landed, so its delta is docs-only (verified there:
`git diff --name-only v0.16.0..v0.16.2 | grep -v '\.md$\|package.json'` is
empty). The client skipped v0.16.0 entirely, so the same command over
`v0.15.3..v0.16.2` yields a REAL engine delta - it is synced and tested here,
not waved through:

- `bondCheckGate.ts` - **NEW (334 lines).** The bond-check gate: the typed
  verdict a host gets when it asks "may this bond fund this seat?" - rail and
  network pins, `BOND_JUROR_MISMATCH` / `BOND_JUROR_UNBOUND` /
  `BOND_PROOF_UNPARSEABLE` / `BOND_UNVERIFIABLE`, and the per-seat outpoint
  shape the LJ-1 juror commitment produces.
- `courtCeremonyCore.ts` (+143) - the ceremony core grows the bond-gated
  ceremony the three-box runs use (seat provisioning, the
  `ROSTER_BELOW_THRESHOLD` negative, the replay/equivocation wire).
- `index.ts` (+24) - the new root exports for both.
- New tests: `__tests__/bondCheckGate.test.ts` (305 lines) and
  `__tests__/replayEquivocation.test.ts` (286 lines); new fixture
  `__fixtures__/replay-wire-n3-k2.json` (a recorded n=3/k=2 replay wire).
- Updated: `__tests__/attribution.test.ts`, `__tests__/differentialParity.test.ts`.

The v0.16.1/v0.16.2 halves are documentation only (the LJ-1 closure in the
paper, `DELIVERY.md`, `EVALUATION.md`, `CAMPAIGN_REPORT.md`, `REVIEWS_INDEX.md`),
which this tree does not vendor - so nothing else moves here.

## Client-local adaptations applied this sync

1. **ASCII dash normalization**, with the established per-file rules (files that
   kept em dashes upstream still keep them; `reviewRound11.test.ts` keeps its box
   rules). The 4 new files get the standing rule (all four dash characters -> `-`).
2. **The eight semantic adaptations re-applied verbatim** (a re-copy drops them):
   the jsdom `dirname`+`join` shim in `helpers/fixtures.ts` and
   `reviewRound7.test.ts`, `Uint8Array.from(...)` in `helpers/keys.ts` and
   `adversarialNostr.test.ts`, the `readonly unknown[]` dispatch in
   `helpers/machines.ts`, the index-based `prependMember` in
   `scale/escalationTransportCorpus.ts`, and the three `it.skip` doc pins /
   `HAS_HARNESS` guard in `escalationRequestWire.test.ts` +
   `differentialWire.test.ts`. The sync script reports anchor misses instead of
   silently skipping, and this round reported zero.

## Client call sites (verified by grep, not assumed)

`bondCheckGate.ts` is carried for parity: no client file imports it yet (the
client's bond handling goes through its own `@bao/court` types and the
selection/dispute builders). `courtCeremonyCore.ts`'s additions are exercised
only by the vendored ceremony tests, which run here.

## Verified

- `npx vitest run src/baofund/court-core` -> **55 files passed, 1,333 passed /
  7 skipped (1,340)**. This is the FIRST round in a while that could run the
  whole suite including `modelChecking.test.ts` (its three exhaustive sweeps
  need the box to themselves; this run had a load average of ~3 instead of the
  ~60 of the previous rounds), so the gate is stronger than usual: the new
  `bondCheckGate` / `replayEquivocation` suites and the model checker are both
  green against the vendored v0.16.2 engine.
- `npx vitest run src/hooks src/components/bao-court` -> **49 files / 351
  passed**, no failures and no skips - i.e. the client surface is unchanged by
  this sync (as expected: no client file imports `bondCheckGate`).
- `npx tsc --noEmit --incremental false` -> exit 0
- `npx vite build` -> exit 0
- `npm install @bao/court@github:baocommunity/bao-court#v0.16.2` re-resolved the
  dep to **0.16.2** (lock: commit `f0de7cd3...`), so the pin is real rather than
  a hand-edited lockfile entry.

---

# court-core vendor sync - bao-court v0.17.0 (98910ee -> 128ca3fb)

Dep bump: `@bao/court` `#v0.16.2` -> `#v0.17.0` (annotated tag `98910ee`
resolving to commit `128ca3fb5cfe90f74d548090bd854c4ca2acdfa0`, package version
`0.17.0`; `node_modules/@bao/court` reports 0.17.0).

**No vendored file changed this round — proved, not assumed.** The round was
announced as documentation-only and for the ENGINE that is true: `git diff
--name-only v0.16.2..v0.17.0` filtered to `.ts`/`.mjs` yields only the ceremony
soak harness (`scripts/court/soakBondAssertions.ts`, `scripts/court/distributed-ceremony*.mjs`, `bond-plan.json`, the soakctl script + systemd unit)
and ONE new test, `__tests__/soakBondAssertions.test.ts`. No engine module
(reducer, confirmation machine, crypto/escrow/rail, `index.ts`) moved. Checked
file by file against `git archive 128ca3fb` under each file's own dash rule: the
132 tracked engine/test/fixture files are already identical to v0.17.0, and the
remaining 8 differ ONLY by their documented client adaptations (re-verified in
place: `Uint8Array.from` in `helpers/keys.ts` + `adversarialNostr.test.ts`,
`readonly unknown[]` in `helpers/machines.ts`, the jsdom `dirname`+`join` shim in
`helpers/fixtures.ts` + `reviewRound7.test.ts`, `HAS_HARNESS` in
`differentialWire.test.ts`, the `it.skip` doc pins in `escalationRequestWire` +
`reviewRound7`, and the index-based `prependMember` in
`scale/escalationTransportCorpus.ts`).

**New exclusion (documented): `__tests__/soakBondAssertions.test.ts` is NOT
vendored.** It imports `../scripts/court/soakBondAssertions`, and this tree
vendors the engine + tests + fixtures only (no `scripts/`) — the same reason the
differential harness cases are skipped. It tests the ceremony SOAK harness, not
the engine, and the full suite runs it in bao-court and in bao.markets (where the
harness IS vendored: 94 files / 2,027 passed there).

The substance of the release is documentation (PO-15 moves to "prototype
compiled and tested, not deployed": the CHECKSIGFROMSTACK premise was wrong,
F-14 registered, `BaoCourtEscrow.simf` — which lives in bao.markets — closes the
three real gaps with a 9/9 FROST matrix). None of that is engine code, so
nothing here changes.

## Verified (CI unavailable org-wide, so every gate was run locally)

- `npx vitest run src/baofund/court-core` -> **55 files passed, 1,333 passed /
  7 skipped (1,340)** - byte-for-byte the same counts as the v0.16.2 round
  (1,333 / 7 / 1,340, modelChecking included), which is the proof that this
  delta does not touch the engine.
- `npx vitest run src/hooks src/components/bao-court` -> **49 files / 351
  passed**, also identical to v0.16.2.
- `npx tsc --noEmit --incremental false` -> exit 0
- `npx vite build` -> exit 0
- `npm install @bao/court@github:baocommunity/bao-court#v0.17.0` re-resolved the
  dep to **0.17.0** (lock: commit `128ca3fb...`), so the pin is real rather than
  a hand-edited lockfile entry.
