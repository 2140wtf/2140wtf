# Security Audit — Round 27b (2026-09-06)

**Focus:** wallet/zap settlement flows — the numeric integrity of every accumulator and fee gate that touches money (round 27b of the standing audit campaign).

**Surfaces:** `src/lib/zaps.ts` (NIP-57 receipt + CORD.md rumor settlement, onchain zaps), `src/lib/cashu/cashu.ts` (`isFeeWithinMaxPpm`, the fee gate used at 11 sites in `useCashuWallet.ts`), and the downstream consumers (`tallyZaps`, `tallyOnchainZaps`, `verifyZapRumor`, `receiptAmountSats`).

**Scope:** local-only verification; shipped as its own PR and squash-merged to `main` per campaign hygiene.

## Method

1. Ground-truth probing of `light-bolt11-decoder` with **crafted checksum-valid invoices** (bech32 via `@scure/base`, real TLV layout: timestamp + `payment_hash` tag + raw 65-byte signature/recovery tail — the tail is *not* a tagged field; the decoder strips the last 104 words). Attacker model: computing bech32 checksums is trivial, so only field validation can reject hostile invoices. Probe kept at `scripts/probe-bolt11-craft.mjs`.
2. Property-based fuzzing (`fast-check`, fixed seed `20260906`) over the settlement math, including a BigInt ground-truth oracle for the fee gate.

## Findings and fixes

### F-27b-1 (High): `bolt11Info` accepted lossy-float amounts above 2^53 msat

Measured: an invoice for 21,000,000 BTC (`lnbc21000000…`) decodes to `2100000000000000000` msat with `Number.isSafeInteger === false`. The old code accepted any `Number.isFinite(n) && n > 0`, so a corrupted float could enter every downstream comparison: `amountMsats !== requestAmount` voiding (or failing to void) receipts, melt/quote math in `useCashuWallet`, `verifyZapRumor`'s amount binding, and tally sums.

**Fix:** `bolt11Info` now returns `amountMsats` only when it is a positive **safe integer** (`Number.isSafeInteger(n) && n > 0`); everything else fails closed to `null`. Legitimate invoices are far below 2^53 msat (2^53 msat ≈ 9 quadrillion sats), so no real payment is rejected. All consumers inherit the guarantee — including `receiptAmountSats`, `verifyZapRumor`, and `prepareMultiPathPayment` (which previously had to re-check safe-integers defensively).

### F-27b-2 (Medium): unbounded attacker-supplied amounts in accumulators

`tallyOnchainZaps` accepted any finite positive `amount` tag, and `verifyZapRumor`/`receiptAmountSats` had no per-entry ceiling. With ~10k-daily-event volumes, float-add drift or absurd amounts could inflate displayed tallies.

**Fix:** new `isValidZapSats` / `MAX_ZAP_SATS` (2.1×10^15 sats — the total Bitcoin supply): every per-entry amount must be a positive safe integer ≤ supply bound before it can reach an accumulator. Enforced in `receiptAmountSats`, `tallyOnchainZaps`, and `verifyZapRumor`.

### F-27b-3 (Low): `isFeeWithinMaxPpm` compared fees against a lossy float product

`fee <= Math.floor((amount * ppm) / 1e6)` — `amount * ppm` silently rounds above ~2^53 (`2^52 × 50_000` is already unrepresentable), so the verdict could flip for fees right at the boundary at large melt amounts.

**Fix:** exact BigInt arithmetic: `fee <= Number((BigInt(amount) * BigInt(ppm)) / 1_000_000n)`, and both inputs must now be safe integers (money values here are whole units; fractional/lossy inputs fail closed). All 11 call sites in `useCashuWallet.ts` pass whole-unit values (sats/msats), so no legitimate path is affected — verified by the full suite.

## Property suites added

- `src/lib/zaps.property.test.ts` (9 properties): crafted-invoice exact-decode across the whole sane range (P1); safe-integer contract over arbitrary crafted HRPs (P2); >2^53 regression witness (P3); garbage never throws (P4); tally sum/entry/bound invariants (P5); payment-hash dedupe across distinct receipts (P6); over-supply onchain rejection + safe totals (P7); `isValidZapSats` boundary exactness (P8); `verifyZapRumor` hash-consistent positive + amount/preimage tamper negatives (P9).
- `src/lib/cashu/isFeeWithinMaxPpm.property.test.ts` (4 properties): implementation ≡ BigInt oracle over the full safe-integer space (P1); exact floor/floor+1 boundary at any magnitude (P2); fail-closed on NaN/∞/fraction/negative (P3); unrepresentable-product regression witness (P4).

## Verification

- 1,945 tests / 197 files green (`--maxWorkers=3`; sandbox load spikes otherwise).
- `tsc --noEmit` clean; ESLint clean on changed files; `npm run build` clean.

## Deliberately untouched

- `receiptZapRequest` signature verification and the no-LNURL-fetch residual-trust tradeoff (documented in-code; fetching every author's wallet provider would leak reader IPs).
- Onchain zap dedupe-by-txid semantics (the tx is the proof; structural validation only).
- `useCashuWallet` melt lifecycle itself — already covered by earlier rounds' safe-integer guards at its boundaries; the numeric primitives it relies on are now provably exact.
