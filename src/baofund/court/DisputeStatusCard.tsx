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
  onExecute,
}: {
  status: DisputeStatusView;
  now: number;
  /** The viewing user's pubkey - drives role copy + winner affordance. */
  myPubkey: string | null;
  /** S3 affordance: call the release route with the attestation. Absent = hide. */
  onExecute?: (attestationEventId: string, winnerPubkey: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { dispute, phases, canStillResolveInTime, terminal } = status;

  const current = phases.find((p) => now >= p.startsAt && now < p.endsAt) ?? null;
  const next = phases.find((p) => p.startsAt > now) ?? null;
  const doneCount = phases.filter((p) => p.endsAt <= now).length;
  const phaseList = phases.filter((p) => p.phase !== 'refund');
  const role = dispute.challengerPubkey === myPubkey?.toLowerCase() ? 'challenger' : 'respondent';

  return (
    <div className="dispute-status-card" data-dispute={dispute.disputeId.slice(0, 12)}>
      <div className="dispute-status-head">
        <strong>⚖️ Court dispute open</strong>
        <span className="dispute-status-id">id {dispute.disputeId.slice(0, 10)}…</span>
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
          {myPubkey ? ` ${refundRaceCopy(role === 'challenger' ? 'donor' : 'founder')}` : ''}
        </div>
      )}

      {/* Terminal states */}
      {terminal.kind === 'invalid_attestation' && (
        <div className="dispute-status-invalid" role="alert">
          ⚠️ An attestation was seen but FAILED verification ({terminal.error}) - it is evidence of an invalid claim, not a verdict.
        </div>
      )}
      {terminal.kind === 'verdict' && (
        <div className="dispute-status-verdict">
          ✅ Court verdict verified: winner <code>{terminal.winnerPubkey.slice(0, 12)}…</code>
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
        opened {fmt(Math.max(0, now - dispute.openedAt))} ago · by {dispute.author.slice(0, 10)}… · proposed winner {dispute.proposedOutcome.slice(0, 10)}…
      </div>
    </div>
  );
}
