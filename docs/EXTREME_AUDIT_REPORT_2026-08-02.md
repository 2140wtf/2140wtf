# Corrected Audit Review — 2140wtf

**Original audit date:** 2026-08-02
**Original source snapshot:** `fix/zap-qr-confirmation` at `efc941f21`, with 45 tracked modifications and 2 untracked Concord transport files
**Correction date:** 2026-08-02
**Correction basis:** source inspection, the preserved `/tmp` artifacts, current dependency graph, and NIP-01

> This document supersedes the original “Extreme Audit Report” committed as
> `0c14b1da2`. The original report contained useful command output, but several
> severity, exploitability, E2E, and completion claims were not supported by its
> own artifacts. It was a point-in-time automated review of a dirty working tree,
> not a complete security audit or penetration test.

## 1. Corrected executive summary

The original dirty tree passed the repository's TypeScript, ESLint, Vitest, and
Vite pipeline at the time captured in `/tmp/pipeline.log`: 173 test files and
1,916 tests passed. That establishes build health for that exact live tree; it
does not establish protocol correctness, browser correctness, or security.

The actionable results are:

| Priority | Area | Corrected assessment |
|---|---|---|
| P0 | Native photo save | Corrected in the current live tree with a tested binary Documents writer; real iOS/Android device verification remains. |
| P1 | Dependencies | Upgrade DOMPurify. The installed version is advisory-affected, but this app does not use the vulnerable advisory prerequisites, so a demonstrated HIGH application XSS was not established. |
| P1 | Dependencies | Plan a React Router upgrade. The advisories are moderate; current SPA exposure is low/unproven, not HIGH. |
| P1 | Nostr correctness | The original `>=` deduplication edit was not NIP-01 compliant. The current live tree now implements and tests the lexicographically lowest-ID rule, but that correction is uncommitted at the time of this document update. |
| P1 | E2E | Repair ambiguous selectors and the Blossom error policy before treating this suite as regression evidence. |
| P2 | Assurance | Replace sampled repository-wide PASS statements with a traceable inventory of trust-sensitive queries and sinks. |

The Concord transport observation in the original report is historical. The
transport isolation work was subsequently committed in `552f5ebbe` and passed
the full repository pipeline. It should be reviewed through its committed diff,
not inferred from the invalid E2E failures recorded here.

## 2. What was actually validated

The preserved pipeline artifact reports:

| Stage | Historical result |
|---|---|
| TypeScript | PASS |
| ESLint | PASS — 0 errors, 2 existing Fast Refresh warnings |
| Vitest | PASS — 173 files / 1,916 tests |
| Vite build | PASS |

These commands ran against a dirty tree rather than a reproducible commit. The
result is still useful as a historical health check, but another developer cannot
recreate it from `efc941f21` alone.

The earlier `BUG_HUNTING_REPORT.md` describes targeted validation after its seven
edits. Its appended Round 2 then records a whole-tree TypeScript failure and one
whole-suite failure caused by the concurrent Concord WIP. Those statements refer
to different moments and scopes; they must not be collapsed into a single “all
checks passed” claim.

## 3. Dependency audit — corrected interpretation

`npm audit` reported **7 vulnerable dependency entries by npm's aggregate
severity count**: 1 low, 2 moderate, 3 high, and 1 critical. This is not the same
as “7 CVEs”; the artifact lists more than seven advisory IDs, including five for
`tar` alone.

### DOMPurify 3.4.11

The package is affected by GHSA-c2j3-45gr-mqc4 and should be upgraded. The
original report overstated application exploitability, however. That advisory
requires an application to allow custom elements with `CUSTOM_ELEMENT_HANDLING`
and rely on an `afterSanitizeElements` hook. This repository does neither:

- `sanitizeSvg` uses explicit SVG tag and attribute allowlists.
- `sanitizePetsSvg` uses explicit allowlists and an `uponSanitizeAttribute` hook.
- No `CUSTOM_ELEMENT_HANDLING` or `afterSanitizeElements` use exists in `src/`.

