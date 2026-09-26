/**
 * Campaign breakdown - one fundraiser broken down into its milestones for
 * the details view. Two sources:
 *   - relay/API feed drafts (milestone cards already carry deliverable copy);
 *   - the API detail (richer: separate criteria + deadline per milestone).
 */
import type { BaoFundraiser, BaoMilestone } from '../../lib/baoFundraising';
import type { CampaignCardDraft } from '../frames/FundingCampaignCard';

export type BreakdownStatus = 'locked' | 'unlocked' | 'released' | 'refunded';

export interface MilestoneRow {
  id: string;
  title: string;
  description: string;
  criteria?: string | null;
  amountSats: number;
  pledgedSats?: number;
  status?: BreakdownStatus;
  deadlineAt?: number | null;
  /** Linked resolution market (dispute surface). */
  marketId?: string | null;
}

export interface CampaignBreakdown {
  key: string;
  frId?: string;
  title: string;
  description: string;
  goalSats: number;
  raisedSats: number;
  runner?: string;
  rail?: string;
  /** Settlement network ('testnet' | 'mainnet' | 'demo') when the API detail
   *  supplied it - the mainnet-Cashu detection for pledges uses this before
   *  falling back to the description marker. */
  network?: string;
  frStatus?: string;
  roomAvailable?: boolean;
  /** Founder pubkey (dispute party B). */
  ownerPubkey?: string;
  /** Viewer has contributed to this campaign - the ONLY role allowed to
   *  open a dispute (donor-only, per owner decision). */
  isContributor?: boolean;
  milestones: MilestoneRow[];
}

/** Group milestone cards of one campaign. `key` is the frId for live cards
 *  or the relay card id prefix for relay-only cards. */
export function breakdownFromDrafts(cards: CampaignCardDraft[], key: string): CampaignBreakdown | null {
  const mine = cards.filter((c) => (c.frId ?? c.id.split('::')[0]) === key);
  if (mine.length === 0) return null;
  const first = mine[0];
  const goalSats = mine.reduce((sum, c) => sum + (c.goalSats || 0), 0);
  const raisedSats = mine.reduce((sum, c) => sum + (c.pledgedSats || 0), 0);
  return {
    key,
    ...(first.frId ? { frId: first.frId } : {}),
    title: campaignTitle(first, mine.length),
    description: first.description,
    goalSats: first.goalSats >= goalSats || mine.length === 1 ? first.goalSats : goalSats,
    raisedSats: first.frStatus ? first.pledgedSats : raisedSats,
    runner: first.runner,
    rail: first.rail,
    frStatus: first.frStatus,
    roomAvailable: first.roomAvailable,
    ownerPubkey: first.ownerPubkey,
    isContributor: first.contributor,
    milestones: mine.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      amountSats: c.goalSats,
      pledgedSats: c.pledgedSats,
      status: c.status,
      deadlineAt: c.endTimeSec,
      marketId: c.market?.id ?? null,
    })),
  };
}

function campaignTitle(first: CampaignCardDraft, count: number): string {
  if (count <= 1) return first.title;
  // Milestone cards are titled with the deliverable; the campaign name is the
  // card group's shared title only when a campaign-level card exists.
  return first.title.includes(' - Milestone') ? first.title.replace(/ - Milestone.*$/, '') : first.title;
}

/** Breakdown straight from the API detail (per-milestone criteria included). */
export function breakdownFromApi(fr: BaoFundraiser, milestones: BaoMilestone[]): CampaignBreakdown {
  return {
    key: fr.id,
    frId: fr.id,
    title: fr.title,
    description: fr.description ?? '',
    goalSats: fr.goal_sats,
    raisedSats: fr.raised_sats,
    runner: fr.runner_type === 'agent' ? 'Agent' : fr.runner_type === 'agent_human' ? 'Agent + Human' : 'Human',
    rail: fr.settlement_rail,
    network: fr.network,
    frStatus: fr.status,
    roomAvailable: fr.chat_room_available,
    ownerPubkey: fr.owner_pubkey,
    isContributor: fr.is_contributor,
    milestones: [...milestones]
      .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
      .map((m) => ({
        id: m.id,
        title: m.title || m.question || `Milestone ${(m.idx ?? 0) + 1}`,
        description: m.description || m.criteria || '',
        criteria: m.criteria ?? null,
        amountSats: Number(m.amount_sats ?? 0),
        ...(typeof m.escrow_amount_sats === 'number' ? { pledgedSats: Number(m.escrow_amount_sats) } : {}),
        status: m.status,
        deadlineAt: typeof m.deadline_at === 'number' ? m.deadline_at : null,
        marketId: m.market_id ?? null,
      })),
  };
}
