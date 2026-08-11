# ₿AO Dependable Work — Delivery Checklist

This is the execution companion to [`BAO_DEPENDABLE_WORK_PLAN.md`](BAO_DEPENDABLE_WORK_PLAN.md). It tracks work from the current product to dependable, interoperable, and safely settled human/agent projects.

## How to use this checklist

- Complete phases in order unless an item is explicitly marked parallel.
- Do not mark a phase complete until every exit gate passes.
- Add an owner and issue/PR link when an item enters active work.
- Use the status vocabulary: **shipped**, **demo/testnet**, **experimental**, or **proposed**.
- Keep public artifacts, sealed coordination, and settlement authority separate.
- Never select a new Nostr kind number without the required NIP review and kind-generation workflow.

Owner format: `Owner: unassigned`

Tracking format: `Issue: not created`

## Immediate next actions

- [ ] Create one tracking issue for Phase 0 and link this checklist.
- [ ] Assign product/domain, protocol, settlement, and independent safety owners.
- [ ] Inventory all existing ₿AO, funding, orchestration, repository, wallet, court, and evidence capabilities.
- [ ] Label every inventoried capability shipped, demo/testnet, experimental, or proposed.
- [ ] Approve the three-plane authority matrix.
- [ ] Approve the canonical milestone state vocabulary.
- [ ] Reconcile contradictory funding and settlement claims across documentation and UI.
- [ ] Complete the NIP reuse/custom-schema decision record.
- [ ] Define the first read-only project graph model and golden fixtures.

## Phase 0 — Align contract, authority, and vocabulary

**Target:** one coherent domain model with no misleading settlement claims.

### 0.1 Capability and truth inventory

- [ ] Catalogue Concord V2 communities, invites, membership, channels, rekeying, and privacy limitations.
- [ ] Catalogue agent CLI/MCP operations and orchestration verbs.
- [ ] Catalogue NIP-34 repository, issue, patch, pull-request, and status support.
- [ ] Catalogue ₿AO Fund campaign, milestone, market, attestation, and API behavior.
- [ ] Catalogue `WorkContractV1` and `MilestoneEvidenceV1` implementation status.
- [ ] Catalogue compute-credit request, fulfillment, receipt, and reputation behavior.
- [ ] Catalogue wallet rails, custody boundaries, escrow experiments, refunds, and receipts.
- [ ] Catalogue ₿AO Court simulation versus enforceable dispute behavior.
- [ ] Record the source file/document for every capability claim.
- [ ] Publish a shipped/demo/experimental/proposed matrix.

### 0.2 Authority model

- [ ] Document the public-artifact plane and its authorities.
- [ ] Document the sealed-coordination plane and its authorities.
- [ ] Document the settlement plane and its authorities.
- [ ] State explicitly that chat `DONE` means submitted, not accepted or paid.
- [ ] State explicitly that mutable community/project metadata is not a funded contract.
- [ ] State explicitly that repository merge/status is evidence unless frozen terms grant it acceptance meaning.
- [ ] State explicitly that AI verification cannot solely authorize irreversible payment.
- [ ] Define behavior when relay, API, verifier, coordinator, mint, or court state is unavailable.
- [ ] Review and approve the authority matrix with product, protocol, and safety owners.

### 0.3 Canonical state vocabulary

- [ ] Define project states.
- [ ] Define contract states: draft, offered, funding, funded, amended, cancelled, expired.
- [ ] Define execution states: claimable, claimed, in-progress, blocked, handed-off, submitted.
- [ ] Define review states: verifying, review, accepted, objected, disputed, appealed, final.
- [ ] Define settlement states: release-authorized, paid, refund-authorized, refunded, failed/unknown.
- [ ] Define which actor/event may cause each transition.
- [ ] Define impossible transitions and fail-closed behavior.
- [ ] Adopt the same names in UI, TypeScript, CLI, MCP, API, and documentation.

### 0.4 Settlement-policy alignment

- [ ] Compare current demo behavior with `BAO_FUND.md`.
- [ ] Compare current behavior with `BAO_FUND_RESOLUTION.md`.
- [ ] Compare both with `BAO_OPEN_SOURCE_WORK.md` and the dependable-work plan.
- [ ] Select one candidate policy for the testnet pilot.
- [ ] Define its version, canonical serialization, and content-hash procedure.
- [ ] Define optimistic acceptance and objection windows.
- [ ] Define donor eligibility, snapshot, quorum, and self-funding mitigations.
- [ ] Define runner, verifier, coordinator, court, and mint timeout paths.
- [ ] Define deterministic release and refund outcomes for every terminal state.
- [ ] Remove or correct UI/documentation wording that implies demo state is production escrow.

