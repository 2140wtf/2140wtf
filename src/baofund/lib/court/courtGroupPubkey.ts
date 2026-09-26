// src/lib/court/courtGroupPubkey.ts
//
// Empaneled jury key pin for escrow dispute verdicts.
//
// The standing 2-of-3 FROST court group (vps16gb, phase 1, owner decision
// 2026-09-23) is the REAL empaneled jury. Its x-only public key is the trust
// anchor both the GUI fold (foldDisputeStatus -> verifyEscrowCourtAttestation)
// and the Fund API release gate verify kind-39007 attestations against.
//
// Resolution order:
//   1. VITE_FUND_COURT_GROUP_PUBKEY (64-hex) when set and valid — production
//      builds bake it from ~/.secrets/bao-fund-pins.env via
//      deploy/web/publish-web.sh, like the verifier/registrar pins;
//   2. STANDING_COURT_GROUP_PUBKEY, the committed public key of the standing
//      test group, so dev builds and unconfigured hosts still resolve a real
//      pin (the Execute verdict affordance appears for group-signed verdicts).
//
// NEVER substitute a dispute-derived group key here: its private key is
// publicly computable (see vendor/frost-court/dispute.ts) and pinning it
// would let anyone forge a verdict and steal an escrow.

/**
 * Public x-only key of the standing 2-of-3 FROST court group
 * (fingerprint `ae69bad8d77d32e5`). Rotation replaces this constant and the
 * `VITE_FUND_COURT_GROUP_PUBKEY` pin in the same change window — see
 * docs/COURT-GUI-WIRING-DESIGN.md and bao.markets
 * docs/FROST-COURT-SIGNER.md.
 */
export const STANDING_COURT_GROUP_PUBKEY = '981c3a0bdf6e436fdbe6959d5eb34fd7d29881b811f0e7ccec9bb3ff5963e788';

/** Parse a raw config value; null unless it is exactly 64 hex characters. */
export function courtGroupPinFromConfig(raw: string | undefined): string | null {
  return raw && /^[0-9a-fA-F]{64}$/.test(raw) ? raw.toLowerCase() : null;
}

/** The empaneled jury key the app pins verdicts to (never null: sane fallback). */
export function fundCourtGroupPubkey(): string | null {
  // Literal member access: Vite inlines it in the build and Vitest's
  // vi.stubEnv rewrites it in tests (a dynamic env lookup would miss both).
  return courtGroupPinFromConfig(import.meta.env.VITE_FUND_COURT_GROUP_PUBKEY) ?? STANDING_COURT_GROUP_PUBKEY;
}
