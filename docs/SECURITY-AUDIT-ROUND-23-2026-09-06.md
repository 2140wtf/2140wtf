# Security Audit — Round 23 (2026-09-06)

**Focus:** financial primitives — Lightning amount parsing under adversarial input, plus a systematic ReDoS/injection sweep of untrusted-content regexes.

## Fixed

### F-23-1: BOLT11 amount parsing silently corrupts crafted huge amounts (Medium — financial integrity)

`src/lib/bolt11.ts` and the msats twin in `src/hooks/useEventInteractions.ts` parsed the invoice's human-readable amount with `parseInt` and **no digit cap**:

- A 17+ digit amount silently lost precision past 2^53 (`Number.MAX_SAFE_INTEGER`) — the displayed zap amount / send amount / fee estimate was a **rounded, wrong number** with no error signal.
- Even in-range digits could overflow via the multiplier product (`digits × 10^11` msats).

**Fix:** digit-run capped at the regex level (15 digits in the sats parser, 9 in the msats parser — far above any real invoice), plus a magnitude guard (`|v| ≤ Number.MAX_SAFE_INTEGER`, `Number.isFinite`) that returns the parser's existing "unknown amount" sentinel (`null` / `0`) instead of an unfaithful number. All three consumers degrade safely:

- `LightningInvoiceCard` — shows "amount not provided" instead of a wrong amount
- `useEventInteractions.extractZapAmount` — zap counted as 0 instead of a corrupt value
- `ArkWalletTab` send flow — treated as amountless, user types the amount

**Deliberately preserved:** sub-satoshi fractional results from nano/pico multipliers (documented behavior; `ArkWalletTab` rounds them for fee estimates). The guard targets magnitude overflow only. An initial stricter draft of the guard was rejected by the new adversarial tests themselves — fixtures and guard were corrected together until the semantics matched BOLT11 ground truth.

### Adversarial test coverage (new)

`src/lib/bolt11.test.ts` — 6 tests:
- Exact parsing of m/u/n/p multipliers incl. fractional sats (21.0001 sats for `210001p`)
- 17-digit crafted invoice → `null`, not a precision-corrupted value
- 16-digit run → regex-level rejection before `parseInt`
- 15 digits × 10^8 (BTC multiplier) → overflow guard returns `null`
- Fractional nano/pico results preserved
- Amountless invoices still `null`

## Audited, no defect found (deep pass)

- **Regex-built-from-untrusted-text:** the only dynamic `new RegExp(...)` over user data (`baosocial/join.js` line-scan) builds patterns from a **fixed label array** (`room`, `secret`, …), not user input — no injection/ReDoS. Static regexes audited for nested quantifiers: no catastrophic backtracking paths found.
- **Payment authority → URI builders** (`paymentTargets.ts`): all handle-based builders (`cash.app`, `venmo`, `revolut`) validate against `[A-Za-z0-9_.-]{1,64}` first — no path injection into trusted payment domains; Monero/BOLT12/bech32 validators are shape-strict.
- **`extractZapAmount` unit consistency:** the msats twin's multipliers were re-derived from BOLT11 constants — correct *for millisatoshis*; the `msats` naming is accurate (initial suspicion of unit mixing disproven before acting).
- **Remote-login callback page:** no token absorption, no auto actions.
- **Share/deep-link query params:** `SharePage` navigates only to the internal `/i/<encoded-url>` comment route (not the shared URL itself); `DeepLinkHandler` (native) forwards paths verbatim — internal router only, scheme validation upstream.

## Verification

- `npx tsc --noEmit --incremental false` — pass
- `npx vitest run --reporter=dot --silent` — **1,884 tests passed** (188 files)
- `npx eslint --no-cache` — pass
- `npx vite build -l error` — pass
- `node scripts/security-scan.mjs` — 0 critical / 0 high
- `git diff --check` — clean
