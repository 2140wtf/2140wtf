# Security Audit — Round 29 (2026-09-07)

**Focus:** Nostr Wallet Connect (NWC) / wallet-payment flows — the surface where a bug costs real sats (standing audit campaign).

**Surfaces:** `src/hooks/useNWC.ts` (URI validation, encrypted storage, payment), `src/hooks/useGammaPayment.ts` (marketplace payment executor), every call site that hands an invoice to a wallet: `useZap.ts`, `useZaps.ts`, `CourtPage.tsx`, `ChatContent.tsx`, `BaoWalletTab.tsx`, `PayOrderDialog.tsx`. Storage reviewed via `useEncryptedSecureLocalStorage.ts`.

## Findings

### F-29-1: Amount-substitution in the Gamma marketplace payment executor (High — direct sats loss)

`useGammaPayment.pay()` paid a bolt11 payment option **without verifying the invoice encodes the
amount the user confirmed**. The option value is seller-supplied listing metadata; NWC, WebLN, and
Cashu all pay "whatever the invoice encodes." A malicious or buggy listing could carry an invoice
for 10,000 sats under a 1,000-sat price — the wallet pays it, the kind-17 receipt then *proves* the
overpayment happened.

Every other invoice-paying path already verified (`useZap` line ~121, `useZaps` line ~283,
`CourtPage` line ~185 — all check `bolt11Info(invoice).amountMsats` against the requested amount);
this was the one executor that didn't.

**Fix:** before *any* provider (NWC, WebLN, or Cashu), parse the invoice and require
`bolt11Info(value).amountMsats === amountSats * 1000`; otherwise throw. Attacker model validated:
the round-27b crafted-invoice technique (checksum-valid bech32, arbitrary HRP amount) is used in
the new tests to prove a hostile invoice is rejected and a legit one still pays.

### F-29-2: Render-phase `setState` in `getActiveConnection` (Medium — React instability)

`getActiveConnection()` called `setActiveConnection(...)` when nothing was active — and
`useWallet()` invokes it **during render** on every consumer. That is the classic "Cannot update a
component while rendering a different component" violation, with re-render cascades through every
wallet-consuming component (zaps, chat, court, marketplace dialogs).

**Fix:** `getActiveConnection` is now a pure read (returns `null` when unset). Auto-select moved to
an explicit `useEffect`, preserving the UX (first connection becomes active) without writes during
render. Callers relying on the old phantom-heal now see `null` and route to their existing
"No wallet" fallbacks — which all already exist.

### F-29-3: Payment timeout ambiguity (Medium — double-spend risk on retry)

The 15s client-side timeout raced the in-flight NWC payment and reported "Payment timed out.
Please try again." But **the race does not cancel the wallet-side payment** — the wallet may still
settle the invoice seconds later. A user following the advice would pay twice.

**Fix:** the timeout path now throws a distinct, honest message ("The payment may still complete —
check your wallet before retrying") so callers cannot treat it as a clean failure. Genuine wallet
rejections (insufficient/invalid) keep their specific messages. The `timeout` string match that
could swallow *wallet-reported* timeouts into the wrong bucket was removed — only the client-side
race produces the indeterminate path now.

### Reviewed, no change needed (verified safe)

- **URI validation** (`validateNwcUri`): both spellings, 64-hex wallet pubkey, wss-only relay
  (ws:// loopback-only), size bounds, secret never echoed (existing tests cover all).
- **Secret storage**: NIP-44 self-encryption keyed per-user, secureStorage on native, plaintext
  legacy migration, user-scoped keys — account switch cannot leak wallets.
- **Error redaction**: every error path passes through `redactSecrets` before toast/console.
- **Zap flows** (`useZap`, `useZaps`, `CourtPage`): amount verified, private-zap preimage contract
  correct, NWC→WebLN→manual fallback ordering sound.

## Verification

- New `src/hooks/useNWCPayment.security.test.ts` (7 tests): hostile-invoice rejection on the NWC
  and WebLN paths, unparseable invoice refusal, happy path still pays, `getActiveConnection`
  purity (no write when unset), stale-active-id returns null.
- Full gates: 1,973 tests / 202 files green, `tsc --noEmit`, ESLint, `npm run build` clean.

## Residual risks / follow-ups

- NWC `pay_invoice` requests carry no client-side amount ceiling beyond the invoice itself; the
  per-flow amount checks (this round) are the enforcement layer.
- `connectionInfo` claims `methods: ['pay_invoice']` without querying the wallet's real
  `get_info` — cosmetic; `useNWCWalletInfo` does the real lookup where it matters.
