/**
 * Dispute override signing for the BAO Court / FROST appeal layer.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/utils.js';
import * as frost from '@vbyte/frost';
import { runNormalSigningRound } from './signing';
import type { DkgRecord, DisputeCase, FrostAttestation, JurorVote } from './types';

export function hashCommit(outcome: string, salt: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${outcome}|${salt}`)));
}

export function tallyVotes(
  votes: readonly JurorVote[],
): { outcome: string; supportingVotes: JurorVote[] } {
  const revealed = votes.filter((v) => v.reveal);
  const counts = new Map<string, JurorVote[]>();
  for (const v of revealed) {
    if (!v.reveal) continue;
    if (hashCommit(v.reveal.outcome, v.reveal.salt) !== v.commit) {
      throw new Error(`Juror ${v.idx} commit-reveal mismatch`);
    }
    const list = counts.get(v.reveal.outcome) ?? [];
    list.push(v);
    counts.set(v.reveal.outcome, list);
  }

  let winner = '';
  let max = -1;
  for (const [outcome, list] of counts.entries()) {
    if (list.length > max) {
      max = list.length;
      winner = outcome;
    }
  }

  return {
    outcome: winner,
    supportingVotes: counts.get(winner) ?? [],
  };
}

export function deriveDisputeGroupPubkey(
  normalGroupPubkey: string,
  disputeId: string,
): string {
  const order = secp256k1.Point.Fn.ORDER;
  let digest = sha256(new TextEncoder().encode(normalGroupPubkey + disputeId));
  let scalar = bytesToNumberBE(digest) % order;
  // Re-hash on the astronomically unlikely zero scalar to guarantee a valid key.
  while (scalar === 0n) {
    digest = sha256(digest);
    scalar = bytesToNumberBE(digest) % order;
  }
  const scalarBytes = numberToBytesBE(scalar, 32);
  const pk = schnorr.getPublicKey(scalarBytes);
  return bytesToHex(pk);
}

export interface DisputeSigningParams {
  readonly dispute: DisputeCase;
  readonly dkg: DkgRecord;
  readonly shares: readonly frost.SecretShare[];
  /** Outcome to attest. Defaults to the dispute's proposed outcome. */
  readonly outcome?: string;
}

export function runDisputeOverrideSigning(
  params: DisputeSigningParams,
): FrostAttestation {
  const attestation = runNormalSigningRound({
    marketId: params.dispute.marketId,
    outcome: params.outcome ?? params.dispute.proposedOutcome,
    round: 1,
    disputeEventId: params.dispute.disputeId,
    dkg: params.dkg,
    shares: params.shares,
  });

  return {
    ...attestation,
    kind: 39007,
    disputeEventId: params.dispute.disputeId,
  };
}
