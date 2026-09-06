# Security Audit — Round 26 (2026-09-06)

**Focus:** relay-ingress admission control — Bao trollbox join gate (`verifyJoinAdmission`), PoW oracle (`verifyPow`), and replay-tracking state (`ReplayCache`, `NullifierCache`), plus the NIP-42 client auth handler race review.

## Findings

### F-26-1: Unbounded replay/nullifier cache growth (Medium — memory exhaustion on the welcomer daemon)

`ReplayCache` (welcomer-core.js) tracked replayed PoW/challenge solutions in a plain `Map` with
TTL sweeping but **no entry cap**. An attacker who can induce challenge issuance (any client can
request a challenge from the burner welcomer) then solves the cheap PoW produces one tracked key
per admission attempt, each living ~30 minutes — unbounded memory growth over a flood. The
systemic check confirmed `NullifierCache` (credential.js) shared the same unbounded pattern,
while the newer `TtlKeySet` in the same codebase already established the bounded discipline
(4096-entry cap, per-key eviction).

**Fix:** both caches now accept an explicit `limit` (defaulting to the codebase-standard 4096)
and evict oldest-expiry entries per insert so **`size` never exceeds `limit`** — the same
discipline as `TtlKeySet`, not a bulk wipe (survivors keep their replay protection; eviction
order is oldest-expiry-first). `.d.ts` signatures updated to match.

### F-26-2: NIP-42 auth-handler race review (NostrProvider.tsx) — no exploit found (documented)

The account-switch and challenge-replay layers are sound: the challenge cache is identity-bound
(per-account) with a pubkey re-check after the async sign completes, superseded challenges fail
closed on sign completion, and socket identity is verified before use. Two hardening notes for
follow-up rounds, not fixed here:

- **(a)** the per-relay auth cooldown slot is set only *after* a sign completes; a burst of
  *distinct* concurrent challenges each starts a sign before any cooldown exists (concurrent
  bypass of the rate limit — bounded by the signer, not the limiter).
- **(b)** the docstring claims a delayed sign uses the relay's *latest* challenge, but the code
  deliberately fails superseded signs — code is safer than its doc; the doc should be corrected
  in a future round to prevent a "fix" in the wrong direction.

## New test coverage — `welcomer-core.property.test.ts` (14 properties, deterministic seed)

fast-check property suites, seeded for reproducibility, ~10k adversarial inputs per run:

- **P1–P7 `verifyJoinAdmission` gate ordering & bindings:** golden path; every binding mutation
  (pubkey/relay/salt/nonce/solution/d-tag) flips admission to false; exact expiry boundary
  (valid until `nowSec`, dead *at* it); replay admits exactly once per cache; zero-difficulty
  challenges only admitted under a zero-difficulty policy; `open` preset documented;
  `issueChallenge` difficulty bounds `[0, 256]`.
- **P8–P10 `verifyPow` oracle:** determinism + monotonicity (valid at d ⇒ valid at every d′ ≤ d);
  nonce grammar `^\d{1,20}$` within `2^64−1`; totality on arbitrary hostile nonce strings.
- **P11–P12 `ReplayCache` semantics:** first-insert-wins with exact TTL+grace revival boundary
  and exact sweep accounting; **growth hard-cap proof** — a 5,000-key flood against a 128-cap
  cache keeps `size` pinned at 128, survivors still tracked as replays, evicted keys forgotten.
- **P13–P14 crypto hygiene:** wrap/challenge/ratchet d-tags are pairwise distinct and stable
  per binding (domain separation); `constantTimeEqualHex` is equality-iff-equal, total, and
  leaks nothing on mismatched lengths.

Methodology notes: two of the triaged failures were *fuzzer-caught probabilism in my own
fixtures* — `issueChallenge`'s random salt made a fixed "invalid" nonce valid with probability
1/8 at difficulty 3 (fixed by brute-forcing a provably-failing nonce at a policy difficulty ≥ 1),
and the fast-check v4 `hexaString` → `stringMatching` API rename. Both are documented here as
part of the audit trail.

## Consumers / blast radius

`ReplayCache` and `NullifierCache` are welcomer-daemon state; the added `limit` parameter is
backward-compatible (default 4096). No public API changes beyond the optional constructor arg.
`verifyJoinAdmission`/`verifyPow` behavior unchanged — the suites pin the existing contract.

## Verification

- 1,930 tests / 195 files green (14 new property tests)
- `tsc --noEmit` clean (hand-maintained `.d.ts` conformance verified)
- ESLint clean on changed files
- Production build success
- `npm audit` 0 vulnerabilities
- Secret-leak grep on changed files clean
