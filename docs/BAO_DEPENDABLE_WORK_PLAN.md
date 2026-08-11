# From Communication to Dependable Work

## A product, protocol, and delivery plan for 2140.wtf and ₿AO

**Status:** Strategy and implementation plan

**Planning horizon:** 18–24 months, delivered through bounded vertical slices

**North star:** Nostr is where people and agents discover each other, coordinate private or public work, verify progress, and settle outcomes.

## Executive summary

2140.wtf and ₿AO should become a dependable-work environment, not a generic project-management suite and not a payment layer attached to chat. The distinctive opportunity is to combine Nostr's portable identity and open event graph, Concord V2's sealed communities, NIP-34's public software artifacts, and Bitcoin-native settlement into one coherent experience for humans and agents.

The repository already contains significant foundations:

- sealed Concord V2 communities, channels, membership, and agent-access tooling;
- fenced and idempotent agent task claims with progress, handoff, completion, and blocking verbs;
- a validated public NIP-34 repository projection linked from private communities;
- ₿AO Fund campaigns and milestones, currently operating with demo and service-backed accounting;
- canonical, hash-addressed `WorkContractV1` and `MilestoneEvidenceV1` primitives;
- compute-credit requests, fulfillment records, and receipts;
- milestone attestation, court, and escrow research and prototypes;
- NIP-60/61 wallet support and multiple payment rails.

The main deficit is convergence. Discovery, conversation, repository work, milestone state, evidence, reputation, and settlement exist as separate surfaces with different authority models. The plan therefore starts by defining a canonical project work graph and a strict separation of authority, then proves the system through an open-source software vertical slice before generalizing it.

The recommended order is:

1. Build a read-only project workspace that joins an existing ₿AO, NIP-34 repository, funding campaign, milestones, discussions, and evidence into one verified graph.
2. Add structured work contracts, task execution, agent capability profiles, evidence submission, and acceptance while settlement remains demo-only.
3. Add capped testnet settlement using an optimistic milestone policy, donor objections, deterministic refunds, and an appeal path.
4. Introduce an independently audited, opt-in mainnet canary with small limits and progressive decentralization of settlement services.
5. Expand from open-source work to other domains only through explicit evidence and settlement adapters.

This approach creates useful product value early without pretending that signed claims are verified facts or that experimental payment flows are production escrow.

## 1. Product doctrine

### 1.1 The stronger 3×3

| Human need | Nostr advantage | Required infrastructure |
| --- | --- | --- |
| Communities | Portable identity | Private membership and metadata protection |
| Collaboration | Open app interoperability | Tasks, repositories, milestones, and evidence |
| Sustainable funding | Native payments | Escrow, receipts, reputation, and disputes |

The infrastructure column is the product. Identity, messages, and payments become dependable work only when the system can answer five questions:

1. What exactly was agreed?
2. Who is authorized to act, and within what limits?
3. What evidence shows that the work happened?
4. Who may accept, object, appeal, pay, or refund?
5. Can another compatible client independently reconstruct the answer?

### 1.2 Product principles

1. **One workspace, multiple authority planes.** The interface may feel unified, but chat, code, reputation, and money never share implicit authority.
2. **Evidence before scores.** Reputation is a portable portfolio of signed, inspectable evidence. Scores are optional local views over that evidence.
3. **Progressive commitment.** Browsing and discussion are cheap; proposals add explicit terms; funding freezes them; settlement requires the strongest verification.
4. **Cheap success path, expensive dispute path.** Most milestones should settle after evidence and an objection window. Courts exist for exceptional conflict, not routine approval.
5. **Humans and agents use the same event graph.** The UI and machine tools expose the same objects, state transitions, permissions, and receipts.
6. **Privacy is data minimization.** Private membership is not converted into a public credential. Public evidence reveals only what a funded contract requires.
7. **No false decentralization.** Relay-backed claims, API ledger entries, custodial balances, Cashu escrow, and on-chain payments must be labeled according to their actual trust and custody properties.
8. **A carnival, not enterprise boilerplate.** Work should feel participatory and alive: project worlds, visible construction, playful milestones, and portable artifacts—without engagement manipulation.

### 1.3 Initial users

The first release should optimize for four participants:

- **Project steward:** creates a public project, attaches a repository and ₿AO, defines funded work, reviews submissions, and communicates decisions.
- **Contributor:** discovers work, evaluates terms, collaborates, submits evidence, and receives payment or a reasoned rejection.
- **Agent operator:** publishes scoped capabilities, delegates a bounded job to an agent, monitors authority and spending, and can revoke it.
- **Funder/reviewer:** funds a milestone, observes evidence, accepts by silence or explicit approval, objects with standing, and receives a refund when policy requires it.

Open-source software is the first domain because commits, trees, patches, tests, repositories, and maintainer signatures provide unusually strong evidence. Physical-world, creative, research, and local-service work require separate evidence adapters and must not inherit software verification assumptions.

## 2. Current-state assessment

### 2.1 Foundations to preserve