**Correct status:** affected dependency; upgrade promptly as defense in depth;
no demonstrated HIGH application XSS through the cited sanitizers.

### React Router 6.30.4

The installed package is affected by two moderate advisories. The backslash open
redirect requires an untrusted `to`/`navigate` value capable of containing a
backslash. Sampled dynamic routes use app-generated paths or NIP-19 values, which
cannot contain one. The constructor-deserialization advisory concerns React
Router SSR hydration, while this project is a client-side Vite SPA.

**Correct status:** moderate dependency debt with low/unproven current
application exposure. Inventory all dynamic navigation sources, reject unsafe
paths at their boundary, and plan the major upgrade. Do not label this a HIGH
application vulnerability without a reachable source-to-sink path.

### Tooling dependencies

`npm explain` identifies `tar`, `js-yaml`, and the vulnerable `brace-expansion`
instances as development/tooling dependencies. PostCSS is primarily exercised
by build tooling. Their advisories still matter for CI and developer machines,
but they are not browser-runtime vulnerabilities.

## 4. Corrected findings

### FIND-01 — MEDIUM, native compatibility: Pets photo save

`PetsPhotoModal` creates a web `blob:` URL and passes it to `openUrl()`. On
Capacitor, `openUrl()` forwards that URL to the native Share plugin. A native
share sheet generally cannot dereference a URL owned by the WKWebView blob store.

The web anchor path is not itself proof of a web bug—the shared download utility
also uses an anchor on web—but bypassing the shared abstraction is a project
convention violation. Implement a binary-capable native file helper, share its
native file URI, retain a normal browser download path, and verify both mobile
platforms. The original audit did not perform that device verification, so
“silently fails” should be treated as a strong code-based diagnosis rather than
a reproduced result.

### FIND-02 — dependency upgrade, not demonstrated HIGH XSS

Upgrade DOMPurify, with the exploitability correction in section 3.

### FIND-03 — moderate dependency debt, low current exposure

Plan the React Router upgrade and audit dynamic navigation, with the correction
in section 3.

### FIND-04 — INFO: chart CSS sink

`ChartStyle` constructs CSS with `dangerouslySetInnerHTML`. Current callers use
fixed palettes and tokens in the sampled paths, so no exploit was demonstrated.
The sink should nevertheless validate chart IDs, keys, and color values if any
can ever become event- or user-sourced.

### FIND-05 — sampled PASS only: EventsMap escaping

The inspected `EventsMap` popup escapes `& < > " '` before writing element-text
content through `innerHTML`. That sampled sink is safe for its current context.
This is not evidence that every HTML sink in the repository is safe.

### FIND-06 — LOW: throwing NIP-19 encoders

Sampled raw `nip19.*Encode` calls receive validated event IDs or pubkeys. Future
tag/content-derived values can still throw during rendering. Use the safe NIP-19
wrappers at untrusted boundaries; a blanket mechanical replacement is not
necessary for values guaranteed by validated `NostrEvent` objects.

### BUG-02 — reclassified INFO: asynchronous UI lifecycle

React ignores state updates after unmount; calling a setter after an `await` is
not by itself a memory leak. Mounted guards can prevent stale UI callbacks, but
the Cashu DM outbox must remain durable: it intentionally persists the bearer
token before delivery so closing the dialog or losing the relay cannot burn
funds. Do not suppress or automatically remove that recovery write.

### BUG-03 — CORRECTED IN LIVE TREE, NOT YET COMMITTED: equal-timestamp replaceable-event selection

The earlier bug hunt changed `deduplicateEvents` from `>` to `>=` to match two
streaming paths. That only changed relay-order dependence from first-wins to
last-wins. NIP-01 requires the event with the lowest lexicographical ID when
replaceable/addressable events have equal `created_at`. All deduplication paths
should implement the same deterministic timestamp-then-ID comparison.

