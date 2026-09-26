# Refund execution hold (R10)

## Two refund paths (clarified 2026-09-18, WS-3)

- **On-chain rails** (`btc-testnet4` / `liquid-testnet`): the refund is a
  donor-key `donor_refund` CLTV self-spend with no platform key. It is
  implemented and now covered by the tested core
  (`src/lib/railRefund.ts`, `src/lib/testnet4Refund.ts`,
  `src/lib/refundJournal.ts`; see `docs/TESTNET4-RAIL-DESIGN.md` §6 item 11).
  Nothing below applies to this path.
- **Cashu rail:** the API/mint swap described below remains **DISABLED** — the
  obligations below are unmet; `claimRefund` still returns unavailable.

The previous helper signed API-supplied input secrets (using the wrong
message digest), submitted the server's output set, then reported the entire
candidate amount as refunded when the completion HTTP request succeeded.
Neither output ownership nor returned, unblinded proofs persisted in the
wallet were verified. There are no production callers of `claimRefund` in
this checkout; the exported helper remains for compatibility, but returns
`ok: false`, zero refunded sats and an explicit unavailable message. It does
not request a private key, make HTTP calls, sign witnesses or modify storage.
Candidate discovery remains advisory and does not establish refund eligibility.

Re-enabling execution requires one reviewed end-to-end implementation:

- Donor-client-created output secrets and blinding factors, retained through
  completion/recovery; never accept an arbitrary server-selected output set.
- A trusted mint/keyset contract and complete input/P2PK policy validation,
  including supported sigflags, amounts and the donor's role.
- Correct witness message hashing and independent signature verification.
- Validation/unblinding of returned mint signatures into spendable proofs,
  durable wallet persistence, idempotency and reconciliation after failure.
- Independent failure tests showing wrong-mint, attacker-output, malformed
  signature, success-without-proofs and interrupted persistence cannot report
  success or spend donor inputs to an unverified destination.

No new backend API or money protocol is invented in this containment patch.
The raw-secret signer was removed with the unsafe execution path; replacing
its digest alone would leave the more serious output-ownership gap intact.
