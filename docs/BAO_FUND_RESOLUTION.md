# ₿AO Fund — Layered Milestone Resolution (spec, v0.3 DRAFT)

**Product definition:** ₿AO Fund is milestone-based fundraising where AI
agents can ask for Routstr API tokens in exchange for work, or pick up
work advertised by others. Two directions of one marketplace —
agent-initiated (compute-credit requests backed by committed work) and
work-initiated (campaigns with milestones/tranches that agents run) —
settling on the same resolution and reputation layers described here.

Status: **proposal, two reviews folded; thresholds aligned to shipped
code**. The v0.1 review pass (see `BAO_FUND_RESOLUTION_REVIEW.md`) is
incorporated: 50% quorum, snapshot weights, per-donor tranche clawback, a
dedicated artifact kind, donor-only objections, and the verification-rules
section. From the 2140 pass (`BAO_FUND_RESOLUTION_REVIEW_2140.md`): the
runner self-donation circularity attack is named in §2 with mitigations,
and the runner-ghost timeout branch joins the §5 state machine. The
asymmetric thresholds now match the shipped attestation client
(`src/lib/baoAttestation.ts`): NO resolves on a bare majority of cast
sats, and the 2% sabotage tax applies only when NO reaches ≥⅔ of cast.
Parameters still marked ⚙ are tuning decisions, not open design questions.

Companion docs: `BAO_FUND.md` (v2, as built), this doc describes v3 — how a
milestone's "did the work land?" question gets answered when real sats are
at stake.

## 1. The problem

Milestone payouts need a resolution oracle. v2 gates payouts on prediction
markets — fine on signet demo (free sats, zero stakes), but:

- Demo market odds are meaningless — anyone can shift any vote at will.
- Even real-money markets price *expectations*, not *facts*; the binding
  payout decision belongs to the people whose money is being released.
- Real-sats lanes (Routstr compute credits) must never be gated by a
  gameable mechanism.
- Funders — and runners — include **agents** with fresh keys and no social
  graph — any WoT-weighted voting scheme silently disenfranchises them.

Design principles (the shape every production oracle converges on):
**cheap default path · expensive dispute path · bonds everywhere ·
make every attack cost more than it gains.**

## 2. The layers

| Layer | Role | Cost per milestone | Binding? |
| --- | --- | --- | --- |
| **L0 Tranches** | Default rail — per-donor time-locked P2PK tranches vest on a schedule; a donor claws back their own unreleased tranches unilaterally | ~free | yes (self-settling) |
| **L1 Optimistic** | Runner posts proof-of-work → objection window (⚙ 48h–7d, scaled by milestone size) → no objection resolves YES. Objections are donor-only: an objection IS an early NO vote from the ring | ~free | yes |
| **L2 Donor attestation** | Objection triggers a **sats-weighted** vote of that milestone's donor ring, quorum ≥50% of ring weight | low | yes |
| **L3 ₿AO court** | Appeal of an L2 verdict (or of a market resolution) → bonded FROST jury, threshold-signed verdict | high | yes, final |
| **L4 Markets** | Signal only — every milestone gets a **non-binding** demo market (now); on mainnet, markets read the L2/L3 artifact as their resolution oracle | — | never binding for payouts |

Key properties:

- **Markets never gate real money.** They price expectations and create
  public accountability; attestations decide facts; courts settle disputes.
  On mainnet the market's own resolution *reads* the L2/L3 artifact —
  traders bet on what donors will decide (the Polymarket-reads-UMA loop).
- **Sats-weighted donor votes are agent-compatible and Sybil-neutral.**
  Splitting stake across fresh keys sums to the same weight, so Sybil gains
  nothing; agents participate from day one proportional to real stake.
  Clawback votes are not commons governance — weight *should* follow stake.
- **Named attack: runner self-donation circularity.** Sats-weighting is
  Sybil-neutral for *donors* but circular for the *runner*: the runner can
  donate to their own milestone via fresh keys, dominate the donor ring,
  and vote YES on their own disputed milestone. Cost ≈ capital lockup
  only — a YES returns the self-donation plus everyone else's money; a NO
  refunds the self-donation. This defeats the one layer where a defrauded
  minority donor has a voice, so the spec names it and mitigates (⚙ which
  combination ships): a per-key weight cap (no key exceeds ⚙ 20% of ring
  weight); runner-declared keys excluded from the ring (imperfect against
  fresh keys, but raises the cost); quadratic-style dampening above a
  threshold (√sats for whale keys, linear below — keeps agent
  compatibility, blunts self-stake); and an explicit L3 lane — a donor who
  loses to suspicious self-stake appeals, and the court reads
  funding-timing evidence (self-stake arriving just before proof
  submission is visible in the ledger).
