import { describe, it, expect } from 'vitest';

import type { BaoFundraiser } from './baoFundraising';
import {
  AGENT_BODY_TAG,
  UPKEEP_SATS_PER_DAY,
  buildAgentBodyTag,
  campaignsForPet,
  parseAgentBody,
  totalRaisedSats,
  upkeepDays,
  upkeepStatus,
  upkeepStatusForCampaigns,
} from './petFundraising';

const pk = (ch: string) => ch.repeat(64);

function fundraiser(overrides: Partial<BaoFundraiser> = {}): BaoFundraiser {
  return {
    id: overrides.id ?? 'fr_1',
    title: overrides.title ?? 'Test campaign',
    description: null,
    owner_pubkey: overrides.owner_pubkey ?? pk('a'),
    runner_type: 'agent',
    goal_sats: overrides.goal_sats ?? 10_000,
    raised_sats: overrides.raised_sats ?? 0,
    status: overrides.status ?? 'open',
    settlement_rail: 'lightning',
    network: 'signet',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('UPKEEP_SATS_PER_DAY', () => {
  it('is 1000 sats per day', () => {
    expect(UPKEEP_SATS_PER_DAY).toBe(1000);
  });
});

describe('upkeepDays', () => {
  it('floors partial days', () => {
    expect(upkeepDays(12_345)).toBe(12);
  });

  it('returns 0 for zero, negative, and non-finite input', () => {
    expect(upkeepDays(0)).toBe(0);
    expect(upkeepDays(-500)).toBe(0);
    expect(upkeepDays(Number.NaN)).toBe(0);
  });

  it('returns 0 below one day of upkeep', () => {
    expect(upkeepDays(UPKEEP_SATS_PER_DAY - 1)).toBe(0);
  });
});

describe('upkeepStatus', () => {
  it('labels a funded pet', () => {
    const s = upkeepStatus(12_000);
    expect(s).toEqual({ days: 12, label: 'funded for 12 days', funded: true });
  });

  it('singularizes one day', () => {
    expect(upkeepStatus(1_500).label).toBe('funded for 1 day');
  });

  it('labels an unfunded pet', () => {
    const s = upkeepStatus(0);
    expect(s.funded).toBe(false);
    expect(s.label).toBe('not funded — needs upkeep');
  });
});

describe('campaignsForPet', () => {
  const petKey = pk('a');
  const ownerKey = pk('b');
  const agentKey = pk('c');

  const list = [
    fundraiser({ id: 'fr_pet', owner_pubkey: petKey }),
    fundraiser({ id: 'fr_owner', owner_pubkey: ownerKey }),
    fundraiser({ id: 'fr_agent', owner_pubkey: agentKey }),
    fundraiser({ id: 'fr_other', owner_pubkey: pk('d') }),
  ];

  it('matches on pet pubkey', () => {
    expect(campaignsForPet(list, { petPubkey: petKey }).map((f) => f.id)).toEqual(['fr_pet']);
  });

  it('matches on owner pubkey', () => {
    expect(campaignsForPet(list, { ownerPubkey: ownerKey }).map((f) => f.id)).toEqual(['fr_owner']);
  });

  it('matches on agent pubkey', () => {
    expect(campaignsForPet(list, { agentPubkey: agentKey }).map((f) => f.id)).toEqual(['fr_agent']);
  });

  it('matches ANY of pet/owner/agent pubkeys', () => {
    const ids = campaignsForPet(list, { petPubkey: petKey, ownerPubkey: ownerKey, agentPubkey: agentKey })
      .map((f) => f.id);
    expect(ids).toEqual(['fr_pet', 'fr_owner', 'fr_agent']);
  });

  it('is case-insensitive on pubkeys', () => {
    const upper = fundraiser({ id: 'fr_upper', owner_pubkey: pk('A') });
    expect(campaignsForPet([upper], { petPubkey: petKey }).map((f) => f.id)).toEqual(['fr_upper']);
  });

  it('returns nothing when the identity is empty', () => {
    expect(campaignsForPet(list, {})).toEqual([]);
  });
});

describe('totalRaisedSats / upkeepStatusForCampaigns', () => {
  it('sums raised sats across campaigns', () => {
    const campaigns = [
      fundraiser({ id: 'a', raised_sats: 7_000 }),
      fundraiser({ id: 'b', raised_sats: 5_000 }),
    ];
    expect(totalRaisedSats(campaigns)).toBe(12_000);
    expect(upkeepStatusForCampaigns(campaigns).label).toBe('funded for 12 days');
  });

  it('handles an empty list', () => {
    expect(totalRaisedSats([])).toBe(0);
    expect(upkeepStatusForCampaigns([]).funded).toBe(false);
  });
});

describe('agent-body tag convention', () => {
  it('builds a valid tag', () => {
    expect(buildAgentBodyTag(pk('e'))).toEqual([AGENT_BODY_TAG, pk('e')]);
  });

  it('lowercases the pubkey', () => {
    expect(buildAgentBodyTag(pk('E'))).toEqual([AGENT_BODY_TAG, pk('e')]);
  });

  it('rejects malformed pubkeys', () => {
    expect(() => buildAgentBodyTag('not-a-pubkey')).toThrow();
    expect(() => buildAgentBodyTag(pk('e').slice(0, 63))).toThrow();
  });

  it('parses the agent pubkey from an event', () => {
    const event = { tags: [['d', '2140pets-abc'], buildAgentBodyTag(pk('f'))] };
    expect(parseAgentBody(event)).toBe(pk('f'));
  });

  it('returns undefined when no agent tag exists', () => {
    expect(parseAgentBody({ tags: [['d', '2140pets-abc']] })).toBeUndefined();
  });

  it('ignores malformed agent tags and takes the first valid one', () => {
    const event = {
      tags: [
        [AGENT_BODY_TAG, 'garbage'],
        [AGENT_BODY_TAG, pk('1')],
        [AGENT_BODY_TAG, pk('2')],
      ],
    };
    expect(parseAgentBody(event)).toBe(pk('1'));
  });
});
