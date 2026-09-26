/**
 * MilestoneCourtSection - S3 composite (COURT-GUI-WIRING-DESIGN.md §2).
 *
 * The ONE component a milestone surface mounts to get the full donor path:
 *
 *   - no dispute → "Dispute this" affordance (S1 modal, role-aware)
 *   - dispute open → live DisputeStatusCard (S2, verified verdicts only)
 *   - verified verdict naming ME → "Execute verdict" → releaseMilestone /
 *     refundContribution through the Fund API, whose escrow gate accepts the
 *     disputed path only with the kind-39007 attestation (S3). The GUI never
 *     resolves anything itself; it carries the evidence the gate demands.
 *
 * Fail-closed transport (round-2): with the API unreachable the execute call
 * surfaces one typed error - no retry loop that could half-fire.
 *
 * Websocket + fetch of dispute events are relay-only. The party/jury context
 * comes from the caller; when the jury key is not yet known (no selection/DKG
 * record) the status card renders in "evidence-only" mode and Execute stays
 * hidden - a verdict cannot be verified without pinning the empaneled key.
 */
import React, { useMemo, useState } from 'react';
import { WebRelayConn } from '@/baofund/community/websocket.js';
import { useAuth } from '../auth/useAuth';
import { resolveDonorContributionId } from '../lib/court/donorContribution';
import type { SignerLike } from '../lib/baoFundraising';
import { baoRelayUrl } from '../lib/baoFundraising';
import { errorMessage } from '../lib/errors';
import type { FoldedDispute } from '../lib/court/disputeStatus';
import { executeCourtSettlement } from '../lib/court/executeCourtSettlement';
import { useCourtDispute } from './useCourtDispute';
import { DisputeStatusCard } from './DisputeStatusCard';
import { OpenDisputeModal } from './OpenDisputeModal';
import './court.css';

export interface MilestoneCourtSectionProps {
  escrowId: string;
  /** The milestone these funds lock to (Fund API identifiers). */
  frId: string;
  milestoneId: string;
  /** Both escrow parties: contributor (donor) + campaign owner (founder). */
  contributorPubkey: string;
  founderPubkey: string;
  /** The escrow's anchor event id for the dispute's `e`/root tag. */
  marketEventId: string;
  /** Seconds since the escrow locked (drives the refund-race gate). */
  secondsSinceEscrowLock: number;
  /** REAL empaneled jury key once the court completes DKG (null before). */
  courtGroupPubkey: string | null;
  /** Whose milestone view this is (drives role copy + execute path). */
  viewerRole: 'donor' | 'founder';
  /** Donor-side: the contribution to refund on a verdict. Resolved from the
   *  authenticated pubkey when omitted (donor's escrowed contribution). */
  donorContributionId?: string;
  onDone?: (msg: string) => void;
}

// Donor-side contribution resolution lives in lib/court/donorContribution.ts
// (component files export only components; the WS1 live drill shares the
// same selection rule).

export function MilestoneCourtSection(props: MilestoneCourtSectionProps) {
  const {
    escrowId, frId, milestoneId, contributorPubkey, founderPubkey,
    marketEventId, secondsSinceEscrowLock, courtGroupPubkey, viewerRole, donorContributionId, onDone,
  } = props;
  const auth = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = useCourtDispute({
    escrowId,
    partyAPubkey: contributorPubkey,
    partyBPubkey: founderPubkey,
    courtGroupPubkey,
  });

  // S1 gate input: dispute EXISTENCE is what blocks a second open; the full
  // fold lives in the hook (status). A partial FoldedDispute satisfies
  // canOpenDispute's existing-dispute check.
  const existing: FoldedDispute | null = useMemo(
    () => (live.disputeEventId ? ({ disputeId: live.disputeEventId } as FoldedDispute) : null),
    [live.disputeEventId],
  );

  if (!auth.signer || !auth.pubkey) return null;
  const myPubkey: string = auth.pubkey;

  const execute = async (attestationEventId: string, _winnerPubkey: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await executeCourtSettlement({
        viewerRole,
        signer: auth.signer as unknown as SignerLike,
        identityHex: auth.seedIdentityHex(),
        myPubkey,
        frId,
        milestoneId,
        attestationEventId,
        donorContributionId,
        resolveDonorContributionId,
      });
      if (res.status === 'initiated-failed') {
        // The initiate landed but completion did not: the escrow is NOT
        // settled, so this is an error state, not a success toast.
        setError(res.message);
      } else {
        onDone?.(res.message);
      }
    } catch (err) {
      // Round-2 fail-closed: one typed error, no retries.
      setError(`Execute failed (nothing changed): ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const sendEvent = (e: { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }) => {
    const conn = new WebRelayConn(baoRelayUrl());
    try {
      void conn.publish(e as never);
    } finally {
      conn.close();
    }
  };

  return (
    <div className="milestone-court-section">
      {live.status ? (
        <DisputeStatusCard
          status={live.status}
          now={live.now}
          myPubkey={myPubkey}
          onExecute={courtGroupPubkey ? (id, w) => void execute(id, w) : undefined}
        />
      ) : live.disputeEventId ? (
        <div className="dispute-status-card">
          <strong>⚖️ Court dispute open</strong>
          <div className="dispute-status-meta">
            id {live.disputeEventId.slice(0, 10)}… - waiting for the jury key to verify the verdict.
          </div>
        </div>
      ) : (
        <button type="button" className="dispute-open-btn" onClick={() => setModalOpen(true)}>
          Dispute this milestone
        </button>
      )}

      {live.error && <div className="dispute-modal-error">{live.error}</div>}
      {error && <div className="dispute-modal-error" role="alert">{error}</div>}

      {modalOpen && (
        <OpenDisputeModal
          escrowId={escrowId}
          partyAPubkey={contributorPubkey}
          partyBPubkey={founderPubkey}
          marketEventId={marketEventId}
          myPubkey={myPubkey}
          myRole={viewerRole}
          secondsSinceEscrowLock={secondsSinceEscrowLock}
          existingDispute={existing}
          signEvent={(t) => auth.signer!.signEvent(t) as never}
          sendEvent={sendEvent}
          onPublished={(id) => {
            setModalOpen(false);
            onDone?.(`Dispute published (${id.slice(0, 10)}…). The court pipeline is now running.`);
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
