/**
 * FundCampaignModal - the campaign, broken down into its milestones.
 *
 * Opened by clicking any campaign/milestone card. Shows every milestone with
 * its deliverable description, acceptance criteria, amount, lifecycle status
 * and deadline, plus per-milestone funding, the (gated) campaign room and -
 * at the bottom - the campaign-level fund action, mirroring the card button
 * ("Fund this project (testnet)") so milestones are always seen before
 * pledging.
 */
import React from 'react';
import { X } from 'lucide-react';
import { formatSats } from '../frames/FundingCampaignCard';
import { MilestoneBreakdownList } from './MilestoneBreakdownList';
import { railLabel } from '../../lib/baoFundraising';
import type { CampaignBreakdown, MilestoneRow } from './campaignBreakdown';

export function FundCampaignModal({
  campaign,
  nowSec,
  onClose,
  onFund,
  onChat,
  disputeSlot,
  releaseSlot,
  fundLabel,
}: {
  campaign: CampaignBreakdown;
  /** Injected clock (App ticks it) - never read Date.now during render. */
  nowSec: number;
  onClose: () => void;
  onFund?: (milestoneId: string) => void;
  onChat?: (id: string, title: string, roomAvailable?: boolean) => void;
  /** Donor-only: renders the court dispute surface for a milestone (the
   *  caller decides entitlement; the modal never shows it for non-donors). */
  disputeSlot?: (milestone: MilestoneRow) => React.ReactNode;
  /** Owner-only: renders the on-chain release surface per milestone. */
  releaseSlot?: (milestone: MilestoneRow) => React.ReactNode;
  /** Label for the bottom fund action; App passes the mainnet/testnet wording
   *  the card uses. Defaults to the testnet phrasing. */
  fundLabel?: string;
}): React.ReactElement {
  const now = nowSec;
  const pct = campaign.goalSats > 0 ? Math.min(100, Math.round((campaign.raisedSats / campaign.goalSats) * 100)) : 0;
  const canFund = campaign.frStatus === 'open' || campaign.frStatus === 'funded' || campaign.frStatus === undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Fund ${campaign.title}`}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border bg-[var(--np-bg)] p-5"
        style={{ borderColor: 'var(--np-rule)', boxShadow: 'var(--np-shadow)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
              {campaign.runner ?? ''}{campaign.rail ? ` · ${railLabel(campaign.rail)}` : ''}{campaign.frStatus ? ` · ${campaign.frStatus}` : ''}
            </p>
            <h2 className="mt-1 text-xl font-bold leading-snug" style={{ fontFamily: 'var(--np-font-serif)' }}>
              {campaign.title}
            </h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-black/5">
            <X size={16} style={{ color: 'var(--np-muted)' }} />
          </button>
        </div>

        {campaign.description && (
          <p className="mb-3 text-[13px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
            {campaign.description}
          </p>
        )}

        <div className="mb-1 flex items-baseline justify-between text-[11px]" style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}>
          <span>{formatSats(campaign.raisedSats)} / {formatSats(campaign.goalSats)} sats</span>
          <span>{pct}%</span>
        </div>
        <div className="mb-4 h-[3px] w-full" style={{ background: 'var(--np-rule)' }}>
          <div className="h-full" style={{ width: `${pct}%`, background: 'var(--np-accent)' }} />
        </div>

        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
          Milestones · {campaign.milestones.length}
        </h3>
        <MilestoneBreakdownList campaign={campaign} nowSec={now} onFund={onFund} disputeSlot={disputeSlot} releaseSlot={releaseSlot} canFund={canFund} />

        {onChat && campaign.frId && (
          <button
            type="button"
            onClick={() => onChat(campaign.frId as string, campaign.title, campaign.roomAvailable)}
            className="mt-4 border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em]"
            style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)', background: 'transparent' }}
          >
            Open campaign room
          </button>
        )}

        {onFund && canFund && campaign.frId && (
          <button
            type="button"
            onClick={() => onFund(campaign.frId as string)}
            className="mt-4 w-full border px-4 py-2 text-xs font-bold uppercase tracking-widest"
            style={{ borderColor: 'var(--np-rule)', background: 'var(--np-ink)', color: 'var(--np-bg)' }}
          >
            {fundLabel ?? 'Fund this project (testnet)'}
          </button>
        )}
      </div>
    </div>
  );
}