During this correction pass, concurrent uncommitted work changed
`deduplicateEvents` to the correct timestamp-then-lowest-ID comparison and added
an order-independence regression test. Focused ESLint and Vitest validation
passed. `useStreamKind` and `useStreamPosts` now use the same tested comparator,
removing relay-order dependence from the streaming paths too.

## 5. Seven earlier changes — reconciled status

| # | Earlier finding | Corrected status |
|---|---|---|
| 1 | AgentJoinPanel native nsec download | Fixed with `downloadTextFile`; targeted validation passed. |
| 2 | ShopMapPopup `window.open` | Fixed with `openUrl`. |
| 3 | useOpenPost middle-click on native | Acceptably fixed with a native guard; web keeps normal middle-click behavior. |
| 4 | deduplicateEvents timestamp tie | Original edit was incomplete; the current uncommitted live tree now uses NIP-01's lowest-ID rule across paginated and streaming paths with focused regression tests. |
| 5 | hdWallet no-op replacement | Fixed. |
| 6 | `parseBip32Path` validation/markers | Fixed for the reported cases and covered by targeted tests. A separate hardening pass may also enforce integer bounds and reject partial strings such as `1x`. |
| 7 | useZaps setters in unmount cleanup | Cleanup corrected; the original issue was informational dead code, not a runtime leak. |

At the audited snapshot, the accurate summary was **five fixed, one acceptably
resolved, and one incomplete**, not “6/7 fixed” and not “all 7 fixed.” The
current live tree contains a focused correction for the incomplete seventh
result, but it must not be reported as committed until its owning session lands
it. Focused verification of the seven areas currently passes: ESLint is clean
and 40/40 relevant Vitest tests pass.

## 6. E2E artifact — corrected interpretation

The run produced 1 pass, 4 failures, and 1 skip, but the failure causes were:

| Test | Actual failure |
|---|---|
| Home smoke | Ambiguous `Follows` role selector matched both “Follows” and “Popular from follows.” |
| Network/p95 | Failed on the same selector during the first loop; five iterations and p95 assertion never completed. No p95 result exists. |
| Profile | `Edit profile` rendered; the network monitor then failed on repeated Blossom `/mirror` HTTP 403 responses. |
| Prediction market | Expected live market interaction did not produce the dialog; this is data/environment dependent unless deterministically seeded. |
| Mobile drawer | Passed. |

These results do not implicate `NostrProvider`. Fix the selectors (for example,
use an exact accessible name), decide whether the expected Blossom 403 is fatal,
and seed a local relay before gating E2E in CI.

## 7. Protocol-review limits

The original review sampled several correctly author-filtered queries. It did not
produce a complete inventory, so “no unfiltered trust-sensitive queries found”
must be read as “none found in the sampled paths.” A defensible repository-wide
claim requires a table of every trust-sensitive kind/query, its accepted authors,
validation boundary, relay target, and tests.

Likewise, green unit tests are necessary but do not prove the Concord rekey,
stream-auth, capability, or privacy state machines correct. Review those through
the committed `552f5ebbe` diff and its threat model.

## 8. Recommended follow-up

1. Device-test the corrected native Pets binary save path on iOS and Android.
2. Upgrade DOMPurify and refresh the lockfile audit.
3. Land the current NIP-01 lowest-ID corrections and regression tests.
4. Repair and rerun the E2E suite against an isolated preview server and deterministic relay fixture.
5. Inventory dynamic React Router navigation before scheduling the major upgrade.
6. Build a traceable Concord/relay metadata threat-model checklist instead of broad sampled PASS claims.

## Appendix — preserved historical artifacts

- `/tmp/pipeline.log` — historical dirty-tree pipeline
- `/tmp/npm-audit.log` — npm audit output
- `/tmp/e2e2.log` — Playwright output used for the corrected interpretation

Files under `/tmp` are ephemeral and are not reproducible audit evidence. Future
reports should store machine-readable results as CI artifacts tied to a clean
commit SHA.