| Capability | Current foundation | How the plan uses it |
| --- | --- | --- |
| Private communities | Concord V2 sealed streams and invite flows | Coordination plane for scope, discussion, credentials, and private context |
| Agent access | `bao-agent` CLI and `bao-chat-mcp` | Machine interface expanded into workspace and milestone operations |
| Task ownership | Fenced CLAIM/PROGRESS/HANDOFF/DONE/BLOCKED fold | Execution coordination; never payment authority |
| Public code work | NIP-34 repository pointers and verified project projection | Public artifact plane and immutable evidence references |
| Funding | ₿AO Fund campaign/milestone UI and service integration | Product shell migrated toward contract-bound milestone accounting |
| Contract integrity | `WorkContractV1` canonicalization and validation | Frozen settlement terms and amendment chain |
| Delivery evidence | `MilestoneEvidenceV1` | First evidence manifest for code work |
| Trust evidence | Compute-credit receipts and donor corroboration | Seed for a general evidence portfolio, without universal scores |
| Disputes | Attestation, resolution, and ₿AO Court research | Testnet policy candidate after specification consolidation |
| Payments | NIP-60/61, on-chain receipts, Lightning and other rails | Rail-specific funding, payout, and refund proofs |

### 2.2 Gaps to close

- No canonical project identity connects community, campaign, repository, orchestration, and settlement objects.
- Current funding state is split between relay events and a service-backed ledger.
- Orchestration manifests and task chat are not yet a durable public/private project model.
- `DONE` can be mistaken for accepted work unless the UI and protocol make submission, acceptance, resolution, and payment separate states.
- Capability and reputation signals are narrow and not represented as portable evidence portfolios.
- Agent delegation does not yet provide general fine-grained permissions, spending limits, expiry, or revocation.
- Concord protects content but still leaks traffic shape and may allow cross-context correlation at the transport layer.
- Mainnet milestone escrow, refunds, and court enforcement are not production-ready or independently audited.
- Discovery is fragmented across communities, campaigns, repositories, and agents.
- Context handoff exists as a task verb, but not as a minimized, encrypted, resumable work package.

### 2.3 Truthful status vocabulary

Every surface and document should use the following labels consistently:

- **Shipped:** implemented and supported in the production client.
- **Demo/testnet:** works with valueless or constrained funds and must not imply production safety.
- **Experimental:** implemented but with unresolved protocol, security, or interoperability risk.
- **Proposed:** designed but not implemented.
- **Verified:** checked against a declared verification method; always name that method.
- **Settled:** the relevant rail confirms payout or refund under the frozen policy.

## 3. Target architecture: one graph, three planes

### 3.1 Canonical project work graph

Each project is a graph rooted in a stable project coordinate. It connects, rather than duplicates, domain objects:

```text
Project
├─ identity and presentation
│  ├─ owner/stewards
│  ├─ public description and discovery tags
│  └─ sealed ₿AO community coordinate
├─ public artifacts
│  └─ NIP-34 repository coordinate
│     ├─ issues and proposals
│     ├─ patches and pull requests
│     ├─ maintainer status events
│     └─ commits, trees, archives, and CI attestations
├─ work
│  ├─ work contract and amendments
│  ├─ milestones
│  │  ├─ tasks and claims
│  │  ├─ progress and discussions
│  │  ├─ evidence submission
│  │  └─ acceptance, objection, appeal, and resolution
│  └─ context handoffs
└─ settlement
   ├─ funding commitments and deposits
   ├─ fee/expense authorizations
   ├─ payout or refund decisions
   └─ rail-verifiable receipts
```

The project coordinate is a join key, not universal authority. Each edge records its provenance and authorization. For example, a community owner may attach a repository for discovery, but a funded contract separately freezes the repository coordinate and announcement event. Editing community metadata cannot redirect settlement to a different repository.

### 3.2 Authority planes

| Plane | Carries | Authority | Failure must not imply |
| --- | --- | --- | --- |
| Public artifact | Project presentation, NIP-34 objects, commits, evidence references | Event authorship; declared maintainers for repository status | Payment approval |
| Sealed coordination | Private discussion, credentials, task claims, handoffs, sensitive scope | Concord membership and scoped roles | Public identity or settlement authority |
| Settlement | Frozen terms, deposits, objections, decisions, payouts/refunds | Contract-pinned policy and verified rail state | Ownership of chat or repository |

This separation produces several non-negotiable rules:

- A chat `DONE` means the claimant says work is submitted; it never means accepted or paid.
- A merged pull request is evidence only unless the contract explicitly defines merge as an acceptance condition and a fallback exists for maintainer non-cooperation.
- A reputation badge cannot authorize a payout.
- Mutable project or community metadata cannot change funded terms.
- An AI verifier may contribute a signed report but cannot be the sole irreversible payout oracle.
- Relay silence is unknown, not approval, absence, or availability.

### 3.3 Read model and interoperability

Clients build a project snapshot from independently validated projections:

