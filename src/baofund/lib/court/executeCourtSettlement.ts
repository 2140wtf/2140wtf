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
  type EscrowSwapWire,
} from '../cashu/escrowSwapComplete';
import { recoverEscrowPayout, type EscrowPayoutSignature, type RecoveredEscrowPayout } from '../cashu/escrowPayout';

export type CourtSettlementStatus = 'executed' | 'initiated-unsigned-method' | 'initiated-failed';

/** Outcome of the payout unblind/store step that follows a completion. */
export interface EscrowPayoutOutcome {
  amountSats: number;
  /** `wallet` = adopted into the local wallet; `journal` = saved for manual
   *  recovery; `failed` = NOT stored (warning carries the reason). */
  stored: 'wallet' | 'journal' | 'failed';
  warning?: string;
}

export interface CourtSettlementResult {
  status: CourtSettlementStatus;
  message: string;
  /** The recorded milestone on the non-escrow (already-settled) path. */
  milestone?: { title?: string; status?: string };
  /** Present when the escrow swap was completed client-side. */
  milestoneStatus?: string;
  releasedSats?: number;
  /** Present when the completion settled an escrow payout (or failed to). */
  payout?: EscrowPayoutOutcome;
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
  /** Injectable payout recovery (unblind + store). */
  recoverPayout?: typeof recoverEscrowPayout;
  /**
   * Refund initiate transport; defaults to POST .../refund through fundFetch.
   * Returns the raw `data` object (the `escrow_refund` lives on it).
   */
  fetchRefundInitiate?: (opts: { signer: SignerLike; cid: string }) => Promise<Record<string, unknown> | undefined>;
}

/**
 * Unblind + store a completed swap's payout; never throws. A recovery
 * failure must not turn a settled release/refund into a reported failure
 * (the escrow IS settled at the mint) - it is surfaced as a warning.
 */
async function recoverPayoutFor(opts: {
  kind: 'release' | 'refund';
  recover: typeof recoverEscrowPayout | undefined;
  wire: EscrowSwapWire;
  signatures: readonly EscrowPayoutSignature[] | null;
  expectedPayoutSats: number;
  myPubkey: string;
  identityHex: string | null;
  frId: string;
  milestoneId: string;
  /**
   * Journal scope override. The payout journal dedupes by (frId,
   * milestoneId), which is exact for a RELEASE (one per milestone) but
   * collides for REFUNDS: a donor with two refunded contributions in one
   * milestone would have the second payout overwrite the first's journal
   * entry. Refunds therefore journal under `<milestoneId>::c<contributionId>`.
   */
  journalId?: string;
}): Promise<EscrowPayoutOutcome | undefined> {
  if (!opts.signatures || opts.signatures.length === 0) {
    return {
      amountSats: 0,
      stored: 'failed',
      warning: 'the API returned no mint signatures for the payout - it cannot be unblinded or stored (contact an admin with the release details)',
    };
  }
  const recover = opts.recover ?? recoverEscrowPayout;
  try {
    const recovered: RecoveredEscrowPayout = await recover({
      kind: opts.kind,
      frId: opts.frId,
      milestoneId: opts.journalId ?? opts.milestoneId,
      mint: opts.wire.mint,
      expectedPayoutSats: opts.expectedPayoutSats,
      outputs: opts.wire.outputs,
      signatures: opts.signatures,
      identityPubkey: opts.myPubkey,
      identityHex: opts.identityHex,
    });
    return { amountSats: recovered.amountSats, stored: recovered.stored };
  } catch (err) {
    return { amountSats: 0, stored: 'failed', warning: errorMessage(err) };
  }
}

/** The user-facing sentence for a payout outcome (empty when none). */
export function payoutOutcomeNote(payout: EscrowPayoutOutcome | undefined): string {
  if (!payout) return '';
  if (payout.stored === 'failed') {
    return ` Payout recovery pending: ${payout.warning ?? 'the payout could not be stored'}.`;
  }
  const verb = payout.stored === 'wallet' ? 'added to your wallet' : 'saved under Wallet - escrow payouts';
  return ` Payout ${payout.amountSats.toLocaleString()} sats ${verb}.`;
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
  /** Injectable payout recovery (unblind + store). */
  recoverPayout?: typeof recoverEscrowPayout;
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
    // The settlement is real from here on: a payout-recovery failure is a
    // warning, never reported as "not settled".
    const payout = await recoverPayoutFor({
      kind: 'release',
      recover: deps.recoverPayout,
      wire: parsed.wire,
      signatures: settled.swapSignatures,
      expectedPayoutSats: escrow.project_output_sats,
      myPubkey: deps.myPubkey,
      identityHex: deps.identityHex,
      frId: deps.frId,
      milestoneId: deps.milestoneId,
    });
    return {
      status: 'executed',
      message: `Settlement complete - milestone ${settled.milestoneStatus} (${settled.releasedSats.toLocaleString()} sats released).${payoutOutcomeNote(payout)}`,
      milestoneStatus: settled.milestoneStatus,
      releasedSats: settled.releasedSats,
      ...(payout ? { payout } : {}),
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
      recoverPayout: deps.recoverPayout,
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
    // The refund route settles ONLY by swap: a 2xx response without an
    // `escrow_refund` is a protocol violation, not a recorded settlement.
    // Reporting it as executed hid uncompleted refunds (audit).
    return incomplete('donor', new Error('the refund response is missing the escrow_refund swap - refusing to report the refund as settled'));
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
    const payout = await recoverPayoutFor({
      kind: 'refund',
      recover: deps.recoverPayout,
      wire: parsed.wire,
      signatures: settled.swapSignatures,
      expectedPayoutSats: escrow.refund_sats,
      myPubkey: deps.myPubkey,
      identityHex: deps.identityHex,
      frId: deps.frId,
      milestoneId: deps.milestoneId,
      // Per-contribution journal scope: two refunds on one milestone must not
      // overwrite each other's unrecovered payout (money-journal audit).
      journalId: `${deps.milestoneId}::c${cid}`,
    });
    return {
      status: 'executed',
      message: `Court verdict executed - ${settled.refundSats.toLocaleString()} sats refunded to the donor.${payoutOutcomeNote(payout)}`,
      ...(payout ? { payout } : {}),
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
