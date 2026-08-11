# ₿AO Open-Source Workspaces

Status: architecture proposal and pre-mainnet requirements. This document
connects the existing Concord, NIP-34, agent-orchestration, ₿AO Fund, and
Routstr pieces. Target behavior below is not a guarantee of the current demo
backend.

## Current reality and target

| Capability | Current state | Target |
| --- | --- | --- |
| Concord collaboration | Shipped, sealed content; metadata leakage documented below | Dedicated community-isolated transport and reliable agent rekey sync |
| NIP-34 | Public repository/patch/PR cards exist; issue/status coverage is incomplete | Repo-scoped workspace and evidence projection |
| Fund campaigns | Demo accounting; contributions are pooled at campaign level and markets currently gate demo release | Explicit per-milestone allocation and a pinned production settlement policy |
| Routstr compute | Real Cashu-funded compute credit; not wages or payment proof | Contract-capped project expense/advance with unused-credit rules |
| Mainnet work settlement | Not shipped | Audited escrow, deterministic refund paths and independently proven appeals |

## Product loop

The first workspace type is open-source software:

1. An agent or human proposes work with a public scope, repository, milestones,
   budget, deadline, acceptance criteria, and settlement policy.
2. Funders commit to the proposal. The target escrow allocates funds to
   milestone tranches; today's demo pools campaign contributions. A chat
   `CLAIM` is never authority to move money.
3. Humans and agents collaborate in sealed ₿AO channels while public code work
   is represented by interoperable NIP-34 issues, patches, pull requests, status
   events, and immutable Git commit hashes.
4. Each milestone exposes a single progress timeline: draft, funded, claimed,
   in progress, submitted, review, accepted or disputed, paid or refunded.
5. Submission creates an immutable evidence bundle. Verification and the
   contract's pinned resolution policy decide settlement.

The same planes and workspace shell may later support art, fishing, research,
or local groups. Their physical-world oracle, privacy, reviewer competence,
fraud, retention, and appeal assumptions require separate settlement policies;
they are not merely Git with a different evidence adapter.

## Three planes, one workspace

The UI may feel like one project, but its authorities must remain separate:

| Plane | Carries | Authority |
| --- | --- | --- |
| Public artifact | NIP-34 repository, issue, patch, PR and status events; commit hashes | Signatures prove authorship; only declared-maintainer definition/state/status events carry maintainer authority |
| Sealed coordination | Discussion, private scope details, credentials, agent CLAIM/PROGRESS/DONE/HANDOFF | Concord membership and scoped community roles |
| Settlement | Contract, funding ledger, evidence bundle, objections, resolution and payout | Pinned campaign policy and escrow/backend verification |

A repository is therefore a workspace surface, not literally a chat channel.
Relay or chat availability must never become payment truth.

## Immutable funded-work contract

The client now contains the pure, canonical/hash-addressed `WorkContractV1`
and `MilestoneEvidenceV1` validation core in `src/lib/baoWorkContract.ts`.
It is intentionally not accepted as payout authorization yet: the fundraising
backend must persist the frozen contract and return a contract-bound,
authority-signed release decision before the UI may use it for settlement.

The future production contract must freeze at funding time:

- contract and campaign identifiers;
- runner identity or the open-claim rule and required bond;
- NIP-34 repository coordinate (`30617:<owner>:<identifier>`), repository
  relay hints, and base commit;
- exact scope, acceptance criteria, allowed evidence types, amount and deadline;
- verifier policy identifier, version and content hash;
- review/objection windows, donor-snapshot rule and appeal route;
- gross payout, fee schedule, verification-attempt limit and total fee cap;
- public artifact mode, cancellation terms, failure fallbacks and refund conditions.

Replaceable project metadata is presentation, not the contract. A scope change
creates a signed amendment accepted by the runner and the contract's funder
threshold. It never silently edits funded terms.

## Evidence bundle for code

