# Multi-mint wallet containment

The Stored Wallet keeps **one bucket per mint** (`mints: Record<url,
MintState>`); the top-level `mintUrl`/`proofs`/`seed`/`counter`/`pending`
fields are a compatibility view of the ACTIVE mint. Every write re-syncs the
active bucket from the view, so the legacy single-mint call sites stay
correct and the legacy storage shape is folded into a bucket on load
(migration is read-side and idempotent).

## Why per-mint buckets

Cashu proofs are only spendable at the mint that issued them. A single
"active mint URL" plus one proof list meant switching the label would orphan
every local proof (they live only in this browser). With one bucket per mint:

- receiving a token from ANY mint is safe - each entry is routed to its own
  bucket (the mint is adopted automatically; a token is self-describing);
- `switchStoredMint` is now a plain active-mint selector and never moves or
  relabels proofs;
- `mergeStoredProofs` (NIP-60 restore) merges every mint independently, so a
  restore with several mints drops nothing;
- `removeStoredMint` refuses while the bucket holds proofs or a crash marker.

Malformed storage is fail-closed for **every mutation**, not just switching:
the serialized operation queue validates the raw entry (parseable JSON, a
`proofs` array, a non-empty `mintUrl`) immediately before each operation, so a
corrupt store can never be overwritten by a fresh empty wallet - proofs,
recovery seeds and crash journals survive until a human recovers or backs them
up. The failure surfaces through `useWallet` (boot hydration included).
Reads stay lenient and degrade to a clean default, so the UI can still show
the error state instead of crashing. `switchStoredMint` additionally only
accepts public https mint URLs for mints it does not already know; a denied
switch writes nothing and emits no successful storage-change notification.

## Mint-commit / browser-crash recovery (R11, 2026-09-18)

A swap destroys its inputs at the mint, but the change proofs are written to
localStorage only AFTER the network round-trip. A crash in that window used to
lose the change (random outputs are unrecoverable) and leave stale proofs that
look spendable. The fix has three parts, all inside the operation queue:

1. **Deterministic outputs (NUT-09).** Each mint bucket generates a 32-byte
   local `seed` once and persists it; every `send`/`receive`/`mint`/`melt`
   passes an explicit `counter`, so the blinded secrets of a swap can be
   re-derived later. The seed is a *recovery* seed, not a spending key - it
   never signs anything. Counters are per mint (keyset spaces are per mint).
2. **Intent journal.** Immediately before the mint call, the operation persists
   that bucket's `pending` = {inputs, counterStart, keysetId, kind}. On a clean
   finish it is cleared and `counter` advanced. The pre-mint write does not
   notify listeners (no user-visible state changed yet).
3. **Boot/next-op hydration (`hydrateStoredWallet`).** With a pending marker,
   the mint's `check` endpoint decides: all inputs UNSPENT → the swap never
   landed, drop the marker; any SPENT → recover the deterministic outputs via
   `restore(counterStart, span)` and replace the consumed inputs; any PENDING →
   fail closed and keep the marker (never race a live mint op). A `mint`
   (top-up) marker consumes no local inputs and is resolved by a targeted
   NUT-09 restore, or dropped when nothing was issued. Recovery runs for
   EVERY mint's marker, not just the active one.

`useWallet` runs hydration at boot and surfaces a failure as a visible error;
every operation also recovers first, so recovery is idempotent and cannot
double-spend (a rerun after success finds no marker).

## Lightning on/off ramp (NUT-04 / NUT-05)

Top-up (`createLightningTopUp` / `completeLightningTopUp`) and pay
(`quoteLightningPayment` / `payLightningQuote`) use the same journal, counter
and recovery machinery as swaps: a top-up journals a `mint` marker before
`mintProofs`, a payment journals a `melt` marker before `meltProofs`. The
invoice QR / copy / open-in-wallet / WebLN surface lives in
`LightningInvoice.tsx` and is shared by the wallet and the pledge modal.

**NUT-02 keyset-ID v2 mints (resolved 2026-09-23).** The 2.9.0 line derived
v2 keyset IDs with an early draft preimage, so cdk mints - including the
default mainnet fallback, Minibits - failed every `getKeys()` with the raw
`Couldn't verify keyset ID …` before any mint call. The temporary
`KeysetCompatWallet` shim was deleted with the `@cashu/cashu-ts` 3.7.2 bump:
`getWallet()` now constructs a bare `Wallet` and calls `loadMint()`, which
verifies v2 keysets natively with the final NUT-02 derivation (unverifiable
keysets are dropped, so operations fail closed). NUT-09 counters are seeded
per operation from the journaled `counterStart` through a `StoredCounterSource`
(3.x reserves counters internally). Decision memo, migration notes and live
evidence: `docs/KEYSET-ID-V2-COMPAT.md`.

Regression suite: `cashuWallet.test.ts` covers no-marker no-op, unspent-retry,
spent-restore (counter advance, no double-spend), PENDING fail-closed,
spent-without-seed refusal, recover-then-spend, the pre-mint journal write,
per-mint routing/migration, the corrupt-storage fail-closed guard on every
mutation, and the Lightning top-up/pay/recovery paths. Mint
operations are mocked; this is a local storage/journal invariant test, not a
live mint conformance test. A live-mint `restore` run and multi-device seed
backup remain open.
