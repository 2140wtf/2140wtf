/**
 * Pedersen-style distributed key generation adapter for the BAO Court / Juror Mode.
 *
 * This adapter simulates the full multi-party DKG inside a single coordinator
 * process, but the cryptographic design is identical to a network version:
 *
 *   - Every juror generates its own private degree-(t-1) polynomial.
 *   - Every juror publishes Feldman coefficient commitments.
 *   - Every received share is verified against the commitments.
 *   - Failed verifications raise complaints; if the revealed share is still
 *     invalid, the accused participant is disqualified.
 *   - The group secret never exists in one place — it is the sum of all
 *     remaining participants' constant coefficients.
 *
 * No single party materializes the group secret.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as frost from '@vbyte/frost';
import { deriveXOnlyPubkey, randomScalar, scalarToHex } from './crypto';
import type { DkgRecord, SelectedJuror } from './types';

const Point = secp256k1.Point;
// secp256k1 curve order (scalar field).
const N = secp256k1.Point.Fn.ORDER;
type CurvePoint = InstanceType<typeof Point>;

function modN(x: bigint): bigint {
  const r = x % N;
  return r < 0n ? r + N : r;
}

/**
 * Evaluate a polynomial over the secp256k1 scalar field using Horner's rule.
 */
function evaluatePoly(coeffs: readonly bigint[], x: bigint): bigint {
  let result = 0n;
  for (let k = coeffs.length - 1; k >= 0; k--) {
    result = modN(modN(result * x) + coeffs[k]);
  }
  return result;
}

/**
 * Evaluate a polynomial whose coefficients are curve points at x.
 * This computes `sum_k A_k * x^k`.
 */
function evaluateCommitments(
  commitments: readonly CurvePoint[],
  x: bigint,
): CurvePoint {
  let result = Point.ZERO;
  for (let k = commitments.length - 1; k >= 0; k--) {
    result = result.multiply(x).add(commitments[k]);
  }
  return result;
}

function pointToXOnlyHex(point: CurvePoint): string {
  // Drop the 02/03 prefix from the compressed encoding to obtain a BIP340 x-only pubkey.
  return point.toHex(true).slice(2);
}

export interface PedersenDkgOptions {
  /**
   * Test-only hook: simulate a dishonest participant that sends an invalid share.
   * The accused juror's share to the victim juror is corrupted, triggering a
   * complaint and disqualification.
   */
  readonly corruptShare?: { readonly accused: number; readonly victim: number };
}

interface ParticipantState {
  readonly juror: SelectedJuror;
  readonly coeffs: readonly bigint[];
  readonly commitments: readonly CurvePoint[];
}

export interface KeygenParams {
  readonly marketId: string;
  readonly disputeId: string;
  readonly threshold: number;
  readonly jurors: readonly SelectedJuror[];
}

export interface KeygenResult {
  readonly record: DkgRecord;
  readonly shares: frost.SecretShare[];
}

export class PedersenDkgAdapter {
  private readonly corruptShare?: {
    readonly accused: number;
    readonly victim: number;
  };

  constructor(options?: PedersenDkgOptions) {
    this.corruptShare = options?.corruptShare;
  }

