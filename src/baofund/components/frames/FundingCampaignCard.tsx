/**
 * NewspaperMarketCard → FundingCampaignCard
 *
 * Same editorial skeleton as BAO MARKETS' newspaper market card:
 * category kicker + dot, serif headline, deck, contributions chart,
 * progress measure, market-linkage row, and milestone status.
 */
import React from 'react';
import { FundAreaChart } from './FundAreaChart';
import { stripMainnetMarker } from '../../lib/cashu/mainnetMarker';
import { railLabel } from '../../lib/baoFundraising';
import '../../theme/newspaperTheme.css';

export interface CampaignMarketDraft {
  id: string;
  question: string | null;
  status: 'unknown' | 'active' | 'resolved';
  resolution?: 'yes' | 'no' | null;
}

export interface CampaignCardDraft {
  id: string;
  title: string;
  description: string;
  category: string;
  pledgedSats: number;
  goalSats: number;
  endTimeSec: number;
  /** Cumulative daily contributions (sats). Omit when not available. */
  contributions?: number[];
  /** Milestone lifecycle status from the protocol. */
  status?: 'locked' | 'unlocked' | 'released' | 'refunded';
  /** Linked resolution market, if any (auto-created via the API→Nostr bridge). */
  market?: CampaignMarketDraft;
  /** Settlement rail label (e.g. cashu / lightning). */
  rail?: string;
  /** Runner type label (Agent / Human / Agent + Human). */
  runner?: string;
  /** True for mainnet-Cashu campaigns (real money rail). Set by the feed
   *  from the fundraiser description marker; falls back to parsing the
   *  displayed description. */
  mainnetCashu?: boolean;
  /** Optional fundraiser id for actions. */
  frId?: string;
  /** Fundraiser-level status (open/funded/completed/cancelled). */
  frStatus?: string;
  /** Founder's Nostr pubkey (hex) - enables direct nutzap delivery. */
  ownerPubkey?: string;
  /** True when `pledgedSats`/'completed' came from the registrar-signed
   *  relay ledger fold rather than the API index. */
  ledgerVerified?: boolean;
  /** Viewer-relative room availability: false hides the Chat affordance
   *  (donor-gated campaigns show their room only to contributors). Undefined
   *  = unknown (relay-discovered cards) - keep the button and let the API
   *  status check on click decide. */
  roomAvailable?: boolean;
  /** Viewer is a donor of this campaign (donor-only surfaces, e.g. dispute). */
  contributor?: boolean;
}

const CATEGORY_DOTS: Record<string, string> = {
  compute: '#c43a2f',
  attestation: '#8b5a2b',
  content: '#2f5a3a',
  infra: '#5a3a8b',
  fund: '#8b5a2b',
};