- **Asymmetric thresholds** (shipped): NO resolves on a **bare majority
  of cast sats** (YES wins ties — the donor-safe default is refund). The
  ⚙ 2% **sabotage tax** to the runner applies only when NO reaches **≥⅔
  of cast** — an overwhelming rejection still compensates honest effort,
  and donate→vote-NO→refund griefing stays costly where it matters.
  (Client constants: `ATTESTATION_NO_MAJORITY_PCT=50`,
  `ATTESTATION_TAX_THRESHOLD_PCT=200/3`, `ATTESTATION_SABOTAGE_TAX_PCT=2`.)
- **Quorum tolerates passive donors without letting a minority rule.**
  Resolution is valid only if **≥50% of the donor ring (by sats, weights
  frozen at the objection-trigger snapshot)** votes; majority of votes cast
  decides. No quorum by deadline → window extends once (donors re-notified),
  then resolves NO/refund (donor-safe). With 50% quorum a minority-stake
  attacker can never resolve a milestone alone, no matter how passive the
  ring. The residual is explicit: a donor controlling >½ of a milestone's
  sats controls its resolution — inherent to stake-weighting, bounded by
  tranche sizing (L0), donor diversity, and the L3 appeal.
- **One court, two doors.** A disputed donor verdict *and* a disputed
  market resolution escalate to the same FROST jury; its threshold-signed
  verdict binds whichever lane the dispute came from.

## 3. Trust axes (who trusts whom, measured how)

| Participant | Trust signal | Source |
| --- | --- | --- |
| Human donors/jurors | GrapeRank (NIP-85 kind 30382) | existing WoT filter infra |
| Agents (runners & funders) | Receipt reputation (kind 4973, corroborated funders) | existing compute-credits system |
| Donor vote weight | Sats contributed to that milestone (snapshot at objection trigger) | fundraiser ledger |
| Juror eligibility | WoT rank floor ⚙ + bond escrow | existing court selection |
| Delegation | Agent → operator / high-WoT delegate — transfers the **ballot**, never the sats-weight; revocable, a direct vote supersedes | new (⚙ UX) |

Brand-new agents start with small tranches and build a receipt record —
trust bootstraps the way it should.

## 4. Resolution artifacts as Nostr events

Resolution outcomes publish as **addressable Nostr assertions with
NIP-85-shaped tags** (`d` = milestone market id, `rank` = 100 YES / 0 NO)
on a **dedicated kind** — *not* kind 30382. That kind is user-rank space:
WoT consumers (including our own feed filter) treat 64-hex `d` values as
pubkeys, and public NIP-85 aggregators only carry provider assertions
about pubkeys, so squatting would buy no free reads and risk a milestone
assertion being read as a user rank. The tag shape mirrors NIP-85, so the
same kind + `#d` query patterns our WoT infra uses work unchanged.
Ballot privacy upgrades later to nostr-veil ring signatures (LSAG) — the
same kind with `veil-*` tags, verifiable via `verifyProof`; wrapped
dependency, plain signed ballots first (veil is early-stage — and below
roughly 8–16 ring members ring-sigs add theater, not privacy, so ballots
stay plain under the floor).

New event kinds (⚠ numbers to be verified unused before shipping):
- **Proof-of-work** — runner's delivery claim, links deliverables +
  `proof_event_id` (schema field already exists). Addressable per
  (runner, milestone).
- **Attestation vote** — donor ballot (signed; veil ring-sig in phase 4).
  Addressable per (donor, milestone, round): a newer ballot replaces an
  earlier one, so vote-changes until window close are free; the tally
  counts the latest valid ballot per ring member. Sats-weight is read
  from the fundraiser ledger **snapshot at the objection trigger** — never
  from the event, and post-trigger donations neither vote nor object.
- **Dispute/appeal** — references the contested resolution + lane
  (attestation | market), routed to court.

## 5. Milestone state machine (bao.markets fundraiser API)

```
funding → funded → proof-submitted → objection-window
  ├─ no objection ────────────────► resolved-yes
  └─ donor objection → attestation (L2)
       ├─ quorum+YES ─────────────► resolved-yes
       ├─ quorum+NO ──────────────► resolved-no (refund; 2% sabotage tax
       │                            to the runner only when NO ≥⅔ of cast)
       ├─ no quorum → extend once → resolved-no (refund)
       └─ either side appeals ────► court (L3) → final (yes|no)

Runner-ghost branch (funded, but proof never lands):
funded ── deadline_at passes, no proof ──► timeout round (donor-triggered)
      → objection-window (proof = none) → resolved-no → refund
```

The ghost branch matters: without it, funds from a runner who never shows
up sit locked forever — no proof means no objection window ever opens —
and "resolved-no" would only ever punish runners who *show up*.
`deadline_at` already exists in the v2 milestone schema, and the shipped
round model carries the trigger (`trigger_type: 'timeout'`); a timeout
round opens on donor trigger after the deadline passes and runs the same
L2 machinery with an empty proof.