1. Resolve the project coordinate with an author-filtered query.
2. Validate each linked coordinate and its declared authority.
3. Query related kinds efficiently, grouped by relay and kind where possible.
4. Validate schemas and signatures before inserting nodes or edges.
5. Fold replaceable/addressable events by `(kind, pubkey, d)` and immutable events by id.
6. Preserve conflicts, deletions, amendments, and partial-result warnings rather than manufacturing a single clean history.
7. Cache the derived graph locally with source event ids and a reproducible snapshot hash.

The web UI, CLI, and MCP server should consume the same domain library and return the same state names. JSON output should include `schema_version`, source coordinates, completeness indicators, authority explanations, and recoverable error codes.

## 4. Protocol strategy

### 4.1 Reuse before invention

The protocol workstream must begin with a current NIP review. Candidate standards include:

- NIP-01 for base events and replaceability semantics;
- NIP-19 for portable coordinates;
- NIP-22 for comments on non-note objects;
- NIP-31 for human-readable `alt` tags;
- NIP-34 for repositories, issues, patches, pull requests, and status;
- NIP-44 and NIP-59 patterns for encrypted payload delivery;
- NIP-57, NIP-60, and NIP-61 for Lightning/Cashu-related evidence and payments;
- NIP-73 for external and content identifiers;
- NIP-85-shaped assertions only where semantics remain compatible;
- NIP-98 for authenticated service calls while a settlement coordinator exists.

No new kind number should be selected in this planning document. Before implementation, the team must search the live NIP index, review candidate NIPs in full, use the project's kind-generation process if a custom kind remains necessary, and document the schema in `NIP.md` with a NIP-31 `alt` tag.

### 4.2 Minimal schema families

The likely model needs semantic families, but implementation should minimize new kinds by using categories and references where storage semantics match.

#### Project definition

An addressable, steward-authored definition containing public title/summary, discovery categories, a Concord community pointer, a NIP-34 repository pointer, and optional active campaign/work-contract references. Queryable categories use `t` tags. Private membership, member lists, presence, internal channel identifiers, and secrets never appear here.

#### Frozen work contract

An immutable or version-addressed contract envelope whose canonical content hashes the validated `WorkContractV1`. It binds:

- campaign and creation event;
- owner, runner/open-claim rule, payout key, and verifier authorities;
- NIP-34 coordinate, repository announcement event, maintainers, and base commit;
- milestone amounts, deadlines, criteria and criteria hashes;
- settlement policy id, version, and content hash;
- objection, appeal, amendment, cancellation, fee, and refund rules;
- permitted public/private evidence classes.

Funding references the exact contract hash. An amendment creates a new hash and explicit consent events from the affected parties; it never overwrites the funded object.

#### Milestone evidence

The existing `MilestoneEvidenceV1` is the correct starting point for code work. It binds the contract, repository, issue, base and delivered commits/trees, artifact ids, acceptance criteria, archive hash, test command, workflow hash, and toolchain hash. Future adapters can add domain-specific evidence without weakening the common envelope.

#### Decisions and receipts

Separate event semantics are required for:

- evidence submission;
- acceptance or objection;
- appeal and final resolution;
- funding/deposit acknowledgment;
- payout or refund decision;
- rail proof.

A signed sender statement is not a payment proof. Verification is rail-specific: on-chain clients check the transaction and expected output; Lightning uses invoice/preimage or trusted service proof with privacy constraints; Cashu verifies mint/quote/proof state without publishing bearer proofs. Silent payments deliberately provide limited public donor attribution.

#### Capability and evidence claims

Agent capability profiles should be a portfolio, not an omniscient profile record:

- self-authored capability declarations: domains, tools, interfaces, price model, availability, supported relays, and policy constraints;
- third-party attestations bound to a work contract or milestone;
- repository evidence and immutable artifacts;
- payment outcome references;
- expiry, supersession, revocation, and rebuttal references;
- a privacy class indicating public, selectively disclosed, or private evidence.

Self-claims must be labeled self-claimed. Counterparty attestations identify the issuer. Independently reproducible evidence names its verifier and method.

### 4.3 State machine

The canonical milestone lifecycle should be:

```text
draft → offered → funding → funded → claimable → claimed → in-progress
  → submitted → review
       ├─ no valid objection before deadline → accepted
       ├─ explicit acceptance               → accepted
       └─ objection                         → disputed
              ├─ resolution YES → accepted
              ├─ resolution NO  → rejected/refund
              └─ appeal         → final resolution

accepted → release-authorized → paid
rejected/cancelled/timeout → refund-authorized → refunded
```

`blocked` is an execution condition, not a terminal settlement state. `handoff` releases execution ownership but does not change the funded contract unless runner identity is contractually fixed; if it is fixed, runner substitution requires an amendment.

Every transition records actor, source event, contract hash, prior state reference, time-window validation, and policy explanation. Consumers reject impossible transitions and display unresolved conflicts.

## 5. Verifiable trust

### 5.1 Trust doctrine

A Nostr signature proves control of a key at signing time. It does not prove legal identity, competence, truth, authorization, delivery, acceptance, or payment. The product should distinguish:

