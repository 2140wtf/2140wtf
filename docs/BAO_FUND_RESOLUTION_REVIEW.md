# Review of BAO_FUND_RESOLUTION.md (v0.1 DRAFT)

Reviewer: bao_fund session (bug-hunt/wallet side), 2026-07-28.
Verdict: **direction approved — build it in the proposed order.** The core
split (tranches default / donors decide / court settles / markets signal) is
the right shape, and the reuse of kind-4973 receipts, NIP-85-shaped queries,
the dual release gate, and the existing court machinery keeps phase 1
dependency-free as claimed. Five issues need attention before the spec
hardens; the first one is a real security hole.

---

## 1. The 26%-stake attacker hole (must fix)

L2 as specced: quorum ≥25% of donor ring (by sats), majority of votes cast
decides, YES at ≥½ of cast. Walk the attack:

1. Attacker runs a milestone, self-donates 26% of the pool from fresh keys
   (cheap — most of the pool is other people's money).
2. Work never ships; someone objects; L2 vote opens.
3. Attacker votes YES with their 26%. Passive donors abstain. Quorum (25%)
   is met by the attacker alone; YES wins 100% of cast votes.
4. Pool pays out: attacker recovers their 26% and steals the other 74%.

"Resolved-NO is donor-safe" only holds when the attacker's stake is small
relative to quorum. The clean one-line fix: **raise quorum to ≥50% of ring
weight.** Then an attacker voting alone can never reach quorum; theft
requires ≥50% stake + majority of cast, i.e. majority ownership of the pool —
at which point the residual victim share is bounded and the same bound every
sats-weighted scheme has. Document that residual case explicitly: *a donor
controlling >½ of a milestone's sats controls its resolution; L0 tranche
sizing and donor diversity are the mitigations, L3 appeal is the backstop.*

Also freeze the ring: **weights snapshot at the objection-trigger event.**
Donations arriving after the vote opens must not vote — otherwise the same
attacker donates mid-vote to swing weight. §4 says "sats-weight read from
the fundraiser ledger, not the event" (good) but the ledger read needs a
snapshot point or it is itself an attack surface.

Suggested parameters (⚙): quorum 50% of ring by sats · YES = majority of
cast · no-quorum → extend once (with a donor notification ping) → resolved-NO
refund. Sabotage tax: take the low end, 2% — at 5% honest NO-voters start
subsidizing non-delivery.

## 2. L0 clawback should be per-donor unilateral — delete the signaling oracle

§6 has "donors signal lost confidence → unreleased tranches return to donors"
with an open ⚙ threshold question. That reintroduces a mini-oracle into the
layer whose entire value is having none. Use the actual Fundstr shape: each
donor locks *their own* tranches; clawback is **unilateral per donor** — a
donor exercises their own refund path on their own unvested tranches, no
vote, no threshold, no coordination. One donor's exit doesn't touch anyone
else's tranches. This deletes the "lost-confidence signaling threshold" open
question wholesale.

NUT-11 mechanics (verified against our cashu-ts: `getP2PKLocktime`,
`getP2PKWitnessRefundkeys`, `n_sigs`/`n_sigs_refund` all exist): the key
assignment is counterintuitive and the spec should spell it out —

- **primary key = donor**, `locktime` = vest time, `refund` = [runner key].
- Before vest: only the donor can spend (clawback window).
- After vest: only the refund key (runner) can spend — "vests automatically".

Implementation notes for our wallet: the receive path must *hold* locked
tokens without sweeping early; lock validation must accept `locktime`/`refund`
tags (`isTokenLockedToPubkey` already has the `allowedTags` option — that
was future-proofed correctly); and the runner should redeem immediately at
vest (vested-but-unclaimed tokens are dead weight if the mint dies — ecash
mint-liveness risk is inherent, so bound tranche size).

## 3. Don't squat kind 30382 — mint a dedicated kind with NIP-85-shaped tags

Repurposing 30382 (`d` = milestone id, rank 100/0) has two problems visible
from our own code:

- **Our WoT consumer drops or misreads them.** 2140wtf `nip85.ts` collapses
  30382 into `Map<pubkey, rank>` and rejects any `d` that isn't 64-hex. If a
  milestone market id is ever 64-hex, a rank-100 resolution artifact becomes
  a *user* with a perfect GrapeRank in the feed filter — cross-contamination
  in our own infra. (If ids aren't hex, the artifacts are just invisible to
  it — which already breaks the "readable for free" claim.)
- **The aggregator won't carry them.** nip85.nostr1.com aggregates provider
  assertions *about pubkeys*. Milestone assertions won't be there; clients
  will query app relays by author+kind anyway. So 30382-squatting buys no
  free reads and risks real confusion.

Recommendation: a dedicated addressable kind (verify-unused, per the spec's
own ⚠) with the same tag shape (`d`, `rank`, plus milestone/fundraiser
refs). Same query patterns, zero semantic collision. Coordinate with the
session that owns `nip85.ts`/`useWotRanks.ts` before finalizing the kind.

## 4. Add a "Verification rules" section (the hunt's #1 bug class)

The recurring defect pattern in the 10-round hunt was *unverified events
trusted for money decisions*. The spec needs an explicit section:

- The fundraiser's creation terms declare the **oracle pubkey** (L2 tally
  authority) and **court key set**. Resolution artifacts are valid only from
  those authors (`expectedAuthor` check), published in the fundraiser terms
  artifact itself. A random key must never be able to publish a resolution a
  client honors.