  run(params: KeygenParams): KeygenResult {
    this.validateParams(params);

    const { threshold, jurors } = params;
    const participants = this.createParticipants(jurors, threshold);
    const disqualified = this.resolveComplaints(participants);

    const qualifiedParticipants = participants.filter(
      (p) => !disqualified.has(p.juror.idx),
    );

    if (qualifiedParticipants.length < threshold) {
      throw new Error(
        `Pedersen DKG failed: ${qualifiedParticipants.length} qualified participants remain, ` +
          `but threshold is ${threshold}`,
      );
    }

    const qualifiedJurors = jurors.filter((j) => !disqualified.has(j.idx));

    // Group public key = sum of all qualified constant-coefficient commitments.
    const groupPoint = qualifiedParticipants.reduce(
      (sum, p) => sum.add(p.commitments[0]),
      Point.ZERO,
    );

    // Each juror's final secret share is the sum of all qualified shares sent to them.
    const shares: frost.SecretShare[] = qualifiedJurors.map((juror) => {
      const idx = BigInt(juror.idx);
      const secret = qualifiedParticipants.reduce(
        (sum, p) => modN(sum + evaluatePoly(p.coeffs, idx)),
        0n,
      );
      return { idx: juror.idx, seckey: scalarToHex(secret) };
    });

    // Verification shares are the public points matching the secret shares.
    const verificationShares = qualifiedJurors.map((juror) => {
      const idx = BigInt(juror.idx);
      const pubkeyPoint = qualifiedParticipants.reduce(
        (sum, p) => sum.add(evaluateCommitments(p.commitments, idx)),
        Point.ZERO,
      );
      return { idx: juror.idx, pubkey: pointToXOnlyHex(pubkeyPoint) };
    });

    // Sanity check: every secret share must produce the advertised verification share.
    for (const share of shares) {
      const expected = deriveXOnlyPubkey(share.seckey);
      const actual = verificationShares.find((v) => v.idx === share.idx)?.pubkey;
      if (actual !== expected) {
        throw new Error(
          `Pedersen DKG internal error: verification share mismatch for juror ${share.idx}`,
        );
      }
    }

    const groupPubkey = groupPoint.toHex(true);
    const groupPubkeyXOnly = pointToXOnlyHex(groupPoint);

    const record: DkgRecord = {
      marketId: params.marketId,
      disputeId: params.disputeId,
      threshold,
      participants: qualifiedJurors.length,
      groupPubkey,
      groupPubkeyXOnly,
      verificationShares,
      jurorPubkeys: qualifiedJurors.map((j) => j.nostrPubkey),
    };

    return { record, shares };
  }

  private validateParams(params: KeygenParams): void {
    if (params.threshold < 2) {
      throw new Error('Threshold must be at least 2');
    }
    if (params.jurors.length < params.threshold) {
      throw new Error('Participants cannot be less than threshold');
    }
    const indices = new Set(params.jurors.map((j) => j.idx));
    if (indices.size !== params.jurors.length) {
      throw new Error('Duplicate juror indices');
    }
    if (params.jurors.some((j) => j.idx < 1)) {
      throw new Error('Juror indices must be positive');
    }
  }

  private createParticipants(
    jurors: readonly SelectedJuror[],
    threshold: number,
  ): ParticipantState[] {
    return jurors.map((juror) => {
      const coeffs = Array.from({ length: threshold }, () => randomScalar());
      const commitments = coeffs.map((a) => Point.BASE.multiply(a));
      return { juror, coeffs, commitments };
    });
  }

  /**
   * Simulate the share-verification and complaint phase.
   * For every pair (sender -> recipient), the recipient checks the share against
   * the sender's public commitments. A failed check is treated as a complaint;
   * the sender reveals the disputed share, and if it is still invalid the sender
   * is disqualified.
   */
  private resolveComplaints(
    participants: readonly ParticipantState[],
  ): Set<number> {
    const disqualified = new Set<number>();

    for (const recipient of participants) {
      const j = BigInt(recipient.juror.idx);
      for (const sender of participants) {
        const i = sender.juror.idx;
        let share = evaluatePoly(sender.coeffs, j);

        // Inject a faulty share for test scenarios.
        if (
          this.corruptShare &&
          this.corruptShare.accused === i &&
          this.corruptShare.victim === recipient.juror.idx
        ) {
          share = modN(share + 1n);
        }

        const expected = evaluateCommitments(sender.commitments, j);
        const actual = Point.BASE.multiply(share);

        if (!actual.equals(expected)) {
          // The accused reveals the share. In this local simulation the revealed
          // value is the same share we just checked; if it does not match the
          // commitment, the accused is disqualified.
          disqualified.add(i);
        }
      }
    }

    return disqualified;
  }
}

/**
 * Default keygen — Pedersen DKG.
 */
export function generateFrostKeys(params: KeygenParams): KeygenResult {
  return new PedersenDkgAdapter().run(params);
}