- **Self-claimed** — signed by the subject.
- **Attested** — signed by an identified counterparty or issuer.
- **Corroborated** — supported by independent issuers or evidence sources.
- **Reproducibly verified** — checked under a named workflow and toolchain.
- **Settled** — accompanied by verified payout/refund state on the relevant rail.
- **Disputed/reversed** — linked to the objection, decision, refund, or superseding evidence.

### 5.2 Evidence graph, not global score

The portable trust record is an evidence graph keyed by subject, domain, contract, and issuer. A client may compute a score or ranking locally, but must expose the policy that produced it:

- issuer allowlist or trust graph;
- capability domain;
- evidence age and decay;
- completed, disputed, refunded, or reversed amounts;
- independent issuer count;
- verification method and coverage;
- conflicts and missing evidence.

The UI should favor statements such as "4 independently funded TypeScript milestones settled; 1 disputed and refunded" over "Trust score: 82." Negative evidence must remain contextual, link to the underlying contract and appeal/rebuttal, and never become an unchallengeable global blacklist.

### 5.3 Receipt ladder

Each job should produce a chain of increasingly strong receipts:

1. Proposal and contract receipt.
2. Funding authorization and custody/deposit proof.
3. Task claim and progress record.
4. Milestone evidence submission.
5. Verification reports and acceptance/objection decision.
6. Final resolution or appeal artifact.
7. Payout or refund authorization.
8. Rail-verifiable settlement proof.

The project timeline visually connects these receipts while explaining which party attested each fact.

### 5.4 Discovery

Discovery indexes public, minimally disclosed projections:

- projects by topic, stage, repository language/license, funding need, and settlement policy;
- work opportunities by capability, budget, deadline, evidence method, and privacy requirements;
- agents by self-declared capability plus evidence coverage;
- communities only when their owners opt into public discovery;
- funders/reviewers by explicit public roles, not inferred private membership.

Ranking should be understandable and user-selectable: newest, deadline, funded percentage, followed issuers, relevant capabilities, or locally computed evidence quality. Avoid engagement-maximizing black-box ranking.

## 6. Agent capability, delegation, and context handoff

### 6.1 Capability profile

An agent profile should answer:

- what work it can attempt and what it refuses;
- supported tools and machine interfaces;
- pricing unit, minimum/maximum job size, and fee caps;
- availability window and response SLA;
- required data access and execution environment;
- accepted payment rails;
- signed evidence from completed work;
- operator and autonomy disclosure, where voluntarily public;
- expiry and last-confirmed timestamp.

Availability and price are replaceable, short-lived claims. Completed-work evidence is immutable or explicitly superseded. A capability declaration never grants access.

### 6.2 Delegation object

Agent authority must be deny-by-default and expressed as a scoped, expiring grant. A grant should bind:

- principal, delegate, and optional operator;
- project, contract, milestone, community, and repository scope;
- allowed actions, event kinds, service methods, and relay audiences;
- maximum per-action and cumulative spend;
- time, frequency, and concurrency limits;
- allowed recipients, mints, rails, and verifier services;
- whether human confirmation is required;
- expiry, nonce/session id, revocation reference, and audit destination.

Identity keys, work-signing keys, and spending keys should be separate. An agent never receives a user's raw nsec or unrestricted wallet/NWC secret. Prefer constrained NIP-46-style signing sessions, isolated wallet capabilities, hardware/native confirmation for consequential actions, and one-time/allowance-based payment tokens.

Before every side effect, the executor re-resolves the current task fence and delegation, then records an intent and result receipt. Revocation stops future actions but does not erase past receipts.

### 6.3 Context handoff

A handoff package enables another worker to resume without keys or unrelated history. It contains:

- project, contract, milestone, task, claim epoch, and immutable revision;
- current objective, completed steps, blockers, decisions, and open questions;
- artifact hashes and source event references;
- minimized excerpts or encrypted attachments needed for the task;
- granted capabilities and their remaining budgets/expiry;
- explicit exclusions and data-retention deadline;
- sender signature and receiver acknowledgment.

Handoffs are encrypted to the intended receiver or delivered inside the authorized Concord channel. Secrets are referenced through scoped capability handles, never copied into the package. The receiving agent verifies the task fence and delegation before acting and publishes an ACK. The old agent publishes HANDOFF and relinquishes the claim.

## 7. Safety, privacy, and accountability

### 7.1 Security invariants

1. No single event, relay, client, model, verifier, or operator may both approve work and move money.
2. Settlement always binds to a frozen, validated contract hash.
3. Trust-sensitive queries are author-filtered and all referenced ids/pubkeys are validated before use.
4. Relays may omit, replay, reorder, or equivocate; folds are deterministic, idempotent, and conflict-aware.
5. Mutable metadata is presentation, never funded terms.
6. Spending authority is scoped, bounded, expiring, revocable, and separately auditable.
7. Private membership and presence never become public reputation inputs without explicit disclosure.
8. Failure defaults protect funds: unknown state does not mean accepted, paid, claimable, or refunded.
9. Every payout and refund is idempotent and produces a durable receipt.
10. Mainnet limits increase only after measured safety gates and independent review.

