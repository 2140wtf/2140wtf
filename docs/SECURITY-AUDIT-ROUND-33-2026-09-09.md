# Security Audit — Round 33 (2026-09-09)

**Focus:** Gamma Markets order lifecycle — kind-16/17 DM parsing → order aggregation → the buyer's Pay dialog and the read-only order detail/list dialogs. Feed/markets/fund campaign, trollbox excluded.

**Surface:** `src/lib/gammaMarkets.ts` (order/receipt parsers), `OrderDetailDialog.tsx`, `OrdersTab.tsx`, `PayOrderDialog.tsx`.

## Findings

### F-33-1: Order/receipt string fields and tag counts were unbounded (Medium — DoS/layout)

Round 30 capped the numeric fields (amount, quantity, eta) but left every string and array reached through Git-style tag parsing unbounded:

- **item** `address` — rendered in `OrdersTab` and `OrderDetailDialog`; a megabyte `30402:…` address pinned absurd widths.
- **payment option** `value` (invoice / bitcoin address / Cashu token) — rendered in `PayOrderDialog` and `OrderDetailDialog` and QR-encoded.
- **receipt** `reference` / `proof` — rendered verbatim in the merchant's order detail (including a payment preimage a malicious sender could stuff with data).
- **shipping** `address`, message `content` (note), payment-option **count**, item **count**, receipt payment **count** — all unbounded.

**Fix:** new caps in `gammaMarkets.ts` — strings (incl. payment values, proofs, addresses, notes) capped at 2000 chars (binging), items ≤ 50, payments (both payment-options and receipt payments) ≤ 10. The order-id cap stays firm at its pre-existing 200 = `MAX_ORDER_ID_LENGTH` (an order id is a short identifier, not a display string).

### F-33-2: N/A — payment-amount integrity already sound

Reviewed `useGammaPayment.pay`: BOLT11 amount is verified against the order amount (`invoiceMsats !== amountSats * 1000`), BOLT12 pays the exact amount, and success requires a returned proof. No change needed.

## Verified safe (no change needed)

- **Nil-render of hostile strings** — `OrderDetailDialog` / `OrdersTab` render order values as React text nodes (`break-all`/`whitespace-pre-wrap`), never `dangerouslySetInnerHTML`; no linkification of payment values.
- **Payment amount verification** — BOLT11 invoice amount must equal the order amount; BOLT12 pays exact sats; only a returned proof marks success.
- **QR generation** — `payOrderDialog` QR-encodes the (capped) payment value via `qrcode`; the value is also clipboard-copied as plain text only.
- **Receipt sender trust** — round 30's role matrix already restricts receipt creation to the buyer; this round only bounds the payload sizes a *legitimate* buyer can send.
- **Aggregation reuse** — `aggregateGammaOrders` consumes the same parsed shape, so the new caps flow through to aggregate output everywhere.

## Tests

- `gammaMarkets.test.ts` — 5 new adversarial cases (oversize item address, oversize shipping/note capped to 2000, items capped at 50, oversize payment values dropped + option count capped at 10, receipt proof cap + count cap). Pre-existing 14 cases still green including the firm 200-char order-id rejection.