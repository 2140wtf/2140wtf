// src/lib/court/executeCourtSettlement.ts
//
// The court verdict execution state machine (release + refund), extracted
// from MilestoneCourtSection so the two-phase Cashu escrow settlement is
// testable without the relay/React tree.
//
// Flow:
//   initiate (API attaches the oracle signature)
//     -> complete (this client attaches the party signature over the SIG_ALL
//        digest and posts the swap back; the API executes it at the mint and
//        records the settlement)
//   A response without an `escrow_release`/`escrow_refund` swap means the
//   API already recorded the settlement (non-Cashu rails) -> executed.
//
// Honesty rules (deep-hunt wave 5 invariant):
//   - an initiate is NEVER reported as executed;
//   - a failure AFTER the initiate is reported as "incomplete, escrow NOT
//     settled", never as "nothing changed";
//   - a sign-in method without the seed identity cannot sign the swap: the
//     initiate is reported as awaiting completion from a seed-signed session.

import { releaseMilestone, type SignerLike } from '../baoFundraising';
import { fundFetch } from '../fundHttp';
import { errorMessage } from '../errors';
import {
  completeEscrowRefund,
  completeEscrowRelease,
  parseEscrowSwapForCompletion,
  signEscrowSwapForParty,
  type EscrowSwapExpectation,
} from '../cashu/escrowSwapComplete';

export type CourtSettlementStatus = 'executed' | 'initiated-unsigned-method' | 'initiated-failed';

export interface CourtSettlementResult {
  status: CourtSettlementStatus;
  message: string;
  /** The recorded milestone on the non-escrow (already-settled) path. */
  milestone?: { title?: string; status?: string };
  /** Present when the escrow swap was completed client-side. */
  milestoneStatus?: string;
  releasedSats?: number;
}

export interface CourtSettlementDeps {
  viewerRole: 'donor' | 'founder';
  signer: SignerLike;
  /** Seed identity privkey hex; null when the sign-in method cannot expose it. */
  identityHex: string | null;
  /** The authenticated caller's pubkey (must be the owner / the donor). */
  myPubkey: string;
  frId: string;
  milestoneId: string;
  attestationEventId: string;
  /** Donor-side: the contribution to refund; resolved when omitted. */
  donorContributionId?: string;
  /** Donor-side resolver (defaults to the exported resolver). */
  resolveDonorContributionId: (frId: string, donorPubkey: string) => Promise<string | null>;
  /** Injectable transports for tests. */
  release?: typeof releaseMilestone;
  completeRelease?: typeof completeEscrowRelease;
  completeRefund?: typeof completeEscrowRefund;
  /**
   * Refund initiate transport; defaults to POST .../refund through fundFetch.
   * Returns the raw `data` object (the `escrow_refund` lives on it).
   */
  fetchRefundInitiate?: (opts: { signer: SignerLike; cid: string }) => Promise<Record<string, unknown> | undefined>;
}

interface ReleaseEscrowWire {
  swap?: unknown;
  awaiting?: unknown;
  verifier_pubkey?: unknown;
  project_output_sats?: unknown;
  fee_sats?: unknown;
  mint_fee_sats?: unknown;
}

interface RefundEscrowWire {
  swap?: unknown;
  awaiting?: unknown;
  refund_sats?: unknown;
}

async function defaultRefundInitiate(
  frId: string,
  attestationEventId: string,
  signer: SignerLike,
  cid: string,
): Promise<Record<string, unknown> | undefined> {
  const res = await fundFetch<{ data?: Record<string, unknown> }>(
    `/v1/fundraisers/${encodeURIComponent(frId)}/contributions/${encodeURIComponent(cid)}/refund`,
    { method: 'POST', body: { proof_event_id: attestationEventId }, signer },
  );
  return res?.data;
}

export interface FounderReleaseDeps {
  signer: SignerLike;
  /** Seed identity privkey hex; null when the sign-in method cannot expose it. */
  identityHex: string | null;
  myPubkey: string;
  frId: string;
  milestoneId: string;
  /** Proof event recorded with the release (optional). */
  proofEventId?: string;
  /** Payout reference recorded with the release (court passes the caller pubkey). */
  payoutReference?: string;
  /** Injectable transports for tests. */
  release?: typeof releaseMilestone;
  completeRelease?: typeof completeEscrowRelease;
}

/**
 * Execute a founder milestone release. A plain release response means the API
 * recorded the settlement; a `escrow_release` initiate is completed with the
 * project signature here. Shared by the court verdict path and the owner's
 * AttestModal release path - an initiate must NEVER be reported as settled.
 */