### 7.2 Threat model

Design and tests must cover:

- malicious or compromised contractors, funders, reviewers, jurors, and verifiers;
- Sybil donors, self-funding runners, colluding issuers, and reputation farming;
- browser XSS, malicious event content, unsafe URLs/CSS, and compromised dependencies;
- compromised signers, wallet connectors, agent runtimes, or service credentials;
- malicious relays withholding, duplicating, reordering, censoring, or correlating traffic;
- compromised ₿AO bridges, APIs, mints, escrow operators, and artifact hosts;
- stale delegations, replayed authorizations, double release, fee-drain retries, and race conditions;
- repository force-pushes, mutable dependencies, falsified CI, prompt injection in source or issues, and verifier compromise;
- private-context leakage through public artifacts, logs, handoffs, telemetry, and traffic analysis;
- dispute capture, missing quorum, unavailable court, and indefinite lockup.

Because browser-held nsec material turns XSS into key theft, CSP and sanitization are settlement prerequisites, not frontend polish. Continue to prohibit unsafe HTML, sanitize event-derived URLs and CSS, validate Nostr ids at parse boundaries, require confirmation for consequential signatures, minimize secrets in local storage, and prefer isolated signers for money authority.

### 7.3 Privacy model

Concord V2 protects content and direct membership data, but relays can still observe stream activity, timing, ciphertext size buckets, IP/TLS/browser correlation, and NIP-42 behavior. The product must not promise anonymous membership.

Required improvements:

- dedicated Concord transport separated from identity and public-project traffic;
- optional transport isolation per sensitive community;
- padding and batching policies measured against bandwidth and latency;
- explicit navigation before loading public repository/project relays from a sealed room;
- private relay and proxy guidance for high-sensitivity communities;
- no public presence by default; coarse, expiring, opt-in presence when enabled;
- selective disclosure of attestations and receipts;
- retention controls for decrypted caches, handoffs, and local agent logs;
- reliable rekey convergence after removal, with clear warnings during exclusion windows.

Invite-link single use is currently an honest-client mechanism until key rotation. The UI and protocol must treat rekey as the hard exclusion boundary.

### 7.4 Settlement and custody model

The production target is per-milestone rather than pooled campaign custody, with explicit rail and risk disclosures.

Recommended policy ladder:

1. **Tranches where possible:** small time-based or deliverable-based units limit exposure and simplify exit.
2. **Optimistic acceptance:** valid evidence opens an objection window; silence under a declared policy may accept.
3. **Stake-bound donor attestation:** valid funders may object and vote under a frozen snapshot with documented quorum and capture risks.
4. **Bonded appeal:** an independent, auditable court path for exceptional disputes.
5. **Deterministic timeout/refund:** runner, verifier, coordinator, relay, mint, or court disappearance cannot lock funds forever.

Markets can provide forecasting and accountability but should not gate irreversible mainnet payouts. AI evaluation supplies a verification report, never sole settlement authority. The final policy must reconcile the repository's current demo behavior and resolution drafts into one versioned, content-hashed specification before a real-sats work contract is offered.

Custody labels must distinguish:

- self-custodied funds;
- Cashu bearer proofs and mint risk;
- NWC or connector-controlled spending;
- coordinator/escrow service custody;
- script-enforced multisignature or timelock;
- demo ledger balances with no redemption claim.

## 8. User experience

### 8.1 Project workspace

The workspace should have five stable views backed by one graph:

1. **Overview:** purpose, stewards, repository, community, current funding, active milestones, and trust/custody disclosures.
2. **Work:** proposals, milestones, task ownership, status, dependencies, deadlines, and calls to action.
3. **Build:** issues, patches/PRs, commits, CI, deliverables, and evidence bundles.
4. **Discuss:** explicit transition into public or sealed discussions, with privacy consequences shown before loading external relays.
5. **Settle:** contract terms, fund allocation, objection/appeal windows, decisions, payouts/refunds, and receipt verification.

Each status shows who asserted it and what would advance it. For example: "Submitted by Agent A; awaiting verifier report and a 72-hour donor objection window," not merely "In review."

### 8.2 Human/machine parity

Every consequential UI action maps to a machine operation with the same validation:

- `project discover|get|watch`
- `work list|offer|claim|progress|handoff|submit`
- `evidence get|verify`
- `decision accept|object|appeal`
- `fund quote|commit|status`
- `settlement release|refund|receipt`
- `delegation grant|inspect|revoke`

Machine responses include `dry_run`, required authority, projected spend, confirmation requirement, idempotency key, source events, and resulting receipt. Money-moving commands default to dry-run until an explicit grant permits execution.

### 8.3 Key journeys

#### Steward creates funded work

Create or select project → attach validated NIP-34 repository → attach/create ₿AO → define milestones and evidence criteria → choose a versioned settlement policy → review custody and failure paths → sign/freeze contract → open funding.

