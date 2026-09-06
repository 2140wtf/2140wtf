# Security Audit — Round 24 (2026-09-06)

**Focus:** property-based fuzzing of the financial parsers (BOLT11 amount parsing, zap-receipt amount extraction, NIP-A3 payment-target URI building).

**Tooling:** `fast-check@4.9.0` (devDependency), deterministic campaign (`seed: 20260906`), 2,000–5,000 generated inputs per property. Every property runs against an **exact BigInt ground-truth oracle** or a structural invariant, not hand-picked examples.

## Headline finding — digit-cap bypass in `parseBolt11Amount` (High, financial integrity)

Round 23 capped the invoice digit run at 15 with `/^ln\w+?(?:(\d{1,15})([munp]?))?1/`. Property P2 (`digit runs ≥ 16 are rejected outright`) **falsified this instantly**: lazy `\w+?` matches digits, so for `lnbc` + 16 nines + `1…` the regex absorbed the leading `9` into the "hrp", re-anchored the amount capture on the **shifted 15-digit sub-run**, and returned a number — the cap could be bypassed by any crafted run of 16+ digits, reintroducing the silent 2^53 precision corruption round 23 fixed.

The first attempted fix (`[a-z0-9]` for the hrp matcher) was **also falsified by P2** — digits are still legal hrp characters, so the shift attack survived. The grammar now shipped is provably immune:

```js
/^ln[a-z]+(?:(\d{1,15})([munp]?))?1[^1]*$/
```

1. **Alphabetic hrp matcher** — real BOLT11 hrps (`lnbc`, `lntb`, `lnbcrt`…) are all letters; digits can no longer hide in the "hrp".
2. **Capture anchored immediately after the hrp** — leading run digits can never be skipped.
3. **`[^1]*$`** — the hrp/amount separator `1` must be the *last* `1` in the string. Bech32 data never contains `1`, so a `1` planted inside a digit run can no longer impersonate the separator and truncate the amount.

`P2` and `P5` (exact safe-integer cliff boundaries) now hold for 2,000 generated runs each.

## Second finding — parser fork drift (Medium, financial integrity)

The zap-receipt path in `useEventInteractions.ts` carried a **forked copy** of the BOLT11 parser with a *different* digit cap (9 vs 15) and a different overflow guard (`isSafeInteger` rejects the fractional nano/pico results the shared parser deliberately allows). Two parsers for one wire format means two acceptance policies: the same invoice could be "parseable" in the zap aggregator and "null" in the invoice card. The fork is deleted — `parseBolt11AmountMsats` now delegates to the shared, fuzzed parser and scales ×1000 (receipts are msats), with a safe-integer re-check after scaling.

## The property suites (new files)

| File | Properties | Oracle |
|---|---|---|
| `src/lib/bolt11.property.test.ts` | P1–P5 | Exact BigInt ground truth per multiplier; overflow ⇒ null; totality on arbitrary hostile strings |
| `src/hooks/useEventInteractions.zaps.property.test.ts` | P1–P5 | Verbatim-exact msats; bolt11 fallback consistency; malformed-JSON robustness; tag-soup totality; tag precedence |
| `src/lib/paymentTargets.property.test.ts` | P1–P4 | URI = fixed origin + fixed prefix + handle segment (no `/?#@\\` in tail); validator/URI agreement; parse/serialize round-trip; tag-soup totality |

Notable invariants now locked in:

- **Totality:** `parseBolt11Amount` and `extractZapAmount` never throw and never return non-finite/negative values for *any* input (5,000 random strings/tag-soups each).
- **Overflow cliff boundaries** (exact): `lnbc900719931qq` → null, `lnbc900719921qq` → 9,007,199,200,000,000; µBTC cliff straddling `MAX_SAFE_INTEGER` pinned both sides.
- **Payment-target URIs:** for every validator-accepted handle (including hostile charset fuzzing), the generated cash.app/venmo.com/revolut.me URI is always the fixed origin + fixed path prefix + a clean path segment — scheme/authority/path injection is structurally impossible.
- **Round-trip:** `paymentTargetsToTags` → `parsePaymentTargets` is lossless for valid target sets.

## Honest methodology notes

- The P3 msats fixture initially carried a sats-denominated expectation (`21_000.1` instead of `21_000_100` for `210001n`) — the parser was right, the fixture was wrong. Fixed against BOLT11 ground truth.
- P1's arithmetic initially missed that BOLT11's `\w`-based hrp matcher made "where does the amount start" ambiguous — that *is* the headline finding. The oracle and the fix were derived together from the BOLT11/bech32 grammar, not from the implementation.

## Verification

- **1,898 tests** pass (13 new property tests, ~11k adversarial inputs per run)
- TypeScript, ESLint, production build, `npm audit` — all clean