export async function executeFounderRelease(deps: FounderReleaseDeps): Promise<CourtSettlementResult> {
  const release = deps.release ?? releaseMilestone;
  const completeRelease = deps.completeRelease ?? completeEscrowRelease;

  const result = await release(deps.signer, deps.frId, deps.milestoneId, {
    ...(deps.proofEventId ? { proof_event_id: deps.proofEventId } : {}),
    ...(deps.payoutReference ? { payout_reference: deps.payoutReference } : {}),
  }) as unknown as Record<string, unknown>;
  const escrow = result?.escrow_release as ReleaseEscrowWire | undefined;
  if (!escrow) {
    if (result?.escrow_refund) {
      return incomplete('project', new Error('the release initiate returned a refund-shaped swap - refusing to report the release as settled'));
    }
    const milestone = result?.milestone as { title?: unknown; status?: unknown } | undefined;
    return {
      status: 'executed',
      message: 'Court verdict executed.',
      ...(milestone && typeof milestone === 'object'
        ? {
            milestone: {
              ...(typeof milestone.title === 'string' ? { title: milestone.title } : {}),
              ...(typeof milestone.status === 'string' ? { status: milestone.status } : {}),
            },
          }
        : {}),
    };
  }
  const awaiting = Array.isArray(escrow.awaiting) ? escrow.awaiting.join('/') : 'project';
  if (!deps.identityHex) return unsignedMethod(awaiting);
  if (typeof escrow.verifier_pubkey !== 'string' || typeof escrow.project_output_sats !== 'number'
    || typeof escrow.fee_sats !== 'number' || typeof escrow.mint_fee_sats !== 'number') {
    return incomplete(awaiting, new Error('the release initiate response is missing the escrow payout facts'));
  }
  // The payout key is OUR key (the API enforces caller === owner); the
  // oracle key is proven by its signature over the swap digest.
  const expectation: EscrowSwapExpectation = {
    mint: null,
    payoutPubkey: deps.myPubkey,
    payoutSats: escrow.project_output_sats,
    feePubkey: escrow.verifier_pubkey,
    feeSats: escrow.fee_sats,
    mintFeeSats: escrow.mint_fee_sats,
    partyPubkey: deps.myPubkey,
    oraclePubkey: escrow.verifier_pubkey,
  };
  try {
    const parsed = parseEscrowSwapForCompletion(escrow.swap, expectation);
    const signed = signEscrowSwapForParty(parsed, deps.identityHex);
    const settled = await completeRelease({
      signer: deps.signer,
      frId: deps.frId,
      milestoneId: deps.milestoneId,
      swap: signed,
      proofEventId: deps.proofEventId,
    });
    return {
      status: 'executed',
      message: `Settlement complete - milestone ${settled.milestoneStatus} (${settled.releasedSats.toLocaleString()} sats released).`,
      milestoneStatus: settled.milestoneStatus,
      releasedSats: settled.releasedSats,
    };
  } catch (err) {
    return incomplete(awaiting, err);
  }
}

/** Execute a court verdict (release for the founder, refund for the donor). */
export async function executeCourtSettlement(deps: CourtSettlementDeps): Promise<CourtSettlementResult> {
  if (deps.viewerRole === 'founder') {
    return executeFounderRelease({
      signer: deps.signer,
      identityHex: deps.identityHex,
      myPubkey: deps.myPubkey,
      frId: deps.frId,
      milestoneId: deps.milestoneId,
      proofEventId: deps.attestationEventId,
      payoutReference: deps.myPubkey,
      release: deps.release,
      completeRelease: deps.completeRelease,
    });
  }
  const completeRefund = deps.completeRefund ?? completeEscrowRefund;

  // Donor side: one contribution, refunded to the donor.
  const cid = deps.donorContributionId ?? (await deps.resolveDonorContributionId(deps.frId, deps.myPubkey));
  if (!cid) {
    throw new Error('no unambiguous escrowed cashu contribution found - pass the contribution id explicitly (the public payload does not carry milestone_id)');
  }
  const data = deps.fetchRefundInitiate
    ? await deps.fetchRefundInitiate({ signer: deps.signer, cid })
    : await defaultRefundInitiate(deps.frId, deps.attestationEventId, deps.signer, cid);
  const escrow = data?.escrow_refund as RefundEscrowWire | undefined;
  if (!escrow) {
    if (data?.escrow_release) {
      return incomplete('donor', new Error('the refund initiate returned a release-shaped swap - refusing to report the refund as settled'));
    }
    return { status: 'executed', message: 'Court verdict executed.' };
  }
  const awaiting = Array.isArray(escrow.awaiting) ? escrow.awaiting.join('/') : 'donor';
  if (!deps.identityHex) return unsignedMethod(awaiting);
  if (typeof escrow.refund_sats !== 'number') {
    return incomplete(awaiting, new Error('the refund initiate response is missing the refund amount'));
  }
  const expectation: EscrowSwapExpectation = {
    mint: null,
    payoutPubkey: deps.myPubkey,
    payoutSats: escrow.refund_sats,
    partyPubkey: deps.myPubkey,
  };
  try {
    const parsed = parseEscrowSwapForCompletion(escrow.swap, expectation);
    const signed = signEscrowSwapForParty(parsed, deps.identityHex);
    const settled = await completeRefund({
      signer: deps.signer,
      frId: deps.frId,
      contributionId: String(cid),
      swap: signed,
    });
    return {
      status: 'executed',
      message: `Court verdict executed - ${settled.refundSats.toLocaleString()} sats refunded to the donor.`,
    };
  } catch (err) {
    return incomplete(awaiting, err);
  }
}

function unsignedMethod(awaiting: string): CourtSettlementResult {
  return {
    status: 'initiated-unsigned-method',
    message: `Settlement initiated (awaiting: ${awaiting}) - this sign-in method cannot sign the escrow swap (needs a seed identity); complete it from a seed-signed session. The escrow is NOT settled yet.`,
  };
}

function incomplete(awaiting: string, err: unknown): CourtSettlementResult {
  return {
    status: 'initiated-failed',
    message: `Settlement incomplete (initiated, awaiting: ${awaiting}; the escrow is NOT settled): ${errorMessage(err)}`,
  };
}
