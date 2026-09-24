import { describe, expect, it, vi } from 'vitest';
import type { BaoFundraiser } from '../lib/baoFundraising';
import type { CampaignCardDraft } from '../components/frames/FundingCampaignCard';
import type { LedgerSummary } from './ledgerFeed';
import {
  mergeEnrichedCards,
  fundraiserCard,
  enrichRelayCards,
  uniqueCampaignsForEnrichment,
  gateViewsForCards,
} from './fundFeed';

const card = (over: Partial<CampaignCardDraft> = {}): CampaignCardDraft => ({
  id: 'c1',
  title: 'Solar Coop',
  description: 'd',
  category: 'fund',
  pledgedSats: 0,
  goalSats: 1000,
  endTimeSec: 0,
  ...over,
});

const summary = (over: Partial<LedgerSummary> = {}): LedgerSummary => ({
  raisedSats: 0,
  entriesCount: 0,
  headHash: 'a'.repeat(64),
  closed: false,
  ...over,
});

const api = (over: Partial<BaoFundraiser> = {}): BaoFundraiser =>
  ({
    id: 'fr_1',
    title: 'Solar Coop',
    owner_pubkey: 'ab'.repeat(32),
    runner_type: 'agent',
    goal_sats: 2000,
    raised_sats: 0,
    status: 'open',
    settlement_rail: 'lightning',
    ...over,
  }) as BaoFundraiser;

const ledgerOf = (entries: Array<[string, LedgerSummary]>) => new Map(entries);

import { milestoneCard } from './fundFeed';
import type { BaoMilestone } from '../lib/baoFundraising';

describe('milestoneCard mapping', () => {
  const fr = (over: Record<string, unknown> = {}) =>
    ({
      id: 'fr_1', title: 'Bench', description: 'campaign desc', owner_pubkey: 'ab'.repeat(32),
      runner_type: 'human', goal_sats: 1000, raised_sats: 0, status: 'open', settlement_rail: 'lightning',
      network: 'testnet', created_at: '2026-01-01', chat_room_available: true, ...over,
    }) as unknown as Parameters<typeof milestoneCard>[0];
  const ms = (over: Record<string, unknown> = {}) =>
    ({
      id: 'm1', fundraiser_id: 'fr_1', idx: 0, title: 'Bench rig + harness', description: 'Rig assembled and harness published.',
      amount_sats: 15_000, status: 'locked', unlocked_at: null, released_at: null, payout_reference: null,
      market_id: 'mk_1', question: 'Will Bench deliver: Rig assembled and harness published. by the stated deadline?',
      criteria: 'Rig assembled and harness published.', ...over,
    }) as unknown as BaoMilestone;

  it('titles the card with the milestone deliverable, never the market question', () => {
    const card = milestoneCard(fr(), ms());
    expect(card.title).toBe('Bench rig + harness');
    expect(card.description).toBe('Rig assembled and harness published.');
    expect(card.market?.question).toContain('Will Bench deliver');
  });

  it('falls back to the market question only when the milestone has no title', () => {
    const card = milestoneCard(fr(), ms({ title: '' }));
    expect(card.title).toContain('Will Bench deliver');
  });
});