#### Contributor completes a milestone

Discover opportunity → inspect contract and evidence expectations → join public/sealed workspace as needed → claim task under fence → work at pinned base revision → publish patch/PR and evidence manifest → respond to review → receive acceptance/resolution → verify payout receipt → add the evidence to their portable portfolio.

#### Operator delegates to an agent

Select task → see requested capabilities and worst-case spend → issue time/amount/action-bounded grant → agent dry-runs and claims → operator sees audit stream and can revoke → agent submits evidence → acceptance and payout use separate authority.

#### Funder objects

Open milestone evidence → inspect contract, verifier output, and conflict disclosures → object within window with a contract-bound reason → participate in declared resolution flow → appeal if eligible → verify payout/refund outcome.

## 9. Delivery roadmap

The roadmap uses exit criteria rather than dates alone. A phase does not graduate because its UI is complete; its authority, failure, and interoperability properties must pass.

### Phase 0 — Align the contract and vocabulary (0–6 weeks)

**Outcome:** one documented domain model and no contradictory claims about current settlement.

Deliverables:

- inventory shipped, demo, experimental, and proposed capabilities;
- canonical state vocabulary and authority matrix;
- reconcile `BAO_FUND.md`, `BAO_FUND_RESOLUTION.md`, `BAO_OPEN_SOURCE_WORK.md`, and UI copy;
- choose the first settlement policy candidate and assign a stable version/hash process;
- current NIP review and event-kind decision records;
- project graph TypeScript model and validators, with no publishing yet;
- threat model, privacy data-flow map, custody map, and abuse cases;
- baseline product telemetry that does not expose private membership.

Exit criteria:

- every current feature is correctly labeled;
- no document or screen claims demo/AI/market state is production settlement;
- maintainers approve the authority matrix and state machine;
- all proposed protocol additions have reuse/custom-kind decisions.

### Phase 1 — Read-only project graph (6–12 weeks)

**Outcome:** a user can open one project and understand its community, repository, funding, work, and evidence without changing state.

Deliverables:

- stable project coordinate and validated relationship model;
- project snapshot library shared by React, CLI, and MCP;
- author-filtered NIP-34 repository/issues/patches/PR/status aggregation;
- campaign and milestone projection with explicit service/relay sources;
- unified project timeline with provenance and partial-result warnings;
- overview/work/build/discuss/settle workspace shell;
- discovery index for public projects and opportunities;
- explicit privacy boundary before contacting public artifact relays from sealed contexts.

Exit criteria:

- two independent clients or the UI and CLI derive matching snapshot hashes from the same event set;
- malformed pointers and spoofed authority events fail closed;
- the project remains understandable during relay/API partial failure;
- no private membership data enters the public index.

### Phase 2 — Structured execution and evidence, demo settlement (3–6 months)

**Outcome:** humans and agents can complete a software milestone end-to-end with a frozen contract and reproducible evidence, while money remains explicitly demo/testnet.

Deliverables:

- contract creation/review/freeze and explicit amendment flow;
- milestone task decomposition linked to NIP-34 issues;
- task-claim UI using the existing fenced resolver;
- durable outbox and idempotent machine operations;
- repository MCP tools at immutable revisions;
- evidence submission using `MilestoneEvidenceV1`;
- sandboxed verification reports with workflow/toolchain hashes and fee caps;
- capability profiles and evidence portfolio v1;
- minimized encrypted context-handoff packages;
- consistent `submitted`, `verified`, `accepted`, `resolved`, and `paid` states.

Exit criteria:

- at least 20 real project milestones complete on demo/testnet;
- another agent can resume 90% of sampled handoffs without receiving the prior agent's private key or unrelated history;
- duplicate deliveries/retries cannot create duplicate tasks, charges, decisions, or receipts;
- evidence remains verifiable after a repository force-push using archived hashes;
- no AI report can independently authorize payment.

### Phase 3 — Delegation and capped testnet economics (6–10 months)

**Outcome:** bounded agents and funders exercise the full acceptance, objection, refund, and appeal flows with valueless or strictly capped funds.

Deliverables:

- scoped delegation grants, revocation, confirmation gates, and audit trail;
- per-milestone allocation and fee/verification budgets;
- optimistic acceptance with explicit objection window;
- frozen donor snapshot, quorum, timeout, and self-funding mitigations;
- deterministic runner/verifier/coordinator timeout branches;
- appeal/court integration and bonded abuse controls;
- rail-specific payout/refund receipts;
- privacy-preserving receipt disclosure and reputation conflict handling;
- simulation harness for partitions, races, collusion, outages, and double settlement.

Exit criteria:

- every funded state has a bounded path to payout or refund;
- revocation prevents all future tested actions within the documented propagation bound;
- invariant/property tests find no double release or spend above delegation caps;
- red-team scenarios cover XSS, malicious relay, compromised verifier, runner self-funding, donor capture, fee drain, and dead mint/operator;
- users can explain custody, authority, and appeal from the interface without external documentation.

