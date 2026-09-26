/**
 * MilestoneBreakdownList - one campaign's milestones, rendered identically by
 * the breakdown modal (card click) and by the pledges modal's milestones-first
 * step. Keeps status colors, acceptance criteria, deadline and the optional
 * per-milestone fund button in one place.
 */
import React from 'react';
import { formatSats } from '../frames/FundingCampaignCard';
import type { CampaignBreakdown, MilestoneRow } from './campaignBreakdown';

const STATUS: Record<string, { label: string; color: string }> = {
  locked: { label: 'Awaiting funds', color: 'var(--np-muted)' },
  unlocked: { label: 'Funded', color: 'var(--np-accent-2)' },
  released: { label: 'Released', color: 'var(--np-success)' },
  refunded: { label: 'Refunded', color: 'var(--np-danger)' },
};

function formatDeadline(sec: number | null | undefined, now: number | null): string {
  if (!sec || now === null) return '-';
  const left = sec - now;
  if (left <= 0) return 'passed';
  const days = Math.floor(left / 86_400);
  const hours = Math.floor((left % 86_400) / 3_600);
  return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
}

export function MilestoneBreakdownList({
  campaign,
  nowSec,
  onFund,
  disputeSlot,
  releaseSlot,
  canFund,
}: {
  campaign: CampaignBreakdown;
  /** Injected clock; null hides deadlines (no Date.now during render). */
  nowSec: number | null;
  onFund?: (milestoneId: string) => void;
  disputeSlot?: (milestone: MilestoneRow) => React.ReactNode;
  /** Owner-only: renders the on-chain release surface for a milestone. */
  releaseSlot?: (milestone: MilestoneRow) => React.ReactNode;
  /** When false, per-milestone fund buttons are hidden regardless of onFund. */
  canFund?: boolean;
}): React.ReactElement {
  const fundable = canFund ?? (campaign.frStatus === 'open' || campaign.frStatus === 'funded' || campaign.frStatus === undefined);
  return (
    <ol className="space-y-3" data-testid="milestone-breakdown">
      {campaign.milestones.map((m, i) => {
        const st = m.status ? STATUS[m.status] : null;
        return (
          <li key={m.id} className="border p-3" style={{ borderColor: 'var(--np-rule)' }}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
                {i + 1}. {m.title}
              </span>
              <span className="shrink-0 text-[10px]" style={{ color: st?.color ?? 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
                {st?.label ?? ''}
              </span>
            </div>
            {m.description && (
              <p className="mb-1 text-[12px] leading-relaxed" style={{ color: 'var(--np-ink)' }}>{m.description}</p>
            )}
            {m.criteria && m.criteria !== m.description && (
              <p className="mb-1 text-[11px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
                <span className="uppercase tracking-widest">Acceptance · </span>{m.criteria}
              </p>
            )}
            <div className="mt-1 flex items-center justify-between text-[10px]" style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}>
              <span>{formatSats(m.amountSats)} sats{m.pledgedSats !== undefined ? ` · ${formatSats(Math.min(m.pledgedSats, m.amountSats))} pledged` : ''}</span>
              <span>{formatDeadline(m.deadlineAt, nowSec)}</span>
            </div>
            {disputeSlot && campaign.isContributor && (
              <div className="mt-2">
                {disputeSlot(m)}
              </div>
            )}
            {releaseSlot?.(m)}
            {onFund && fundable && campaign.frId && (
              <button
                type="button"
                onClick={() => campaign.frId && onFund(campaign.frId)}
                title="The campaign escrow is one pot that fills milestones in order; a pledge is not milestone-targeted server-side."
                className="mt-2 border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em]"
                style={{ borderColor: 'var(--np-accent)', color: 'var(--np-accent)', background: 'transparent' }}
              >
                Fund this project
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