- Ballots `e`-tag the specific objection/resolution-round id; replays across
  rounds/extensions are invalid.
- Ballots are **addressable per (donor, milestone, round)**: parameterized
  replaceability gives vote-changing until window close for free; the tally
  is "latest valid ballot per ring member within the window".
- `created_at` sanity-clamped to the window (backdating rejected).
- The bao.markets backend re-verifies every artifact; client-published state
  is advisory input to the state machine, never truth.

## 5. Objection = a donor calling the question (dissolves the bond question)

§10 asks whether L1 objections need a bond. Simpler: **only ring donors can
object, and an objection IS an early NO vote** that triggers the full L2
vote. Donor stake is already the bond; non-donor objections are noise and
route to the L4 market signal instead. No new bond machinery, no grieving
vector from non-stakers, and the objection→attestation transition becomes "a
donor voted NO early, now everyone votes".

---

## Smaller notes

- **Escrow tie-in (§8 / #21):** the artifact-as-oracle-co-signature-input
  design is clean and matches #21's plan. One implementation risk to record:
  real 2-of-3 P2PK requires mints that enforce `n_sigs` multisig — support is
  uneven across public mints, so verify enforcement on target mints before
  relying on script-level 2-of-3; the degraded mode is a single oracle key
  with artifact-gated release (weaker, honest about it).
- **Delegation (§10):** transfer the *ballot*, never the weight — weight is a
  ledger fact. Delegations as revocable addressable events, per-fundraiser
  scope; a direct donor vote supersedes the delegate's (this is also the
  agent cold-start answer: delegate to operator until receipts accumulate).
- **Veil ring floor (§10):** below ~8–16 ring members, ring-sig ballots add
  theater, not privacy — keep plain signed ballots under the floor and say so
  in the UI.
- **Donor ring (§10):** per-milestone. Stake-alignment beats ring size; the
  phase-4 veil upgrade can aggregate at fundraiser level if rings are thin.
- **Window length (⚙ 7d):** scale by milestone size — 7 days is fine for
  large milestones, but compute-credit-sized ones want 48–72h or settlement
  latency dominates the work itself.
- **L4 "mandatory" markets:** fine as v2 already behaves this way, but frame
  it as "every milestone gets a market" (product default), not a user-facing
  obligation.
- §1's "funders include agents" — runners too (the trust-axes table covers
  both; the problem statement should too).

## What looks right (don't relitigate)

- Sats-weight as the donor axis: Sybil-neutral, agent-compatible, and correct
  for clawback decisions (this is not commons governance).
- Markets never binding; mainnet markets reading the L2/L3 artifact as their
  oracle (the Polymarket→UMA loop) is exactly right.
- Dual release gate preserved; refund path mirrors v2 `status='refunded'`.
- Court: one court, two doors, bonds feed the juror pool, commit–reveal +
  FROST verdict as the same-shaped final artifact.
- Build order — attestation core first, no new deps, is the right phase 1.
