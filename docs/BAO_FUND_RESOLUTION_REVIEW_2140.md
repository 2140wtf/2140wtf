# Review of BAO_FUND_RESOLUTION.md (v0.1 DRAFT) — 2140wtf session pass

Independent evaluation, written before seeing the other session's review.
Verdict: the layered shape is right (cheap default → expensive dispute,
bonds, sats-weighted agents). Findings below are holes to close, ordered
by severity. Nothing here changes the architecture — all fixes land
inside the existing layers.

## A. Runner self-donation circularity (highest severity)

Sats-weighted L2 is Sybil-neutral for *donors* but circular for the
*runner*: the runner can donate to their own milestone via fresh keys,
dominate the donor ring, and vote YES on their own disputed milestone.
Cost ≈ capital lockup only — a YES returns their self-donation plus the
other donors' money; a NO refunds their self-donation back to them.

- The attack only matters post-objection (L1 silence already favors the
  runner), but it defeats the *only* layer where a defrauded minority
  donor has a voice.
- Mitigations to consider (probably a combination):
  1. Weight cap per donor key (e.g. no key exceeds ⚙ 20% of ring weight).
  2. Runner-identified keys excluded from the ring (imperfect — fresh
     keys — but operator-declared keys at minimum).
  3. Quadratic-style dampening: weight = √sats for keys above a
     threshold, linear below (keeps agent compatibility, blunts whales
     and self-stake alike).
  4. Explicitly lean on L3: a donor who loses to suspicious self-stake
     appeals; the court can examine funding-timing evidence (self-stake
      arriving just before proof submission is visible in the ledger).
- Whatever is chosen, the spec must **name this attack** — right now the
  sats-weight section reads as if Sybil-neutrality closes the problem.

## B. Runner-ghost path missing from the state machine

`funded → proof-submitted` has no timeout branch. If the runner never
submits proof, no objection window ever opens and funds sit locked
forever. `deadline_at` already exists in the v2 schema. Add:

```
funded ── deadline passes, no proof ──► timeout-open (donor-triggered)
      → objection-window (proof = none) → resolves-no → refund
```

Without this, "resolved-no" only ever punishes runners who *show up*.

## C. The weight oracle is a trusted database

L2 weight "read from the fundraiser ledger" = the bao.markets Postgres.
That makes the API operator a silent party to every vote: rewriting
contribution rows rewrites outcomes. "Courts settle disputes" fails too —
the court needs public evidence to judge.

Fix: contributions must be **event-recomputable**. Publish a signed
contribution receipt per donation (new kind, or reuse existing record
events), and define weight = sum over receipts fetched from relays, not
a DB query. The DB stays as a cache/index, never the source of truth.
This is cheap to do now and expensive to retrofit.

## D. Tranche key arrangement + locktime race need pinning down

§6 says "timelocked P2PK tranches, clawback of unreleased" but NUT-11
semantics matter and the doc doesn't fix the arrangement:

- **Runner as refund key** (`data` = donor/pool key, `refund` = runner,
  `locktime` = vest time): donor has an *exclusive* spend window before
  vest (clean clawback), runner can spend after vest. But after vest
  **both** can spend — the runner must sweep at vest or the donor can
  still take a vested tranche. Fine for agents (automated sweep), must
  be stated.
- Mint-dependence: locktime enforcement is mint-side — ties directly to
  the CashuMintChecker capability gate; not all public mints enforce
  NUT-11 locktimes. Tranches need the same mint-capability check as
  HTLCs, or a documented fallback mint set.
- "Donors signal lost confidence" needs a deadline: signal must land
  before the *next* vest; anything already at/past vest is the runner's.

## E. Silence asymmetry: L1 = YES, L2 no-quorum = NO

Deliberate, but it makes **objection eligibility + notification** the
load-bearing parts of L1, and both are unspecified:

- Who may object? If anyone: griefing (already flagged §10). If donors
  only: define "donor" snapshot (see I). Recommend: donor-of-that-
  milestone, plus optional bond scaled to milestone size.
- Objection is impossible if donors never see the proof. Spec needs a
  liveness requirement: proof + window-open events published to the
  fundraiser's relay set, and the window clock starts at *publication*,
  not at runner-claimed submission time.