### 0.5 Nostr protocol review

- [ ] Review current NIP-01, NIP-19, NIP-22, NIP-31, NIP-34, NIP-44, NIP-57, NIP-59, NIP-60, NIP-61, NIP-73, NIP-85, and NIP-98 applicability.
- [ ] Map each proposed project-graph object to an existing kind or documented extension where possible.
- [ ] Write a decision record for the canonical project root.
- [ ] Write a decision record for frozen work contracts and amendments.
- [ ] Write a decision record for milestone evidence and verifier reports.
- [ ] Write a decision record for capability declarations and completed-work attestations.
- [ ] Write a decision record for delegation and revocation.
- [ ] Write a decision record for decisions, appeals, payout, and refund receipts.
- [ ] Identify relay-indexed fields and ensure queryable metadata uses single-letter tags.
- [ ] Generate, never arbitrarily choose, any unavoidable custom kind numbers.
- [ ] Document approved custom schemas/extensions in `NIP.md` with `alt` requirements.

### 0.6 Security, privacy, and custody baseline

- [ ] Produce a data-flow diagram for public, sealed, local, service, and wallet data.
- [ ] Produce a custody map for every supported payment rail.
- [ ] Threat-model malicious participants, relays, services, signers, dependencies, and artifact hosts.
- [ ] Document XSS-to-key/fund-loss risk and required CSP/sanitization controls.
- [ ] Document Concord traffic-shape, IP, timing, and cross-context correlation limits.
- [ ] Define what evidence is public, selectively disclosed, private, or prohibited.
- [ ] Define audit-log and decrypted-cache retention rules.
- [ ] Define incident-response and authority-revocation requirements.
- [ ] Define privacy-safe baseline metrics that reveal no private membership.

### Phase 0 exit gate

- [ ] Every current capability has an accurate status label.
- [ ] No UI or document describes demo, market, AI, or service state as production settlement.
- [ ] Authority matrix and state machine are approved.
- [ ] Candidate testnet settlement policy is versioned and hashable.
- [ ] Every proposed protocol object has a reuse/extension/custom-kind decision.
- [ ] Threat, privacy, and custody maps are reviewed.

## Phase 1 — Read-only project graph

**Target:** one project view that safely joins community, repository, funding, work, and evidence.

### 1.1 Domain and validation library

- [ ] Define canonical `ProjectCoordinate` and project relationship types.
- [ ] Define source provenance and authority metadata for every graph node/edge.
- [ ] Validate all event ids and pubkeys before encoding, routing, or querying.
- [ ] Validate addressable coordinates and author-filter every trust-sensitive query.
- [ ] Implement deterministic replacement, deletion, amendment, conflict, and deduplication folds.
- [ ] Represent partial relay/API results without converting unknown into absence.
- [ ] Produce a deterministic project snapshot hash.
- [ ] Create golden valid, malformed, spoofed, conflicting, and partial-history fixtures.

### 1.2 Public artifact projection

- [ ] Complete NIP-34 repository announcement projection.
- [ ] Complete issue projection and validation.
- [ ] Complete patch and pull-request projection and validation.
- [ ] Complete maintainer-authorized status projection.
- [ ] Bind immutable commits, trees, archives, and CI evidence.
- [ ] Preserve repository relay hints as hints rather than authority.
- [ ] Display incomplete history and unreachable relay warnings.

### 1.3 Funding and work projection

- [ ] Project current campaigns and milestones with source labels.
- [ ] Show frozen contract hash when one exists.
- [ ] Show task claims and progress without implying acceptance.
- [ ] Show evidence, verification, decisions, payout, and refund as distinct nodes.
- [ ] Explain service-backed versus relay-derived state.
- [ ] Reconcile conflicting state rather than selecting silently.

### 1.4 Workspace UI

- [ ] Build Overview view.
- [ ] Build Work view.
- [ ] Build Build/artifacts view.
- [ ] Build Discuss view with public/sealed boundary disclosure.
- [ ] Build Settle view with authority and custody explanations.
- [ ] Build unified provenance-aware timeline.
- [ ] Add skeleton, empty, partial-failure, and invalid-project states.
- [ ] Verify WCAG 2.1 AA and responsive behavior down to 360px.
- [ ] Preserve 2140.wtf's carnival character rather than generic project-management UI.