Free-form links are commentary. The proposed settlement evidence binds
immutable objects:

- contract and milestone id;
- repository `a` coordinate, issue event id and base commit;
- delivered commit/tree hash and patch or pull-request event ids;
- test command plus build/environment hash;
- CI result and provenance from contract-pinned verifier pubkeys, workflow
  hash, toolchain/container digest, dependency lock and network policy;
- evidence-manifest hash and submission signature.

Verification checks out the exact commit in a sandbox without production
secrets and with constrained network access. Important artifacts need at least
two repository servers plus an independently hashed source archive so a
force-push, deleted host, or unavailable relay cannot rewrite the evidence.

Payment is for a contract-conforming, independently reviewable delivery—not
automatically for a chat `DONE`, a runner-controlled test, or maintainer merge.
If a contract requires merge or deployment, it must also pin the responsible
maintainer, review SLA, upstream/base-change rules, rework funding, and a
deemed-acceptance or independent-review fallback so a maintainer cannot hold a
valid contributor hostage. Security work may use an explicitly embargoed
artifact lane and later signed declassification instead of publishing a
zero-day in NIP-34.

Every proposal must pin its repository license and contribution terms, require
runner authorship/provenance attestation, and define secret/license/dependency
scanning, generated/binary policy, SBOM expectations and sandbox limits.

## Agent interface

The MCP/CLI surface should expose resumable, machine-readable operations:

- workspace and milestone discovery;
- channel-selectable read/send/wait;
- issue list/show/claim;
- repository tree/file at an immutable revision;
- patch/PR publish and status update;
- milestone contract, progress and evidence submission;
- compute-credit request/redeem with secrets delivered only through sealed
  Concord or NIP-17, never public NIP-34 events;
- durable outbox, idempotency keys and explicit recoverable error codes.

The orchestration verbs coordinate workers. `DONE` means "submitted by the
claimant," not "accepted" or "paid."

## Settlement safety gate

The repository currently describes two different policies: shipped v2/demo UI
says prediction-market resolution gates milestones, while
`BAO_FUND_RESOLUTION.md` says markets are non-binding signals and donor
attestation/court settles real payouts. No mainnet software-work contract may
be offered until one canonical policy is selected, versioned, content-hashed,
and pinned in every funded contract. AI assessment produces evidence; it is
not the sole irreversible payout oracle.

Before mainnet, deterministic simulations must cover runner disappearance,
relay censorship/partition, stale or double claims, force-push after submission,
mutable tests/dependencies, verifier outage and prompt injection, fee-drain
reruns, donor capture and runner self-funding, missing quorum/court, Cashu mint
failure, criteria amendment, repository loss, and an accidental public leak of
a private project.

## Privacy boundary

Open-source artifacts and their authors are intentionally public. Sealed
coordination hides content, but community relays still observe connections,
stream addresses, timing, padded ciphertext-size buckets, and NIP-42 possession
proofs. The current shared relay socket can also link a logged-in pubkey to
derived stream keys and link communities on the same relay. A dedicated,
stream-only Concord transport, preferably isolated per community, is required
before claiming relay-unlinkable membership. IP correlation remains unless the
member uses a trusted proxy or private relay.

## Delivery stages

1. Security/correctness: safe relay and media boundaries, deterministic rekey
   assembly, dedicated Concord transport, headless rekey convergence and real
   multi-channel agent operations.
2. Read-only workspace: canonical NIP-34 coordinate; repository, issues,
   patches, PRs and status aggregation; unified project timeline.
3. Agent work: repository MCP tools, durable jobs/outbox, signed contract and
   evidence bundles, CI provenance. Settlement remains demo-only.
4. Economic pilot: pinned optimistic/donor/court policy, bonds, amendments,
   fee caps and failure simulations on testnet with small tranche limits.
5. Independently audited escrow/court followed by an opt-in capped mainnet
   canary with monitoring, emergency pause, deterministic refunds and gradual
   limit increases.
