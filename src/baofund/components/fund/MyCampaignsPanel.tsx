/**
 * MyCampaignsPanel - the founder's management dashboard.
 *
 * Every campaign owned by the signed-in identity, grouped from the feed's
 * milestone cards into one row per campaign: funding progress, milestone
 * lifecycle, room availability, and the management actions (Manage → the
 * milestone breakdown with the owner-only release controls; Chat → the
 * campaign room; Ledger → the contributions book).
 */
import React from 'react';
import { formatSats, type CampaignCardDraft } from '../frames/FundingCampaignCard';
import { railLabel } from '../../lib/baoFundraising';
import '../../theme/newspaperTheme.css';

export interface OwnedCampaignRow {
  key: string;
  frId?: string;
  title: string;
  description: string;
  pledgedSats: number;
  goalSats: number;
  milestones: number;
  fundedMilestones: number;
  status?: string;
  rail?: string;
  roomAvailable?: boolean;
  ownerPubkey?: string;
}

/**
 * Group the feed's cards into one row per campaign owned by `pubkey`.
 * Milestone cards share the campaign's frId; a campaign-level card (stream
 * format, or an unexpanded fundraiser) carries the authoritative totals and
 * wins over summing its milestones. Pure - exported for tests.
 */
export function ownedCampaignRows(cards: CampaignCardDraft[], pubkey?: string | null): OwnedCampaignRow[] {
  if (!pubkey) return [];
  const owner = pubkey.toLowerCase();
  const mine = cards.filter((c) => c.ownerPubkey?.toLowerCase() === owner);
  const byKey = new Map<string, CampaignCardDraft[]>();
  for (const c of mine) {
    const key = c.frId ?? c.id.split('::')[0];
    const list = byKey.get(key);
    if (list) list.push(c);
    else byKey.set(key, [c]);
  }
  return [...byKey.entries()].map(([key, group]) => {
    const first = group[0];
    // A campaign-level card has no milestone suffix (id === key / no `::`).
    const campaignLevel = group.find((c) => !c.id.includes('::'));
    const milestoneCards = group.filter((c) => c.id.includes('::'));
    const pledgedSats = campaignLevel
      ? campaignLevel.pledgedSats
      : group.reduce((sum, c) => sum + (c.pledgedSats || 0), 0);
    const goalSats = campaignLevel
      ? campaignLevel.goalSats
      : group.reduce((sum, c) => sum + (c.goalSats || 0), 0);
    const title = first.title.includes(' - Milestone')
      ? first.title.replace(/ - Milestone.*$/, '')
      : first.title;
    return {
      key,
      ...(first.frId ? { frId: first.frId } : {}),
      title,
      description: first.description,
      pledgedSats,
      goalSats,
      milestones: milestoneCards.length,
      fundedMilestones: group.filter((c) => c.status === 'unlocked' || c.status === 'released').length,
      ...(campaignLevel?.frStatus ?? first.frStatus ? { status: campaignLevel?.frStatus ?? first.frStatus } : {}),
      ...(first.rail ? { rail: first.rail } : {}),
      ...(first.roomAvailable !== undefined ? { roomAvailable: first.roomAvailable } : {}),
      ...(first.ownerPubkey ? { ownerPubkey: first.ownerPubkey } : {}),
    };
  });
}

export function MyCampaignsPanel({
  cards,
  pubkey,
  onCreate,
  onManage,
  onChat,
  onLedger,
}: {
  cards: CampaignCardDraft[];
  /** Signed-in identity; null = signed out (panel shows the sign-in hint). */
  pubkey?: string | null;
  onCreate: () => void;
  onManage: (row: OwnedCampaignRow) => void;
  onChat: (row: OwnedCampaignRow) => void;
  onLedger: () => void;
}): React.ReactElement {
  const rows = ownedCampaignRows(cards, pubkey);

  if (!pubkey) {
    return (
      <section data-testid="my-campaigns" className="py-8 text-center">
        <p className="text-sm" style={{ color: 'var(--np-muted)' }}>
          Sign in to manage your campaigns.
        </p>
      </section>
    );
  }

  return (
    <section data-testid="my-campaigns">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--np-font-serif)', color: 'var(--np-ink)' }}>
          My campaigns
        </h2>
        <button
          type="button"
          onClick={onCreate}
          className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em]"
          style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-on-accent)', background: 'var(--np-accent)', border: '1px solid var(--np-accent)' }}
        >
          + New campaign
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="border p-6 text-center" style={{ borderColor: 'var(--np-rule)', background: 'var(--np-paper)' }}>
          <p className="mb-3 text-sm" style={{ color: 'var(--np-muted)' }}>
            No campaigns owned by this identity yet.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest"
            style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-on-accent)', background: 'var(--np-accent)', border: '1px solid var(--np-accent)' }}
          >
            Create your first campaign
          </button>
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => {
            const pct = row.goalSats > 0 ? Math.min(100, Math.round((row.pledgedSats / row.goalSats) * 100)) : 0;
            return (
              <li
                key={row.key}
                data-testid="my-campaign-row"
                className="border p-4"
                style={{ borderColor: 'var(--np-rule)', background: 'var(--np-paper)', boxShadow: 'var(--np-shadow)' }}
              >
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <h3 className="text-base font-bold leading-snug" style={{ fontFamily: 'var(--np-font-serif)', color: 'var(--np-ink)' }}>
                    {row.title}
                  </h3>
                  <span className="shrink-0 text-[9px] uppercase tracking-[0.15em]" style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}>
                    {row.status ?? 'open'}{row.rail ? ` · ${railLabel(row.rail)}` : ''}
                  </span>
                </div>

                <div className="mb-1 flex items-baseline justify-between text-[11px]" style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}>
                  <span>
                    {formatSats(row.pledgedSats)} / {formatSats(row.goalSats)} sats
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="h-[3px] w-full" style={{ background: 'var(--np-rule)' }}>
                  <div className="h-full" style={{ width: `${pct}%`, background: 'var(--np-accent)' }} />
                </div>
                <p className="mt-1 text-[10px]" style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}>
                  {row.fundedMilestones}/{row.milestones} milestone{row.milestones === 1 ? '' : 's'} funded
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onManage(row)}
                    className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em]"
                    style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-on-accent)', background: 'var(--np-ink)', border: '1px solid var(--np-ink)' }}
                  >
                    Manage
                  </button>
                  {row.frId && (
                    <button
                      type="button"
                      onClick={() => onChat(row)}
                      className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em]"
                      style={{
                        fontFamily: 'var(--np-font-mono)',
                        color: row.roomAvailable === false ? 'var(--np-muted)' : 'var(--np-accent)',
                        background: 'transparent',
                        border: `1px solid ${row.roomAvailable === false ? 'var(--np-rule)' : 'var(--np-accent)'}`,
                      }}
                    >
                      Chat
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onLedger}
                    className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em]"
                    style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-accent-2)', background: 'transparent', border: '1px solid var(--np-accent-2)' }}
                  >
                    Ledger
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