### 1.5 Human/machine parity

- [ ] Share the project snapshot library across React, CLI, and MCP.
- [ ] Implement `project discover` and `project get --json` equivalents.
- [ ] Include schema version, source events, authority explanation, and completeness in machine output.
- [ ] Use stable recoverable error codes.
- [ ] Verify UI and CLI/MCP produce the same snapshot from identical fixtures.

### Phase 1 exit gate

- [ ] UI and CLI/MCP snapshot hashes match for the same event set.
- [ ] Malformed pointers and spoofed authority events fail closed.
- [ ] Projects remain understandable during relay/API partial failure.
- [ ] Loading public project data from a sealed context requires an explicit privacy-aware transition.
- [ ] No private membership or presence enters public discovery.

## Phase 2 — Structured execution and evidence

**Target:** complete real software work end-to-end while settlement remains explicitly demo/testnet.

### 2.1 Frozen contracts

- [ ] Build contract creation, validation, review, and signature flow.
- [ ] Freeze repository announcement, base commit, criteria hashes, amounts, deadlines, authorities, and policy hash.
- [ ] Bind funding to the exact contract hash.
- [ ] Implement explicit multi-party amendment consent.
- [ ] Prevent mutable project/community metadata from changing funded terms.
- [ ] Define open-claim versus fixed-runner behavior.

### 2.2 Structured task execution

- [ ] Link milestone tasks to NIP-34 issues and immutable revisions.
- [ ] Add task claim/progress/block/handoff/submission UI using the shared fenced resolver.
- [ ] Build durable mutation outbox and idempotency handling.
- [ ] Re-resolve claims and delegation before every consequential action.
- [ ] Separate submitted, verified, accepted, resolved, and paid everywhere.

### 2.3 Repository agent tools

- [ ] Read repository tree/file at an immutable revision.
- [ ] List/show issues, patches, pull requests, and status.
- [ ] Publish valid NIP-34 work artifacts.
- [ ] Add explicit capability and authority checks to each operation.
- [ ] Prevent prompt-injected repository content from changing permissions or settlement behavior.

### 2.4 Evidence and verification

- [ ] Publish and parse `MilestoneEvidenceV1`-compatible evidence.
- [ ] Archive source with independently verified hashes.
- [ ] Bind verifier reports to workflow, toolchain, dependency lock, and network policy.
- [ ] Sandbox verification without production secrets.
- [ ] Cap verification attempts and total verification fees.
- [ ] Support conflicting verifier reports without silently choosing one.
- [ ] Verify evidence remains reproducible after repository force-push or host loss.

### 2.5 Capability and trust portfolio

- [ ] Publish expiring self-authored capability, tool, price, and availability declarations.
- [ ] Publish contract-bound counterparty attestations.
- [ ] Link repository evidence, decisions, disputes, reversals, and settlement receipts.
- [ ] Label self-claimed, attested, corroborated, reproducibly verified, settled, and disputed evidence.
- [ ] Compute optional reputation views locally under visible policy.
- [ ] Provide rebuttal/supersession paths for negative claims.
- [ ] Avoid universal opaque scores and global uncontextualized blacklists.

### 2.6 Context handoff

- [ ] Define minimized, versioned handoff package.
- [ ] Bind project, contract, milestone, task, claim epoch, and revision.
- [ ] Include decisions, completed steps, blockers, open questions, and artifact hashes.
- [ ] Encrypt to the intended receiver or authorized sealed channel.
- [ ] Reference scoped secret handles rather than copying secrets.
- [ ] Require receiver ACK and fresh claim/delegation verification.
- [ ] Enforce expiry and retention rules.

### Phase 2 exit gate

- [ ] At least 20 real project milestones complete on demo/testnet.
- [ ] Sampled handoffs achieve at least 90% successful resumption without private keys or unrelated history.
- [ ] Retries and duplicate delivery create no duplicate tasks, fees, decisions, or receipts.
- [ ] Archived evidence survives repository rewrite/unavailability tests.
- [ ] AI/verifier reports cannot independently authorize payment.

## Phase 3 — Bounded delegation and capped testnet economics

**Target:** exercise the complete permissions, objection, appeal, release, and refund system safely.

### 3.1 Agent delegation

