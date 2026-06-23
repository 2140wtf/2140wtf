/**
 * FROST threshold signing for the BAO Court / Juror Mode appeal layer.
 */

import * as frost from '@vbyte/frost';
import { hexToBytes } from '@noble/hashes/utils.js';
import { buildAttestationMessage, deriveXOnlyPubkey } from './crypto';
import type { DkgRecord, FrostAttestation } from './types';

export interface SigningCommitment {
  readonly idx: number;
  readonly pubkey: string;
  readonly commit: frost.CommitmentPackage;
}

export interface SigningReveal {
  readonly idx: number;
  readonly pubkey: string;
  readonly pnonce: frost.PublicNonce;
  readonly psig: string;
}

export interface SigningRoundParams {
  readonly marketId: string;
  readonly outcome: string;
  readonly round: number | string;
  readonly disputeEventId?: string;
  readonly dkg: DkgRecord;
  readonly shares: readonly frost.SecretShare[];
}

export function createCommitments(
  shares: readonly frost.SecretShare[],
): SigningCommitment[] {
  return shares.map((share) => ({
    idx: share.idx,
    pubkey: deriveXOnlyPubkey(share.seckey),
    commit: frost.Lib.create_commit_pkg(share),
  }));
}

export function createRevealsAndPartialSigs(
  params: SigningRoundParams,
  commitments: readonly SigningCommitment[],
): SigningReveal[] {
  const message = buildAttestationMessage(
    params.marketId,
    params.outcome,
    params.round,
    params.disputeEventId,
  );

  const ctx = frost.Lib.get_group_signing_ctx(
    params.dkg.groupPubkey,
    commitments.map((c) => c.commit),
    message,
  );

  return params.shares.map((share) => {
    const commit = frost.Lib.get_commit_pkg(
      commitments.map((c) => c.commit),
      share,
    );
    const sig = frost.Lib.sign_msg(ctx, share, commit);

    const valid = frost.Lib.verify_partial_sig(
      ctx,
      commit,
      sig.pubkey,
      sig.psig,
    );
    if (!valid) {
      throw new Error(`Partial signature from juror ${share.idx} failed verification`);
    }

    return {
      idx: share.idx,
      pubkey: sig.pubkey,
      pnonce: commit,
      psig: sig.psig,
    };
  });
}

export function aggregateAttestation(
  params: SigningRoundParams,
  commitments: readonly SigningCommitment[],
  reveals: readonly SigningReveal[],
): FrostAttestation {
  const message = buildAttestationMessage(
    params.marketId,
    params.outcome,
    params.round,
    params.disputeEventId,
  );

  const ctx = frost.Lib.get_group_signing_ctx(
    params.dkg.groupPubkey,
    commitments.map((c) => c.commit),
    message,
  );

  const signatureHex = frost.Lib.combine_partial_sigs(
    ctx,
    reveals.map((r) => ({ idx: r.idx, pubkey: r.pubkey, psig: r.psig })),
  );

  const pubNonce = signatureHex.slice(0, 64);

  const isValid = frost.Lib.verify_final_sig(
    ctx,
    hexToBytes(message),
    hexToBytes(signatureHex),
  );
  if (!isValid) {
    throw new Error('Final aggregated signature failed verification');
  }

  return {
    marketId: params.marketId,
    outcome: params.outcome,
    signature: signatureHex,
    pubNonce,
    groupPubkey: params.dkg.groupPubkeyXOnly,
    message,
    kind: 89,
  };
}

export function runNormalSigningRound(
  params: SigningRoundParams,
): FrostAttestation {
  const commitments = createCommitments(params.shares);
  const reveals = createRevealsAndPartialSigs(params, commitments);
  return aggregateAttestation(params, commitments, reveals);
}