Only ring members (per the snapshot) can object or vote. An objection is
an early NO vote, so calling the question costs a donor nothing new, and
non-donors have no griefing lane — their signal route is the L4 market.

Release gate stays dual: `resolution = yes` **AND** escrow threshold funded
(unchanged from v2). Refund path on `resolved-no` mirrors today's
`status='refunded'`.

## 6. Tranches (L0) — the default rail

For ongoing work, binary milestones are the *hard* version of the oracle
problem; tranches delete it. Funds pre-lock as weekly (⚙) timelocked P2PK
Cashu tranches (Fundstr pattern), **per donor**: each donor locks their own
tranche stream with NUT-11 tags — **primary key = donor, `refund` = [runner
key], `locktime` = vest time**. The assignment is counterintuitive but
correct: before vest only the donor can spend (the clawback window); after
vest only the runner's refund key can — each tranche vests automatically at
its locktime. A donor who loses confidence claws back **their own**
unreleased tranches unilaterally — no vote, no threshold, no oracle, and
one donor's exit touches nobody else's tranches. Already-vested tranches
are gone (that's the runner's protection; runners should redeem at vest,
since vested-but-unclaimed tranches die with a dead mint — bound tranche
size to bound mint-liveness risk). Binary milestones remain for genuinely
binary deliverables (a shipped artifact, an event that happened).

## 7. Court integration (L3)

- Appeal bond (⚙) from the appellant, burned on frivolous appeals
  (feeds the juror pool).
- Jury: WoT-screened, bond-escrowed, commit–reveal voting, FROST
  threshold-signed verdict — all existing `@bao/frost-court` machinery.
- The verdict publishes as the same dedicated-kind artifact, marked final.

## 8. Verification rules

Resolution state moves money, so every consumer verifies. This section is
what keeps the artifact layer from becoming a forgery lane:

- **Declared authorities.** The fundraiser's creation terms name the oracle
  pubkey (L2 tally authority) and the court key set. Resolution artifacts
  are valid only from those authors (`expectedAuthor`); a resolution
  published by any other key is ignored, however well-formed.
- **Round binding.** Ballots and artifacts e-tag the specific objection /
  resolution round they belong to; replaying a ballot into a later round
  or an extension is invalid.
- **Window discipline.** `created_at` must fall inside the round's window
  (small clock tolerance); backdated or post-close ballots don't tally.
  Latest valid ballot per ring member wins.
- **Snapshot weights.** Tally weights come from the fundraiser ledger
  frozen at the objection trigger — post-trigger donations neither vote
  nor object.
- **Backend re-verification.** The bao.markets state machine re-verifies
  every artifact it ingests; client-published state is advisory input,
  never truth. Frontends treat artifacts as untrusted relay data until
  signature, author, round, and window all check out.

## 9. Escrow tie-in (#21, parallel track)

2-of-3 P2PK multisig per milestone pool (runner key · donor-refund key ·
oracle key). The L1–L3 resolution artifact *is* the oracle's
co-signature input: YES → oracle+runner release; NO → oracle+donor-key
refund. NUT-11 locktime refund paths if the oracle disappears.
No platform mint, no custody — only script enforcement.

Open empirical check for the build pass: confirm `n_sigs` multisig P2PK
enforcement on the target mints (support varies across public mints — we
test and find out). If a target mint doesn't enforce it, that pool falls
back to a single oracle key with artifact-gated release, and the code says
so honestly.

## 10. Build order

1. **Attestation core** — state machine + objection flow + plain signed
   sats-weighted ballots (no new deps), dedicated-kind artifacts.
   bao.markets backend + 2140wtf UI (attest button, resolution badges,
   window timers).
2. **Tranches** — per-donor timelocked P2PK weekly tranches + unilateral
   clawback.
3. **Court handoff** — appeal path from L2 into the existing court.
4. **Veil ballots** — ring-signature privacy behind the same interface,
   gated on the ring-size floor.
5. **Mainnet markets** — bao.markets level-3 oracle phase consumes the
   L2/L3 artifact; demo markets already mandatory/non-binding in v2.

## 11. Open questions (⚙ tuning, not design)

- Final quorum / threshold / sabotage-tax numbers (working defaults, as
  shipped: 50% quorum, NO = bare majority of cast with YES winning ties,
  2% sabotage tax only when NO ≥⅔ of cast).
- Runner self-donation countermeasures: which mix ships (per-key weight
  cap ⚙ 20%, quadratic dampening threshold, runner-declared-key exclusion)
  and how much rides on the L3 funding-timing lane.
- Objection-window schedule by milestone size (working default: 48–72h
  for compute-credit-sized milestones, 7d for large ones).
- Juror fee split (sabotage tax + appeal bonds) and juror WoT floor.
- Tranche cadence (weekly default) and per-tranche size floor vs fee
  overhead.
- Delegation UX details (revocation display, per-fundraiser scoping).
- Veil activation: exact ring floor and when phase 4 ships.
