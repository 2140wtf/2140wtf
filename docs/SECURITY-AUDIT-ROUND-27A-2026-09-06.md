# Security Audit — Round 27a (2026-09-06)

**Focus:** NIP-42 client auth handler (`NostrProvider.tsx`) — follow-ups carried from round 26: the cooldown-set-after-sign concurrency gap and the docstring that contradicted the code.

## Findings & Fixes

### F-27a-1: Distinct concurrent challenges bypassed the per-relay sign rate limit (Medium — fixed)

**The gap:** the per-relay cooldown entry was recorded only *after* a sign completed. The
in-flight map deduplicated callers asking for the **same** challenge string, but a burst of
**distinct** challenges (e.g. a relay re-challenging every retried REQ with fresh nonces, or
multiple gated subs opening at once) each got a unique in-flight key, each observed an empty
cooldown simultaneously, and all signed **concurrently** — the rate limit never actually gated
bursts against a slow/remote NIP-46 bunker.

**The fix — per-relay sign chain (`authSignChainRef`):** each new distinct challenge enqueues
behind the previous sign for that relay *synchronously at entry*, then re-checks the cooldown
**at its turn** — so the wait reflects every sign queued before it, not just ones completed
before it arrived. Properties:

- First challenge signs immediately; subsequent concurrent ones space out ≥
  `AUTH_MIN_INTERVAL_MS` (5s) apart, per relay.
- A failed sign does not poison the chain (failure is swallowed for chain sequencing only —
  the caller's promise still rejects).
- Chain state is cleared on socket reopen (per-relay) and account switch (all), matching the
  existing cache/cooldown reset semantics; an in-flight queued sign still fails closed via the
  pre-existing supersession check if its challenge was replaced while queued.

### F-27a-2: Docstring/code mismatch on superseded signs (Low — fixed)

Two comment blocks claimed a delayed sign "uses the relay's LATEST challenge at fire time" —
but the code deliberately **fails superseded signs** (challenge-tag mismatch + socket-identity
checks), which is the safer behavior: a queued sign never authenticates a socket with a stale
nonce. Both docstrings now state the real contract ("a sign whose challenge was superseded
FAILS CLOSED at fire time — it never signs stale challenges"), closing the maintenance trap
where a future "fix" in the wrong direction would look doc-sanctioned.

## Deliberately unchanged

- Cache-reuse path (identical challenge re-issue), same-challenge in-flight collapse, the
  5s window, and the *delay-don't-refuse* policy (NRelay1's doAuth swallows rejections and
  each sub/publish gets ONE auth-retry per socket — refusing would kill gated subs until
  reconnect). All verified against the current call sites.

## Test coverage note

The auth handler lives inline in the pool's `open()` callback; testing the chain in isolation
requires extracting it into a module (listed as a follow-up, not done in this round to keep the
concurrency change atomic). Verification this round: typecheck, full suite (1,932 green — no
behavioral regressions), and the reasoning above pinned in this report.

## Verification

- 1,932 tests / 195 files green
- `tsc --noEmit` clean · ESLint clean · build clean