### Phase 4 — Audited mainnet canary (10–15 months)

**Outcome:** opt-in, low-limit real-sats software milestones settle under an audited policy with strong monitoring and escape hatches.

Prerequisites:

- independent protocol, web security, wallet, and settlement audits;
- reproducible escrow/mint compatibility tests;
- incident-response playbook, signed emergency pause policy, and public status page;
- deterministic refund behavior tested under operator and relay outage;
- legal/regulatory review appropriate to actual custody and jurisdictions;
- clear user loss limits and no misleading insurance guarantee.

Canary controls:

- allowlisted projects and verifiers;
- small per-milestone, per-user, and system-wide caps;
- short-lived delegations and mandatory confirmation for payout policy changes;
- staged limits based on settled volume, dispute quality, incident rate, and audit remediation;
- kill switches stop new commitments but preserve withdrawal/refund paths.

Exit criteria:

- at least 100 capped milestones settle with complete receipt chains;
- no unresolved critical audit finding;
- refund and dispute SLAs meet target for two consecutive release cycles;
- reconciliation finds zero unexplained balance or duplicate-settlement events.

### Phase 5 — Scale and domain adapters (15–24 months)

**Outcome:** the open-source vertical slice becomes an interoperable work substrate without weakening its guarantees.

Deliverables:

- decentralized project indexers and user-selectable ranking providers;
- multiple independent verifier and settlement implementations;
- selective-disclosure evidence and privacy upgrades;
- portable policy packs for contracts, delegation, and resolution;
- non-software adapters only after domain threat/evidence review;
- cross-client conformance suite and public test vectors;
- governance process for schema and policy evolution.

## 10. Workstreams and ownership

| Workstream | Primary responsibility | Key dependencies |
| --- | --- | --- |
| Product/domain | Project graph, state model, journeys, disclosure language | All workstreams |
| Protocol/interoperability | NIP review, event schemas, validators, conformance fixtures | Security, repository, settlement |
| Workspace UI | Project views, timeline, evidence/reputation explanation | Read model and design system |
| Concord/privacy | Transport separation, rekey, handoffs, retention | Native clients, agent tooling |
| NIP-34/repository | Complete projection, immutable artifact access, CI provenance | External repository tooling |
| Agent runtime | Machine API, durable outbox, claims, capability/delegation enforcement | Protocol and wallet |
| Trust/evidence | Evidence portfolio, receipt verification, local policy views | Repository and settlement |
| Funding/settlement | Contract ledger, milestone allocation, refund/release state machine | Wallet, court, services |
| Wallet/custody | Rail adapters, spending caps, receipts, recovery | Security audits and operators |
| Safety/assurance | Threat modeling, simulations, audits, incident response | Independent of feature owners |

For a small team, Phase 1 can run as three coordinated tracks: graph/protocol, workspace/repository, and safety/read-model. Settlement engineering should remain a separately reviewed workstream even if contributors overlap.

## 11. Metrics and operating gates

### 11.1 North-star metric

**Dependably settled milestones:** milestones that have a frozen contract, attributable execution history, valid evidence, a policy-conforming decision, and a verified payout or refund receipt.

This intentionally excludes messages sent, tasks created, gross payment volume, and opaque AI success scores.

### 11.2 Product metrics

- project-view to contract-inspection rate;
- funded opportunities claimed by a qualified human or agent;
- median time from funded to first progress and submitted to decision;
- milestone completion, rework, dispute, appeal, payout, and refund rates;
- handoff success without secret or irrelevant-context transfer;
- repeat collaboration between independent counterparties;
- discovery diversity across projects, agents, and issuers;
- evidence portfolio views that expand to source evidence.

### 11.3 Reliability and safety metrics

- snapshot convergence across clients;
- relay/API partial-failure recovery time;
- duplicate mutation and double-settlement count;
- spend-cap or delegation-policy violations;
- unresolved balance reconciliation;
- mean time to revoke authority and stop future execution;
- verification reproducibility and artifact availability;
- dispute/refund SLA and court availability;
- privacy incidents and unintended public disclosures;
- critical/high audit findings open by release gate.

### 11.4 Guardrails

- never optimize ranking for time-on-site or controversy;
- do not reward raw transaction volume without outcome quality;
- do not present self-issued receipts as independent reputation;
- do not increase mainnet caps merely to improve growth metrics;
- do not publish private membership or presence as proof of credibility.

## 12. Risk register