function categoryDot(cat: string): string {
  return CATEGORY_DOTS[cat] ?? 'var(--np-muted)';
}
function categoryLabel(cat: string): string {
  return (cat.charAt(0).toUpperCase() + cat.slice(1)).replace(/-/g, ' ');
}
export function formatSats(n: number): string {
  return n.toLocaleString();
}
function formatTimeLeft(endSec: number, nowSec: number): string {
  const s = Math.max(0, endSec - nowSec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, Math.floor(s / 60))}m`;
}

const STATUS_STYLE: Record<NonNullable<CampaignCardDraft['status']>, { label: string; color: string }> = {
  locked: { label: 'Locked', color: 'var(--np-muted)' },
  unlocked: { label: 'Funded', color: 'var(--np-accent-2)' },
  released: { label: 'Released', color: 'var(--np-success)' },
  refunded: { label: 'Refunded', color: 'var(--np-danger)' },
};

export const FundingCampaignCard = React.memo(function FundingCampaignCard({
  campaign,
  nowSec,
  onFund,
  onChat,
  onOpen,
  gateStrip,
}: {
  campaign: CampaignCardDraft;
  nowSec?: number;
  onFund?: (id: string) => void;
  /** Open the campaign room. The third argument is the viewer-relative room
   *  availability: `false` means this viewer has not contributed yet - the
   *  host must answer with the graceful gate (public rooms only). */
  onChat?: (id: string, title: string, roomAvailable?: boolean) => void;
  /** Open the campaign breakdown (all milestones with descriptions). */
  onOpen?: (campaign: CampaignCardDraft) => void;
  /** Registrar-verified release-gate strip (why release is blocked). Rendered
   *  only when the caller has a verified ledger fold - the card itself never
   *  projects gates for unverified money. */
  gateStrip?: { codes: readonly string[]; overflow: number; reason: string; title: string };
}) {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const pct = campaign.goalSats > 0
    ? Math.min(100, Math.round((campaign.pledgedSats / campaign.goalSats) * 100))
    : 0;
  const closed = campaign.endTimeSec < now;
  const st = campaign.status && campaign.status !== 'locked' ? STATUS_STYLE[campaign.status] : null;
  // Fail closed: only an explicit API-backed flag makes a campaign real.
  const isReal = campaign.mainnetCashu === true;

  return (
    <article
      className={`newspaper flex flex-col p-4 sm:p-5${onOpen ? ' cursor-pointer' : ''}`}
      onClick={onOpen ? () => onOpen(campaign) : undefined}
      style={{
        background: 'var(--np-paper)',
        border: '1px solid var(--np-rule)',
        boxShadow: 'var(--np-shadow)',
      }}
    >
      {/* Kicker */}
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: categoryDot(campaign.category) }}
        />
        <span
          className="text-[9px] font-bold uppercase tracking-[0.18em]"
          style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
        >
          {categoryLabel(campaign.category)}
        </span>
        {st && (
          <span
            className="ml-auto text-[9px] uppercase tracking-[0.18em]"
            style={{ color: st.color, fontFamily: 'var(--np-font-mono)' }}
          >
            {st.label}
          </span>
        )}
        {isReal && (
          <span
            className={`${st ? '' : 'ml-auto '}border px-1 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em]`}
            style={{ color: 'var(--np-success)', borderColor: 'var(--np-success)', fontFamily: 'var(--np-font-mono)' }}
          >
            REAL · CASHU
          </span>
        )}
        <span
          className={`${st || isReal ? '' : 'ml-auto '}text-[9px] uppercase tracking-[0.15em]`}
          style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
        >
          {campaign.runner ?? ''}
          {campaign.rail ? ` · ${railLabel(campaign.rail)}` : ''}
        </span>
        {closed && (
          <span
            className="text-[9px] uppercase tracking-[0.18em]"
            style={{ color: 'var(--np-danger)', fontFamily: 'var(--np-font-mono)' }}
          >
            Closed
          </span>
        )}
      </div>

      {/* Headline */}
      <h2
        className="mb-2 text-lg leading-snug font-bold sm:text-xl"
        style={{ fontFamily: 'var(--np-font-serif)', color: 'var(--np-ink)' }}
      >
        {campaign.title}
      </h2>

      {/* Deck */}
      <p className="mb-3 line-clamp-3 text-[13px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
        {stripMainnetMarker(campaign.description)}
      </p>

      {/* Contributions timeline - lightweight-charts area chart */}
      {campaign.contributions && campaign.contributions.length > 1 ? (
        <div className="mb-2">
          <FundAreaChart cumulative={campaign.contributions} />
        </div>
      ) : (
        <p
          className="mb-2 text-[10px] uppercase tracking-[0.15em]"
          style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
        >
          Contributions accrue over the milestone window
        </p>
      )}

      {/* Progress measure */}
      <div className="mt-auto">
        <div
          className="mb-1 flex items-baseline justify-between text-[11px]"
          style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}
        >
          <span className="flex items-center gap-1">
            {formatSats(campaign.pledgedSats)} / {formatSats(campaign.goalSats)} sats
            {campaign.ledgerVerified && (
              <span
                data-testid="ledger-verified-badge"
                title="Pledged total folded from registrar-signed ledger events on the fund relay"
                className="border px-1 text-[9px] uppercase tracking-widest"
                style={{ borderColor: 'var(--np-rule)', color: 'var(--np-accent, #1a7f37)' }}
              >
                ledger
              </span>
            )}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-[3px] w-full" style={{ background: 'var(--np-rule)' }}>
          <div className="h-full" style={{ width: `${pct}%`, background: 'var(--np-accent)' }} />
        </div>
        {gateStrip && (
          <div
            data-gate-strip=""
            data-gate-codes={gateStrip.codes.join(' · ') + (gateStrip.overflow > 0 ? ` +${gateStrip.overflow}` : '')}
            className="mt-2 border px-2 py-1 text-[9px] leading-snug"
            style={{ fontFamily: 'var(--np-font-mono)', borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}
            title={gateStrip.title}
          >
            <span className="font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--np-accent-2)' }}>
              {gateStrip.codes.join(' · ')}
              {gateStrip.overflow > 0 ? ` +${gateStrip.overflow}` : ''}
            </span>{' '}
            {gateStrip.reason}
          </div>
        )}

        <div
          className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.13em]"
          style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}
        >
          <span>{formatTimeLeft(campaign.endTimeSec, now)}</span>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onFund && (campaign.frStatus === undefined || campaign.frStatus === 'open' || campaign.frStatus === 'funded') && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onFund(campaign.frId ?? campaign.id); }}
                className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em]"
                style={
                  isReal
                    ? {
                        fontFamily: 'var(--np-font-mono)',
                        color: 'var(--np-on-accent)',
                        background: 'var(--np-success)',
                        border: '1px solid var(--np-success)',
                      }
                    : {
                        fontFamily: 'var(--np-font-mono)',
                        color: 'var(--np-on-accent)',
                        background: 'var(--np-accent)',
                        border: '1px solid var(--np-accent)',
                      }
                }
              >
                {isReal ? 'Fund with real Cashu' : 'Fund this project (testnet)'}
              </button>
            )}
            {onChat && campaign.frId && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onChat(campaign.frId!, campaign.title, campaign.roomAvailable); }}
                className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em]"
                style={{
                  fontFamily: 'var(--np-font-mono)',
                  color: campaign.roomAvailable === false ? 'var(--np-muted)' : 'var(--np-accent)',
                  background: 'transparent',
                  border: `1px solid ${campaign.roomAvailable === false ? 'var(--np-rule)' : 'var(--np-accent)'}`,
                }}
              >
                Chat
              </button>
            )}
            {onOpen && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpen(campaign); }}
                className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em]"
                style={{
                  fontFamily: 'var(--np-font-mono)',
                  color: 'var(--np-accent-2)',
                  background: 'transparent',
                  border: '1px solid var(--np-accent-2)',
                }}
              >
                Donate
              </button>
            )}
          </div>
          <span className="text-[10px]" style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}>
            {campaign.frStatus}
          </span>
        </div>
      </div>
    </article>
  );
});