describe('mergeEnrichedCards display semantics', () => {
  it('shows the live API raised total over a stale ledger snapshot, keeping ledger verification', () => {
    const merged = mergeEnrichedCards(
      [card({ frId: 'fr_1', pledgedSats: 0 })],
      ledgerOf([['c1', summary({ raisedSats: 1000, entriesCount: 1 })]]),
      new Map([['c1', api({ raised_sats: 151_000 })]]),
    );
    expect(merged[0].pledgedSats).toBe(151_000);
    expect(merged[0].ledgerVerified).toBe(true);
  });

  it('falls back to the registrar ledger total when the API detail is missing (offline)', () => {
    const merged = mergeEnrichedCards(
      [card({ frId: 'fr_1' })],
      ledgerOf([['c1', summary({ raisedSats: 1000 })]]),
      new Map(),
    );
    expect(merged[0].pledgedSats).toBe(1000);
    expect(merged[0].ledgerVerified).toBe(true);
    expect(merged[0].frStatus).toBe(undefined);
  });

  it('falls back to the relay value when both the API detail and the ledger summary are missing', () => {
    const base = card({ frId: 'fr_1', pledgedSats: 7 });
    const merged = mergeEnrichedCards([base], new Map(), new Map());
    expect(merged[0]).toEqual(base);
    expect(merged[0].pledgedSats).toBe(7);
    expect(merged[0].ledgerVerified).toBeUndefined();
  });

  it('falls back to the ledger total when the API raised_sats is shape-drifted', () => {
    const merged = mergeEnrichedCards(
      [card({ frId: 'fr_1' })],
      ledgerOf([['c1', summary({ raisedSats: 500 })]]),
      new Map([['c1', api({ raised_sats: Number.NaN })]]),
    );
    expect(merged[0].pledgedSats).toBe(500);
  });

  it('keeps the closed ledger frStatus completed even when the API reports open', () => {
    const merged = mergeEnrichedCards(
      [card({ frId: 'fr_1' })],
      ledgerOf([['c1', summary({ raisedSats: 5000, closed: true })]]),
      new Map([['c1', api({ raised_sats: 100, status: 'open' })]]),
    );
    expect(merged[0].pledgedSats).toBe(100);
    expect(merged[0].frStatus).toBe('completed');
  });

  it('uses API status while the ledger chain is open', () => {
    const merged = mergeEnrichedCards(
      [card({ frId: 'fr_1' })],
      ledgerOf([['c1', summary({ raisedSats: 500, closed: false })]]),
      new Map([['c1', api({ raised_sats: 999, status: 'funded' })]]),
    );
    expect(merged[0].pledgedSats).toBe(999);
    expect(merged[0].frStatus).toBe('funded');
  });

  it('fills presentation fields from the API when no ledger summary exists', () => {
    const now = Math.floor(Date.now() / 1000);
    const merged = mergeEnrichedCards(
      [card({ frId: 'fr_1', goalSats: 1000 })],
      new Map(),
      new Map([['c1', api({ raised_sats: 777, stream_end_at: now + 3600 })]]),
    );
    expect(merged[0].pledgedSats).toBe(777);
    expect(merged[0].frStatus).toBe('open');
    expect(merged[0].goalSats).toBe(1000); // card goal is not overwritten by a nonzero API goal
    expect(merged[0].rail).toBe('lightning');
    expect(merged[0].runner).toBe('Agent');
    expect(merged[0].ownerPubkey).toBe('ab'.repeat(32));
    expect(merged[0].endTimeSec).toBe(now + 3600);
  });

  it('marks ledger-backed cards as verified provenance (API-only cards are not)', () => {
    const withLedger = mergeEnrichedCards(
      [card({ frId: 'fr_1' })],
      ledgerOf([['c1', summary({ raisedSats: 500, closed: true })]]),
      new Map([['c1', api({ raised_sats: 999 })]]),
    );
    expect(withLedger[0].ledgerVerified).toBe(true);
    const apiOnly = mergeEnrichedCards([card({ frId: 'fr_1' })], new Map(), new Map([['c1', api({ raised_sats: 1 })]]));
    expect(apiOnly[0].ledgerVerified).toBeUndefined();
  });

  it('marks a closed ledger completed even with no API detail', () => {
    const merged = mergeEnrichedCards([card()], ledgerOf([['c1', summary({ raisedSats: 42, closed: true })]]), new Map());
    expect(merged[0].pledgedSats).toBe(42);
    expect(merged[0].frStatus).toBe('completed');
  });

  it('leaves cards untouched when neither source has data', () => {
    const base = card({ pledgedSats: 7, status: 'locked' });
    const merged = mergeEnrichedCards([base], new Map(), new Map());
    expect(merged[0]).toEqual(base);
  });
});

