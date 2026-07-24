import { describe, it, expect } from 'vitest';

import { apiMarketToBaoMarket, type ApiMarket } from './baoMarketApi';

const baseApiMarket: ApiMarket = {
  id: 'baofund-fr_abc-0',
  title: 'Will Oracle dashboard deliver: prototype live by Jan 1?',
  description: 'Milestone market',
  category: 'BAO-FUND',
  type: 'binary',
  status: 'ACTIVE',
  network: 'demo',
  created_at: 1_700_000_000,
  end_date: 1_800_000_000,
  outcomes: [
    { id: 'YES', label: 'Yes', price: 0.62, volume: 100 },
    { id: 'NO', label: 'No', price: 0.38, volume: 50 },
  ],
  total_volume: 150,
  trade_count: 3,
  creator_pubkey: 'd'.repeat(64),
};

describe('apiMarketToBaoMarket', () => {
  it('maps API fields to BaoMarket (parity with the old inline mapper)', () => {
    const m = apiMarketToBaoMarket(baseApiMarket);
    expect(m.marketId).toBe(baseApiMarket.id);
    expect(m.title).toBe(baseApiMarket.title);
    expect(m.category).toBe('bao-fund');
    expect(m.state).toBe('active');
    expect(m.type).toBe('binary');
    expect(m.endTime).toBe(baseApiMarket.end_date);
    expect(m.createdAt).toBe(baseApiMarket.created_at);
    expect(m.creatorPubkey).toBe(baseApiMarket.creator_pubkey);
    expect(m.outcomes).toEqual([
      { id: 'YES', label: 'Yes', probability: 0.62 },
      { id: 'NO', label: 'No', probability: 0.38 },
    ]);
    expect(m.resolution).toBeNull();
    // Without a nostr_event_id the raw event id falls back to the market id.
    expect(m.rawEvent.id).toBe(baseApiMarket.id);
  });

  it('prefers nostr_event_id for the raw event id and carries resolution', () => {
    const m = apiMarketToBaoMarket({
      ...baseApiMarket,
      nostr_event_id: 'e'.repeat(64),
      status: 'RESOLVED',
      resolution: 'YES',
    });
    expect(m.rawEvent.id).toBe('e'.repeat(64));
    expect(m.state).toBe('resolved');
    expect(m.resolution).toBe('YES');
  });

  it('coerces non-finite prices to 0.5 and unknown types to binary', () => {
    const m = apiMarketToBaoMarket({
      ...baseApiMarket,
      type: 'weird',
      outcomes: [{ id: 'X', label: 'X', price: Number.NaN, volume: 0 }],
    });
    expect(m.type).toBe('binary');
    expect(m.outcomes[0].probability).toBe(0.5);
  });
});
