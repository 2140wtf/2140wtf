// src/lib/court/escrowDrill.ts
//
// Pure timing helpers for the WS1 live escrow drill
// (`courtSettlement.live.test.ts`). They pin the DEPLOYED Fund API's escrow
// timing contract so the harness cannot drift from it again:
//
//   - strict deposit validation requires every proof's NUT-11 refund locktime
//     to be at least `ORACLE_SIGN_MIN_LOCKTIME_MARGIN_SECONDS` in the future
//     (24h — bao.markets packages/api/src/services/cashuEscrow.ts), so the
//     drill's original 3,700s locktime was rejected by the live API with
//     "Proof refund locktime is before the required minimum" (the runbook's
//     "~1h" was stale);
//   - the donor's unilateral mint refund key becomes spendable only after that
//     same locktime (`n_sigs_refund = 1`), so the drill's refund phase must
//     wait out the CLTV when the API's own refund gate is not open yet.
//
// Free test mints only; never real sats (docs/ESCROW-ACCEPTANCE.md).

import type { Proof } from 'cashu-ts3';
import { parseMultisigLockSecret } from '../cashu/escrowMultisig';

/** Deployed API minimum: `ORACLE_SIGN_MIN_LOCKTIME_MARGIN_SECONDS` (24h). */
export const API_ORACLE_MIN_LOCKTIME_SECONDS = 24 * 60 * 60;

/** The drill builds deposits ten minutes beyond the API minimum so the
 *  server's own `now` sample can never race the boundary. */
export const ESCROW_DEPOSIT_LOCKTIME_SECONDS = API_ORACLE_MIN_LOCKTIME_SECONDS + 600;

/**
 * Soonest NUT-11 refund locktime across escrow proofs, or null when any proof
 * is not a parsed P2PK lock carrying a locktime. Proof-based (not token-based)
 * on purpose: the v2-keyset tokens the drill uses cannot be decoded without
 * the mint's keyset map, so the harness decodes with keysets and passes the
 * proofs here.
 */
export function escrowLocktimeFromProofs(proofs: Proof[]): number | null {
  let soonest: number | null = null;
  for (const proof of proofs) {
    const lock = parseMultisigLockSecret(proof.secret);
    if (!lock || lock.locktime === undefined) return null;
    soonest = soonest === null ? lock.locktime : Math.min(soonest, lock.locktime);
  }
  return soonest;
}

/**
 * True once the escrow CLTV has passed: the donor's refund key alone can spend
 * the locked proofs at the mint. Boundary is inclusive — the mint honors the
 * refund path at `locktime <= now`.
 */
export function donorMintRefundReady(opts: { locktime: number | null; nowSeconds: number }): boolean {
  return opts.locktime !== null && opts.locktime <= opts.nowSeconds;
}