describe('gate authority stays ledger-only (owner bug 2026-09-22)', () => {
  const ledger = ledgerOf([['39801:' + 'ab'.repeat(32) + ':vault', summary({ raisedSats: 1000, entriesCount: 1 })]]);
  const cards = [card({ id: '39801:' + 'ab'.repeat(32) + ':vault', frId: 'fr_1' })];
  const apiById = new Map([['39801:' + 'ab'.repeat(32) + ':vault', api({ raised_sats: 151_000 })]]);

  it('projects gates from the ledger fold, not from the API-enriched display total', () => {
    const merged = mergeEnrichedCards(cards, ledger, apiById);
    expect(merged[0].pledgedSats).toBe(151_000);
    const views = gateViewsForCards(merged, ledger, 1_700_000_000);
    const view = views.get(cards[0].id);
    expect(view).toBeDefined();
    // The fold's running total is the ledger's 1,000 - the API total is not a gate input.
    expect(view?.gates.length).toBeGreaterThan(0);
  });

  it('projects no gates for an API-only card with no ledger fold', () => {
    const apiOnly = [card({ id: 'c_api_only', frId: 'fr_1' })];
    const merged = mergeEnrichedCards(apiOnly, new Map(), new Map([['c_api_only', api({ raised_sats: 151_000 })]]));
    expect(gateViewsForCards(merged, new Map(), 1_700_000_000).size).toBe(0);
  });
});

describe('uniqueCampaignsForEnrichment', () => {
  it('dedupes campaigns in card order and skips cards with no frId', () => {
    const cards = [
      card({ id: 'a', frId: 'fr_1' }),
      card({ id: 'b', frId: 'fr_2' }),
      card({ id: 'c', frId: 'fr_1' }),
      card({ id: 'd' }),
      card({ id: 'e', frId: 'fr_3' }),
    ];
    expect(uniqueCampaignsForEnrichment(cards)).toEqual(['fr_1', 'fr_2', 'fr_3']);
  });

  it('bounds the campaign set at max (MAX_FUNDRAISERS parity)', () => {
    const cards = Array.from({ length: 30 }, (_, i) => card({ id: `c${i}`, frId: `fr_${i}` }));
    expect(uniqueCampaignsForEnrichment(cards)).toHaveLength(20);
    expect(uniqueCampaignsForEnrichment(cards, 3)).toEqual(['fr_0', 'fr_1', 'fr_2']);
  });
});

