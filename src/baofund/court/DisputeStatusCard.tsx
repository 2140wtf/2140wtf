/**
 * DisputeStatusCard - S2 (COURT-GUI-WIRING-DESIGN.md §2).
 *
 * Progressive disclosure (round-3): current phase + next deadline + progress
 * dots up front; the full 8-phase timeline behind an expander. Verdict text
 * appears ONLY from the fold's verified terminal - a failed attestation shows
 * as evidence problems, never as a verdict. "Execute verdict" is disabled
 * until the caller passes an onExecute AND the fold produced a verified
 * verdict (round-2 fail-closed transport).
 */
import React, { useState } from 'react';
import type { DisputeStatusView } from '../lib/court/disputeStatus';
import { refundRaceCopy } from '../lib/court/disputeStatus';

const PHASE_LABELS: Record<string, string> = {
  dispute: 'Dispute window',
  'opt-in': 'Juror opt-in',
  selection: 'Jury selection',
  dkg: 'Key ceremony',
  'vote-commit': 'Vote commit',
  'vote-reveal': 'Vote reveal',
  signing: 'FROST signing',
  claim: 'Claim window',
  refund: 'Refund race',
};

function fmt(secs: number): string {
  if (secs <= 0) return 'now';
  if (secs < 90) return `${Math.round(secs)}s`;
  if (secs < 5400) return `${Math.round(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

export function DisputeStatusCard({
  status,
  now,
  myPubkey,
  viewerRole,
  onExecute,
}: {
  status: DisputeStatusView;
  now: number;
  /** The viewing user's pubkey - drives role copy + winner affordance. */
  myPubkey: string | null;
  /** The viewer's escrow side. NEVER infer it from the challenger: BOTH
   *  parties can open a dispute, so a founder-filed dispute would otherwise
   *  render donor refund copy (audit). */
  viewerRole: 'donor' | 'founder';
  /** S3 affordance: call the release route with the attestation. Absent = hide. */
  onExecute?: (attestationEventId: string, winnerPubkey: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { dispute, phases, canStillResolveInTime, terminal } = status;

  const current = phases.find((p) => now >= p.startsAt && now < p.endsAt) ?? null;
  const next = phases.find((p) => p.startsAt > now) ?? null;
  const doneCount = phases.filter((p) => p.endsAt <= now).length;
  const phaseList = phases.filter((p) => p.phase !== 'refund');
  // Parties read as words, never as 64-hex ids (owner rule): the viewer is
  // one of the two escrow parties, so every other party is the counterparty.
  const partyLabel = (pubkey: string | null | undefined): string => {
    if (!pubkey) return 'a party';
    if (!myPubkey) return 'a party';
    return pubkey.toLowerCase() === myPubkey.toLowerCase() ? 'you' : 'the counterparty';
  };
  const winnerIsMe = Boolean(
    terminal.kind === 'verdict' && myPubkey && terminal.winnerPubkey.toLowerCase() === myPubkey.toLowerCase(),
  );

  return (
    <div className="dispute-status-card" data-dispute={dispute.disputeId.slice(0, 12)} title={`Dispute ${dispute.disputeId}`}>
      <div className="dispute-status-head">
        <strong>⚖️ Court dispute open</strong>
      </div>

      {/* Phase summary (round-3: no deadline soup) */}
      <div className="dispute-status-phase">
        {current ? (
          <>
            <span>Phase: {PHASE_LABELS[current.phase] ?? current.phase}</span>
            <span> · next: {next ? `${PHASE_LABELS[next.phase] ?? next.phase} in ${fmt(next.startsAt - now)}` : 'final phase'}</span>
            <span className="dispute-status-dots" aria-label={`${doneCount} of ${phaseList.length} phases done`}>
              {phaseList.map((p) => (
                <span key={p.phase} className={p.endsAt <= now ? 'dot done' : p === current ? 'dot cur' : 'dot'} />
              ))}
            </span>
          </>
        ) : (
          <span>All phases complete - verdict {terminal.kind === 'verdict' ? 'reached' : 'pending'}</span>
        )}
      </div>

      {/* Refund-race honesty (round-3: role-specific) */}
      {!canStillResolveInTime && terminal.kind === 'active' && (
        <div className="dispute-status-race" role="alert">
          ⏱ A court verdict can no longer arrive before the refund locktime.
          {myPubkey ? ` ${refundRaceCopy(viewerRole)}` : ''}
        </div>
      )}

      {/* Terminal states */}
      {terminal.kind === 'invalid_attestation' && (
        <div className="dispute-status-invalid" role="alert">
          ⚠️ An attestation was seen but FAILED verification ({terminal.error}) - it is evidence of an invalid claim, not a verdict.
        </div>
      )}
      {terminal.kind === 'verdict' && (
        <div className="dispute-status-verdict" title={`winner ${terminal.winnerPubkey}`}>
          ✅ Court verdict verified: winner {winnerIsMe ? 'you' : 'the counterparty'}
          {onExecute && myPubkey && terminal.winnerPubkey.toLowerCase() === myPubkey.toLowerCase() && (
            <button
              type="button"
              className="dispute-execute"
              onClick={() => onExecute(terminal.attestationEventId, terminal.winnerPubkey)}
            >
              Execute verdict
            </button>
          )}
        </div>
      )}

      {/* Full timeline behind an expander (round-3) */}
      <button type="button" className="dispute-status-toggle" onClick={() => setExpanded((v) => !v)}>
        {expanded ? '▾ Hide' : '▸ Show'} full timeline ({phaseList.length} phases)
      </button>
      {expanded && (
        <ol className="dispute-status-timeline">
          {phaseList.map((p) => (
            <li key={p.phase} className={p.endsAt <= now ? 'done' : p === current ? 'cur' : ''}>
              <span>{PHASE_LABELS[p.phase] ?? p.phase}</span>
              <span>{p.endsAt <= now ? 'done' : `${fmt(p.startsAt - now)} → ${fmt(p.endsAt - now)}`}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="dispute-status-meta">
        opened {fmt(Math.max(0, now - dispute.openedAt))} ago · filed by {partyLabel(dispute.author)} · proposed winner {partyLabel(dispute.proposedOutcome)}
      </div>
    </div>
  );
}