## F. Sabotage tax pays a zero-work runner

2–5% to the runner on NO-resolution deters frivolous NOs, but combined
with L1 default-YES a runner who delivers nothing always profits:
no objection → full payout; objection → lose vote → still 2–5%.
Bound it: tax payable only when the runner submitted verifiable proof
artifacts (effort gate), and strippable by the court on appeal.
Fund source should be stated explicitly (it comes out of donor refunds —
donors pay for the deterrence, so keep it small).

## G. kind-30382 semantic collision

NIP-85 defines 30382 with `d` = ranked *pubkey*. Using `d` = market id
diverges; existing NIP-85 aggregators (including the ones our WoT filter
queries) may misparse or reject them. Two options:

1. Accept divergence (our artifacts, our readers) — but then don't
   publish them to shared NIP-85 relays.
2. Use an adjacent addressable kind (e.g. ⚙ 31382) with identical tag
   shape — same client code path, no semantic squatting.

Also define the artifact's **verifiability**: for L2 the artifact should
reference the ballot event ids it aggregates so any third party can
recompute the outcome from relays (ties into C).

## H. Escrow oracle key is a single-operator trust point (§8)

"Oracle key co-signs YES/NO" — if that key is one operator (bao.markets
API), it can collude with either side to steal the pool. That quietly
reintroduces the custody-adjacent trust the section claims to remove.
Stronger version: oracle key = **FROST threshold key of the court/juror
set** (the machinery exists in `@bao/frost-court`). Phase it: single
operator key in demo → threshold key before real sats. State the demo
trust assumption explicitly.

## I. Weight snapshot timing

Weights must freeze at **objection time** (or funding close). Otherwise
a vote can be swung mid-window by contributing more. One line fixes it;
it must be in the spec because the backend will otherwise take the
natural (wrong) implementation of reading current balances.

## J. Refund distribution mechanics

On resolved-no: refund proportional to each donor's remaining
(post-sabotage-tax) contribution. In the 2-of-3 escrow this means the
oracle+refund-key release targets a published distribution list (itself
an event, referenced by the resolution artifact), not a single key —
"donor-refund key" in §8 reads as if one key represents all donors.

## K. Smaller items

- §7: appeal bond "burned (feeds the juror pool)" — burned ≠ distributed.
  Pick: frivolous → juror pool; upheld appeal → returned.
- L4 mainnet: the market's own resolver (reads the artifact) is still a
  trusted key for the *trading* lane. Acceptable (artifact is public, a
  lying resolver is provable → second court door), but say it.
- Kind numbers 4971/4972/4973 (compute credits) + new kinds here all
  need the registry collision check before shipping (already ⚠-flagged
  for the new ones; extend to existing).
- Add a liveness/ops note: which relays artifacts go to, retry behavior,
  and what clients do when the artifact set is incomplete (fail closed
  = no payout, never fail open).

## Proposed addition: funding rails section (from today's discussion)

Add a §5.5/§11 covering the purpose-bound Routstr rail alongside P2PK:

- **Rail 1 (current):** donor → P2PK Cashu token → agent sweeps → agent
  redeems. Rug vector: sweep-and-disappear. Keep for agents who want
  sats.
- **Rail 2 (purpose-bound):** funder (or escrow) calls Routstr
  `balance/create`; agent receives only the `sk_` key, released per
  tranche as milestones resolve. Kills the rug, makes keys the
  deliverable, composes with L0 tranches 1:1. Open verification: whether
  Routstr balances are refundable to Cashu by the key holder (docs were
  unreachable; probe `/v1` live before claiming purpose-binding).
- **Escrow primitive:** borrow `CashuHTLCBuilder` + `CashuMintChecker`
  concepts from bao.markets (public NUT-14 spec; clean-room OK) — hash
  lock + refund locktime is strictly better than bare P2PK for milestone
  pools. Do NOT port the settlement services (closed IP, API boundary).

## What survives review unchanged

Layered cost escalation; sats-weighting as the agent-compatible base
(with A's fixes); asymmetric thresholds; one court two doors; markets as
signal-never-oracle; event-published artifacts as the cross-layer
interface; build order (attestation core first is correct — it forces C
and I to be solved before any money logic depends on them).