- [ ] Separate identity, work-signing, and spending authority.
- [ ] Define principal, delegate, project, contract, milestone, community, repository, and audience scope.
- [ ] Define allowed actions, event kinds, service methods, and relays.
- [ ] Enforce per-action, cumulative, time, frequency, and concurrency limits.
- [ ] Restrict recipients, mints, payment rails, and verifier services.
- [ ] Add human-confirmation requirements for consequential actions.
- [ ] Implement expiry, revocation, session nonce, and audit receipts.
- [ ] Default money operations to dry-run without an explicit grant.

### 3.2 Milestone economics

- [ ] Allocate contributions per milestone rather than only at campaign level.
- [ ] Implement small tranches and explicit fee/expense budgets.
- [ ] Implement proof submission and optimistic objection window.
- [ ] Freeze donor eligibility and weights at the defined snapshot.
- [ ] Implement quorum and self-funding/Sybil mitigations.
- [ ] Implement runner/verifier/coordinator timeout branches.
- [ ] Implement deterministic release and refund authorization.
- [ ] Verify rail-specific payout/refund receipts.

### 3.3 Disputes and appeal

- [ ] Implement contract-bound objections with standing checks.
- [ ] Implement transparent tally and resolution artifact verification.
- [ ] Implement bonded appeal and court selection rules.
- [ ] Implement court-unavailable timeout/fallback.
- [ ] Link decisions, rebuttals, reversals, and receipts into the evidence graph.
- [ ] Keep markets informational and non-binding for irreversible payouts.

### 3.4 Adversarial simulation

- [ ] Relay censorship, partition, replay, reorder, and equivocation.
- [ ] Simultaneous claims, stale workers, handoff races, and duplicate delivery.
- [ ] Revoked/stale delegation and spend-cap bypass attempts.
- [ ] XSS, compromised signer, malicious dependency, and prompt injection.
- [ ] Runner self-funding, donor capture, colluding verifier, and reputation farming.
- [ ] Fee-drain retry and double-release attempts.
- [ ] Verifier, coordinator, court, mint, and artifact-host disappearance.
- [ ] Accidental private-context publication and traffic-correlation review.

### Phase 3 exit gate

- [ ] Every funded state has a bounded payout or refund path.
- [ ] Revocation blocks future tested actions within the documented propagation bound.
- [ ] Property/invariant tests find no double release or spend beyond delegation caps.
- [ ] All listed adversarial scenarios have test evidence and documented residual risk.
- [ ] Usability tests show users understand custody, authority, objection, and appeal.

## Phase 4 — Audited mainnet canary

**Target:** opt-in, low-limit real-sats software work with audited escape paths.

### 4.1 Prerequisites

- [ ] Independent protocol audit completed and findings resolved.
- [ ] Independent web/XSS security audit completed and findings resolved.
- [ ] Independent wallet/custody/settlement audit completed and findings resolved.
- [ ] Escrow/mint compatibility tests are reproducible.
- [ ] Incident response, emergency pause, and public status procedures exist.
- [ ] Refunds work during operator and relay outages.
- [ ] Architecture-specific legal/regulatory review is complete.
- [ ] User loss limits and uninsured risks are explicit.

### 4.2 Canary controls

- [ ] Allowlist initial projects and verifiers.
- [ ] Set small per-milestone, per-user, and system-wide caps.
- [ ] Require short-lived delegation and confirmation for policy changes.
- [ ] Stop new commitments without blocking valid withdrawals/refunds.
- [ ] Reconcile balances and receipts continuously.
- [ ] Define quantitative conditions for raising, freezing, or lowering limits.

### Phase 4 exit gate

- [ ] At least 100 capped milestones have complete receipt chains.
- [ ] No unresolved critical audit finding remains.
- [ ] Refund and dispute SLAs pass for two consecutive release cycles.
- [ ] Reconciliation finds zero unexplained balance or duplicate-settlement events.

## Phase 5 — Interoperability and domain expansion

**Target:** scale the work substrate without weakening its guarantees.

- [ ] Support decentralized project indexers and user-selectable ranking providers.
- [ ] Validate a second independent project-graph implementation.
- [ ] Validate multiple independent verifier implementations.
- [ ] Validate multiple settlement implementations where practical.
- [ ] Publish conformance fixtures and public test vectors.
- [ ] Add selective-disclosure evidence and receipt mechanisms.
- [ ] Package portable contract, delegation, and resolution policies.
- [ ] Establish schema/policy governance and compatibility rules.
- [ ] Require separate evidence, privacy, fraud, and settlement review for each non-software domain adapter.

## Cross-cutting release checklist

Apply to every implementation slice:

- [ ] Link an approved issue and explain 2140.wtf philosophy alignment.
- [ ] Identify the authority plane and trust boundary affected.
- [ ] Reuse existing NIPs before proposing new schemas.
- [ ] Author-filter trust-sensitive queries and validate event-derived ids/pubkeys.
- [ ] Sanitize event-derived URLs and CSS before rendering.
- [ ] Preserve loading, empty, partial, conflict, error, and recovery states.
- [ ] Ensure mutations update the UI without relying on stale cached state.
- [ ] Use fresh reads before replaceable/addressable mutations.
- [ ] Keep browser and Capacitor behavior compatible.
- [ ] Add tests only when requested or required by the project's testing policy.
- [ ] Run `npm run test` successfully.
- [ ] Self-review the complete diff.
- [ ] Commit with `2140wtf <hello@2140.wtf>` and no AI attribution trailer.

## Progress summary

| Phase | Status | Exit gate |
| --- | --- | --- |
| Phase 0 — Alignment | Not started | 0/6 |
| Phase 1 — Read-only graph | Not started | 0/5 |
| Phase 2 — Execution/evidence | Not started | 0/5 |
| Phase 3 — Delegation/testnet | Not started | 0/5 |
| Phase 4 — Mainnet canary | Not started | 0/4 |
| Phase 5 — Scale/adapters | Not started | Not gated yet |

## Open decisions

- [ ] Canonical project root and backwards-compatible adoption path.
- [ ] Existing-NIP versus extension versus custom-kind mapping.
- [ ] Fixed runner versus open-claim transition at funding.
- [ ] First testnet settlement policy and canonical policy hash.
- [ ] Acceptance rules for the first software milestone types.
- [ ] Custodian/coordinator and failure path for each payment rail.
- [ ] Initial milestone, user, verifier-fee, and system-wide caps.
- [ ] Default evidence disclosure classes.
- [ ] Negative-attestation rebuttal, supersession, and aging rules.
- [ ] Required independent implementation and audit gates.

## Concord privacy remediation

Source audit: [`BAO_CONCORD_PRIVACY_AUDIT.md`](BAO_CONCORD_PRIVACY_AUDIT.md).

Implementation rule: complete one narrow, reversible privacy slice at a time. Give it a focused regression test, full-suite validation, rollback notes, and a separate local commit. Do not bundle protocol, storage, relay, notification, and UI changes.

### P0 blockers

- [ ] Disable or template analytics pageviews for all private community and invite routes; test that no private identifier reaches analytics.
- [ ] Design strict privacy mode with no real-identity kind 13302/13303 publication; define legacy read/migration behavior, isolated storage transport, padding, and batching.
- [ ] Replace ambiguous leave/ban states with policy-muted, rekey-pending, and cryptographically-excluded states plus verifiable rekey completion.
- [ ] Test removal with a malicious client that ignores the banlist and retains old keys.

### P1 hardening

- [ ] Replace join-time global kind-0 requirements with encrypted community-scoped display names; make public profile publication optional and separate.
- [ ] Disclose direct-invite recipient metadata and design a blinded/private alternative; evaluate removing outer `k=3313`.
- [ ] Replace broad public/feed relay defaults for private communities with explicit minimal relay selection and privacy presets.
- [ ] Add instrumented-relay tests for outer events, queries, NIP-42 AUTH clustering, timing, size, and cross-community socket isolation.
- [ ] Default Concord notifications to generic text; keep sender, room, task, and content previews opt-in.
- [ ] Keep native Concord background notifications disabled until protected storage, lock-screen, purge, zeroization, and backup review passes.
- [ ] Add per-community cache retention and confirmed purge; redact and rotate CLI/MCP logs and provide a forget command.

### P2 privacy controls

- [ ] Separate authorization from roster visibility and support hidden/role-limited membership plus community-scoped pseudonyms.
- [ ] Make typing/presence opt-in for high-privacy communities and prohibit public projection.
- [ ] Permission-gate invite provenance and detailed recruitment audit data.
- [ ] Require consent before private invite-preview relay access in privacy mode; scrub capability fragments and set no-referrer policy.
- [ ] Correct public protocol/privacy documentation with outsider, relay, member, removed-member, and local-device disclosure matrices.

### Final action — independent privacy review

- [ ] After remediation and all tests pass, commission an independent relay-observer and compromised-client review; resolve critical/high findings, run `npm run test`, self-review the complete diff, and commit the approved privacy baseline locally before enabling any new public work projection.