| Risk | Consequence | Mitigation and gate |
| --- | --- | --- |
| Protocol fragmentation | Other clients cannot read the work graph | Reuse NIPs, publish schemas/test vectors, require second implementation before stabilization |
| Split authority models | UI presents contradictory truth | Authority matrix, source provenance, shared read model, canonical state vocabulary |
| Demo mistaken for escrow | Users risk real funds under false assumptions | Status labels, disabled mainnet paths, custody disclosures, audit gate |
| Runner self-funding/Sybil capture | Dishonest acceptance | Frozen donor snapshots, caps/dampening, bonds, independent appeal, small tranches |
| Reputation farming/collusion | Misleading agent discovery | Evidence diversity, issuer context, local policies, conflict/refund display |
| AI verifier compromise | False delivery approval | Pinned reproducible workflow, independent reports, fee limits, human objection, no sole authority |
| Maintainer hostage/force-push | Valid work cannot settle or evidence disappears | Frozen base/criteria, archives, fallback verifier, deemed-acceptance rules where appropriate |
| Relay partition/equivocation | Conflicting claims or missing state | Deterministic folds, fencing, source completeness, multiple relays, fail closed for money |
| Browser key theft/XSS | Identity and funds compromised | CSP/sanitization, isolated signers, scoped delegation, confirmation, incident revocation |
| Concord traffic analysis | Membership/project correlation | Transport isolation, batching/padding, explicit disclosure, private relays/proxies |
| Mint/operator failure | Locked or lost funds | Small tranches, allowlists, timelocks/refunds, reconciliation, caps, audit |
| Court unavailable/captured | Indefinite or unfair dispute | Timeouts, alternate/fallback policy, bonds, transparent selection, appeal limits |
| Regulatory mismatch | Service interruption or liability | Architecture-specific legal review; do not describe custodial systems as non-custodial |
| Product becomes generic work SaaS | Loses 2140.wtf identity | Project worlds, interoperable artifacts, visible creation, philosophy review per vertical slice |

## 13. Decisions required before implementation

The following are explicit design decisions, not details to bury in code:

1. What is the canonical project root, and can existing community/repository objects adopt it without republishing?
2. Which proposed objects are covered by current NIPs, extensions, or custom kinds?
3. Is runner identity fixed at funding, or can an open claim become the contract runner through a signed transition?
4. Which settlement policy is the sole candidate for the testnet pilot, and what exact hashable document defines it?
5. What counts as acceptance for the first software milestone types: reproducible tests, maintainer status, explicit funder acceptance, or combinations?
6. Which entity holds or coordinates funds in each rail, and what happens when it disappears?
7. What are the initial milestone, user, verifier-fee, and system-wide caps?
8. Which evidence is public by default, selectively disclosed, or prohibited from public events?
9. How are harmful negative attestations rebutted, superseded, and aged out of default views?
10. What independent implementation or auditor must exist before protocol and mainnet gates advance?

## 14. First 90 days

### Days 0–30: alignment and model

- appoint owners for product/domain, protocol, settlement, and independent safety review;
- create the capability/status inventory and remove contradictory UI/docs claims;
- approve the authority-plane matrix and canonical state machine;
- complete the current NIP review and schema decision records;
- define project graph types, validation rules, and golden event fixtures;
- instrument privacy-safe baseline metrics;
- recruit three open-source projects, three agents/operators, and a small reviewer/funder group for design partnership.

### Days 31–60: read model and prototype

- implement the project snapshot library against existing data;
- add read-only project workspace navigation and provenance panels;
- complete NIP-34 issue/patch/PR/status aggregation and partial-result handling;
- expose matching `project get --json` through the agent tooling;
- run adversarial fixtures for spoofed pointers, relay omissions, conflicting replacements, and malformed evidence;
- usability-test whether participants can distinguish discussion, submission, acceptance, and settlement.

### Days 61–90: pilot-ready read-only slice

- ship public project discovery and the unified timeline behind an experimental flag;
- attach existing ₿AO Fund and Concord surfaces without granting them new authority;
- validate snapshot convergence between UI and CLI/MCP;
- publish the first protocol decision records and conformance fixtures;
- finalize the Phase 2 contract/evidence implementation backlog;
- conduct a security/privacy design review before enabling any new publishing path.

At day 90, the product should make the whole system legible even though it does not yet promise production settlement. That legibility is the prerequisite for every later safety and interoperability claim.

## 15. Definition of done for the vision

The vision is achieved when a person or agent can discover a relevant project, inspect the counterparties' evidence, understand exact terms, receive only the authority needed for the job, collaborate in an appropriately public or private space, submit durable evidence, challenge or defend the result under a known policy, receive or recover funds, and carry the signed outcome to another compatible client.

The system must remain useful when one relay, interface, indexer, agent, verifier, or coordinator disappears. It must explain what is known, who asserted it, how it was checked, what remains private, and why funds moved. That is the difference between communication with payments and dependable work.

## 16. Concord privacy prerequisite

The focused Concord V2/Armada audit is recorded in [`BAO_CONCORD_PRIVACY_AUDIT.md`](BAO_CONCORD_PRIVACY_AUDIT.md). It found no plaintext global join notification, but it did find material metadata and correlation surfaces around analytics, identity-authored encrypted vaults, direct invites, join-time public profiles, relay/AUTH topology, device caches, notifications, and incomplete cryptographic removal.

These are prerequisites, not optional polish. The Project Passport and every later public work-graph feature must remain structurally unable to ingest private membership, roster, presence, invite, typing, notification, or private-channel data. No private-membership claim may ship until the audit's release gates pass.
