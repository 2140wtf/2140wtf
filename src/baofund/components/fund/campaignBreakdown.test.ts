import { describe, expect, it } from 'vitest';
import type { CampaignCardDraft } from '../frames/FundingCampaignCard';
import type { BaoFundraiser, BaoMilestone } from '../../lib/baoFundraising';
import { breakdownFromApi, breakdownFromDrafts } from './campaignBreakdown';

const draft = (over: Partial<CampaignCardDraft>): CampaignCardDraft => ({
  id: 'c1', title: 'T', description: 'D', category: 'agents', pledgedSats: 0, goalSats: 1000, endTimeSec: 0, ...over,
});

describe('breakdownFromDrafts', () => {
  it('groups milestone cards of one campaign and sums goal/raised', () => {
    const cards = [
      draft({ id: 'fr_1::m1', frId: 'fr_1', title: 'Rack A', description: 'Deliverable A', goalSats: 60_000, pledgedSats: 25_000, status: 'unlocked', endTimeSec: 111 }),
      draft({ id: 'fr_1::m2', frId: 'fr_1', title: 'Rack B', description: 'Deliverable B', goalSats: 90_000, pledgedSats: 10_000, status: 'locked', endTimeSec: 222 }),
      draft({ id: 'fr_2::m1', frId: 'fr_2', title: 'Other', goalSats: 5, pledgedSats: 5 }),
    ];
    const b = breakdownFromDrafts(cards, 'fr_1');
    expect(b?.frId).toBe('fr_1');
    expect(b?.milestones).toHaveLength(2);
    expect(b?.raisedSats).toBe(35_000);
    expect(b?.milestones[0]).toMatchObject({ title: 'Rack A', description: 'Deliverable A', amountSats: 60_000, status: 'unlocked', deadlineAt: 111 });
  });

  it('returns null for an unknown campaign key', () => {
    expect(breakdownFromDrafts([draft({ id: 's1::m1' })], 'nope')).toBeNull();
  });
});

describe('breakdownFromApi', () => {
  const fr = {
    id: 'fr_1', title: 'Agent Memory Vault', description: 'campaign', owner_pubkey: 'ab'.repeat(32),
    runner_type: 'agent_human', goal_sats: 600_000, raised_sats: 150_000, status: 'open', settlement_rail: 'cashu',
    network: 'testnet', created_at: '2026-01-01',
  } as unknown as BaoFundraiser;
  const ms = (over: Partial<BaoMilestone>): BaoMilestone =>
    ({ id: 'm', fundraiser_id: 'fr_1', idx: 0, title: '', description: null, amount_sats: 1, status: 'locked', unlocked_at: null, released_at: null, payout_reference: null, ...over }) as BaoMilestone;

  it('sorts by index and prefers the milestone title over the market question', () => {
    const b = breakdownFromApi(fr, [
      ms({ id: 'm2', idx: 1, title: 'Second', criteria: 'crit-2', amount_sats: 200_000, question: 'Will X deliver?' }),
      ms({ id: 'm1', idx: 0, title: '', question: 'Will Y deliver?', description: 'first deliverable', amount_sats: 150_000 }),
    ]);
    expect(b.milestones.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(b.milestones[0].title).toBe('Will Y deliver?');
    expect(b.milestones[1]).toMatchObject({ title: 'Second', criteria: 'crit-2' });
    expect(b.runner).toBe('Agent + Human');
    expect(b.rail).toBe('cashu');
  });
});