describe('enrichRelayCards dedupe/coverage (regression: slice(0,8) cap)', () => {
  const campaignCard = (id: string, frId: string): CampaignCardDraft =>
    card({ id, frId, pledgedSats: 0 });

  // 12 cards across 10 campaigns: campaigns c9/c10 have two milestone cards
  // each; campaigns beyond the old first-8-cards window must still enrich.
  const cards: CampaignCardDraft[] = [
    ...Array.from({ length: 8 }, (_, i) => campaignCard(`card_${i}`, `fr_${i}`)),
    campaignCard('card_8a', 'fr_8'),
    campaignCard('card_8b', 'fr_8'),
    campaignCard('card_9a', 'fr_9'),
    campaignCard('card_9b', 'fr_9'),
  ];

  it('fetches exactly one API detail per unique campaign and updates every card', async () => {
    const calls: string[] = [];
    const fetchDetail = vi.fn(async (frId: string) => {
      calls.push(frId);
      return { fundraiser: api({ id: frId, raised_sats: 100 + Number(frId.slice(3)) * 10 }) };
    });
    const { cards: merged } = await enrichRelayCards(cards, undefined, {
      fetchDetail,
      fetchLedger: async () => new Map(),
    });
    expect(fetchDetail).toHaveBeenCalledTimes(10);
    expect(new Set(calls).size).toBe(10);
    expect(calls).toEqual(Array.from({ length: 10 }, (_, i) => `fr_${i}`));
    // Every card got its campaign's total - including cards at positions 9-12
    // (the old code enriched only the first 8 cards).
    expect(merged).toHaveLength(12);
    for (const c of merged) {
      const frId = c.frId as string;
      expect(c.pledgedSats).toBe(100 + Number(frId.slice(3)) * 10);
    }
    expect(merged[9].pledgedSats).toBe(180); // fr_8 card beyond the old cap
    expect(merged[11].pledgedSats).toBe(190); // fr_9 card beyond the old cap
  });

  it('leaves only the failed campaign cards as the relay served them (failure-soft)', async () => {
    const fetchDetail = async (frId: string) => {
      if (frId === 'fr_3') throw new Error('detail unavailable');
      return { fundraiser: api({ id: frId, raised_sats: 1000 }) };
    };
    const { cards: merged } = await enrichRelayCards(cards, undefined, {
      fetchDetail,
      fetchLedger: async () => new Map(),
    });
    const failed = merged.filter((c) => c.frId === 'fr_3');
    expect(failed.length).toBe(1);
    expect(failed[0].pledgedSats).toBe(0);
    expect(merged.find((c) => c.frId === 'fr_9')?.pledgedSats).toBe(1000);
  });

  it('merges the pinned ledger for verification and keeps the API total displayed', async () => {
    const ledger = ledgerOf([['card_0', summary({ raisedSats: 1000, entriesCount: 1 })]]);
    const { cards: merged, ledger: out } = await enrichRelayCards(cards, undefined, {
      fetchDetail: async (frId: string) => ({ fundraiser: api({ id: frId, raised_sats: 151_000 }) }),
      fetchLedger: async () => ledger,
      registrarPin: { pubkey: '11'.repeat(32), epoch: 1 },
    });
    expect(out).toBe(ledger);
    expect(merged[0].pledgedSats).toBe(151_000);
    expect(merged[0].ledgerVerified).toBe(true);
    expect(merged[1].ledgerVerified).toBeUndefined();
  });

  it('skips API detail fetches entirely when no card carries an frId', async () => {
    const fetchDetail = vi.fn(async () => ({ fundraiser: api() }));
    const { cards: merged } = await enrichRelayCards([card({ id: 'x' })], undefined, {
      fetchDetail,
      fetchLedger: async () => new Map(),
    });
    expect(fetchDetail).not.toHaveBeenCalled();
    expect(merged[0].pledgedSats).toBe(0);
  });
});

describe('money-authority failures (deep-hunt wave 3)', () => {
  const fr = (over: Record<string, unknown> = {}) =>
    ({
      id: 'fr_1', title: 'Bench', description: 'campaign desc', owner_pubkey: 'ab'.repeat(32),
      runner_type: 'human', goal_sats: 1000, raised_sats: 0, status: 'open', settlement_rail: 'lightning',
      network: 'testnet', created_at: '2026-01-01', chat_room_available: true, ...over,
    }) as unknown as Parameters<typeof milestoneCard>[0];
  const ms = (over: Record<string, unknown> = {}) =>
    ({
      id: 'm1', fundraiser_id: 'fr_1', idx: 0, title: 'Rig', description: null, amount_sats: 15_000,
      status: 'locked', unlocked_at: null, released_at: null, payout_reference: null, market_id: 'mk_1',
      question: 'q', criteria: null, ...over,
    }) as unknown as BaoMilestone;

  it('fundraiserCard ignores the legacy mainnet marker (API network is authoritative)', () => {
    const card = fundraiserCard(fr({ description: 'campaign desc [rail:mainnet-cashu]', network: 'testnet' }));
    expect(card.mainnetCashu).toBe(false);
    const real = fundraiserCard(fr({ description: 'campaign desc', network: 'mainnet' }));
    expect(real.mainnetCashu).toBe(true);
  });

  it('milestone pledged follows the waterfall order (prior milestones first)', () => {
    const f = fr({ raised_sats: 20_000 });
    expect(milestoneCard(f, ms({ idx: 0, amount_sats: 15_000 })).pledgedSats).toBe(15_000);
    // Second milestone gets only what is left of the pot.
    expect(milestoneCard(f, ms({ idx: 1, amount_sats: 15_000 }), 15_000).pledgedSats).toBe(5_000);
    expect(milestoneCard(f, ms({ idx: 2, amount_sats: 15_000 }), 30_000).pledgedSats).toBe(0);
  });
});
