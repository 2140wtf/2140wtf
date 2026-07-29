import { describe, expect, it } from 'vitest';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  isValidBaoRelayMarketEvent,
  mergeApiAndRelayMarkets,
  parseBaoRelayMarket,
  parseBaoRelayMarkets,
} from './baoRelayMarkets';
import { BAO_MARKET_KIND, type BaoMarket } from './baoMarketParser';

const sk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
const pubkey = getPublicKey(sk);

const NETWORK = 'demo';

interface MarketEventOverrides {
  dTag?: string;
  network?: string;
  created_at?: number;
  tags?: string[][];
  content?: string;
}

/**
 * Build a signed kind-38000 event shaped like the ones bao.markets publishes:
 * markdown content, metadata in tags, title/outcomes in the `data` tag JSON.
 */
function createRelayMarketEvent(overrides: MarketEventOverrides = {}): NostrEvent {
  const {
    dTag = 'market-1',
    network = NETWORK,
    created_at = 1_700_000_000,
    tags,
    content = 'Will it rain?\n\nTracks rain.',
  } = overrides;

  const defaultTags = [
    ['d', dTag],
    ['c', 'weather'],
    ['n', network],
    ['end', '1800000000'],
    ['pool_model', 'smj'],
    ['outcome', 'Yes'],
    ['outcome', 'No'],
    ['data', JSON.stringify({
      title: 'Will it rain?',
      description: 'Tracks rain.',
      outcomes: ['Yes', 'No'],
    })],
  ];

  return finalizeEvent(
    {
      kind: BAO_MARKET_KIND,
      content,
      tags: tags ?? defaultTags,
      created_at,
    },
    sk,
  ) as NostrEvent;
}

function fakeApiMarket(overrides: Partial<BaoMarket> = {}): BaoMarket {
  return {
    marketId: 'market-1',
    title: 'API market',
    description: '',
    category: 'weather',
    state: 'active',
    type: 'binary',
    endTime: 1_800_000_000,
    createdAt: 1_700_000_000,
    outcomes: [
      { id: 'YES', label: 'Yes', probability: 0.7 },
      { id: 'NO', label: 'No', probability: 0.3 },
    ],
    creatorPubkey: pubkey,
    rawEvent: {} as NostrEvent,
    ...overrides,
  };
}

describe('isValidBaoRelayMarketEvent', () => {
  it('accepts a well-formed market event', () => {
    expect(isValidBaoRelayMarketEvent(createRelayMarketEvent(), NETWORK)).toBe(true);
  });

  it('rejects the wrong kind', () => {
    const event = createRelayMarketEvent();
    const wrongKind = { ...event, kind: 1 };
    expect(isValidBaoRelayMarketEvent(wrongKind, NETWORK)).toBe(false);
  });

  it('rejects a missing d tag', () => {
    const event = createRelayMarketEvent({
      tags: createRelayMarketEvent().tags.filter((t) => t[0] !== 'd'),
    });
    expect(isValidBaoRelayMarketEvent(event, NETWORK)).toBe(false);
  });

  it('rejects a wrong network tag', () => {
    const event = createRelayMarketEvent({ network: 'mainnet' });
    expect(isValidBaoRelayMarketEvent(event, NETWORK)).toBe(false);
  });

  it('rejects a missing network tag', () => {
    const event = createRelayMarketEvent({
      tags: createRelayMarketEvent().tags.filter((t) => t[0] !== 'n'),
    });
    expect(isValidBaoRelayMarketEvent(event, NETWORK)).toBe(false);
  });

  it('rejects a missing category tag', () => {
    const event = createRelayMarketEvent({
      tags: createRelayMarketEvent().tags.filter((t) => t[0] !== 'c'),
    });
    expect(isValidBaoRelayMarketEvent(event, NETWORK)).toBe(false);
  });

  it('rejects a missing or non-numeric end tag', () => {
    const base = createRelayMarketEvent();
    const missing = createRelayMarketEvent({
      tags: base.tags.filter((t) => t[0] !== 'end'),
    });
    expect(isValidBaoRelayMarketEvent(missing, NETWORK)).toBe(false);

    const nonNumeric = createRelayMarketEvent({
      tags: [...base.tags.filter((t) => t[0] !== 'end'), ['end', 'soon']],
    });
    expect(isValidBaoRelayMarketEvent(nonNumeric, NETWORK)).toBe(false);
  });

  it('rejects fewer than two outcomes', () => {
    const base = createRelayMarketEvent();
    const oneOutcome = createRelayMarketEvent({
      tags: [
        ...base.tags.filter((t) => t[0] !== 'outcome' && t[0] !== 'data'),
        ['outcome', 'Yes'],
        ['data', JSON.stringify({ title: 'Will it rain?', outcomes: ['Yes'] })],
      ],
    });
    expect(isValidBaoRelayMarketEvent(oneOutcome, NETWORK)).toBe(false);

    const noOutcomes = createRelayMarketEvent({
      tags: [
        ...base.tags.filter((t) => t[0] !== 'outcome' && t[0] !== 'data'),
        ['data', JSON.stringify({ title: 'Will it rain?' })],
      ],
    });
    expect(isValidBaoRelayMarketEvent(noOutcomes, NETWORK)).toBe(false);
  });

  it('rejects a missing title', () => {
    const base = createRelayMarketEvent();
    const event = createRelayMarketEvent({
      tags: base.tags.map((t) =>
        t[0] === 'data'
          ? ['data', JSON.stringify({ description: 'no title here', outcomes: ['Yes', 'No'] })]
          : t,
      ),
    });
    expect(isValidBaoRelayMarketEvent(event, NETWORK)).toBe(false);
  });

  it('accepts outcomes carried only in the data tag (no outcome tags)', () => {
    const base = createRelayMarketEvent();
    const event = createRelayMarketEvent({
      tags: base.tags.filter((t) => t[0] !== 'outcome'),
    });
    expect(isValidBaoRelayMarketEvent(event, NETWORK)).toBe(true);
  });

  it('is case-insensitive on the network tag', () => {
    const event = createRelayMarketEvent({ network: 'DEMO' });
    expect(isValidBaoRelayMarketEvent(event, NETWORK)).toBe(true);
  });
});

describe('parseBaoRelayMarket', () => {
  it('parses a valid relay event into the BaoMarket card shape', () => {
    const parsed = parseBaoRelayMarket(createRelayMarketEvent(), NETWORK);
    expect(parsed).not.toBeNull();
    expect(parsed?.marketId).toBe('market-1');
    expect(parsed?.title).toBe('Will it rain?');
    expect(parsed?.category).toBe('weather');
    expect(parsed?.state).toBe('active');
    expect(parsed?.type).toBe('binary');
    expect(parsed?.endTime).toBe(1_800_000_000);
    expect(parsed?.creatorPubkey).toBe(pubkey);
    expect(parsed?.outcomes).toHaveLength(2);
    expect(parsed?.outcomes.map((o) => o.label)).toEqual(['Yes', 'No']);
  });

  it('returns null for malformed events without throwing', () => {
    expect(parseBaoRelayMarket(createRelayMarketEvent({ network: 'mainnet' }), NETWORK)).toBeNull();
  });
});

describe('parseBaoRelayMarkets', () => {
  it('dedupes by d-tag keeping the newest event', () => {
    const older = createRelayMarketEvent({ created_at: 1_700_000_000 });
    const newer = createRelayMarketEvent({ created_at: 1_700_100_000 });
    const markets = parseBaoRelayMarkets([older, newer], NETWORK);
    expect(markets).toHaveLength(1);
    expect(markets[0].createdAt).toBe(1_700_100_000);

    // Order of arrival must not matter.
    const reversed = parseBaoRelayMarkets([newer, older], NETWORK);
    expect(reversed).toHaveLength(1);
    expect(reversed[0].createdAt).toBe(1_700_100_000);
  });

  it('drops malformed events and duplicate event ids silently', () => {
    const valid = createRelayMarketEvent({ dTag: 'good' });
    const spam = createRelayMarketEvent({ dTag: 'spam', network: 'mainnet' });
    const markets = parseBaoRelayMarkets([valid, valid, spam], NETWORK);
    expect(markets).toHaveLength(1);
    expect(markets[0].marketId).toBe('good');
  });

  it('keeps distinct d-tags and sorts newest-first', () => {
    const a = createRelayMarketEvent({ dTag: 'a', created_at: 1_700_000_000 });
    const b = createRelayMarketEvent({ dTag: 'b', created_at: 1_700_500_000 });
    const markets = parseBaoRelayMarkets([a, b], NETWORK);
    expect(markets.map((m) => m.marketId)).toEqual(['b', 'a']);
  });
});

describe('mergeApiAndRelayMarkets', () => {
  it('marks API markets as having odds and not via relay', () => {
    const merged = mergeApiAndRelayMarkets([fakeApiMarket()], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].viaRelay).toBe(false);
    expect(merged[0].oddsAvailable).toBe(true);
  });

  it('includes relay-only markets flagged as via relay with odds unavailable', () => {
    const relay = fakeApiMarket({ marketId: 'relay-only' });
    const merged = mergeApiAndRelayMarkets([fakeApiMarket()], [relay]);
    expect(merged).toHaveLength(2);
    const relayOnly = merged.find((m) => m.marketId === 'relay-only');
    expect(relayOnly?.viaRelay).toBe(true);
    expect(relayOnly?.oddsAvailable).toBe(false);
  });

  it('lets the API win on marketId conflicts', () => {
    const relay = fakeApiMarket({ marketId: 'market-1', title: 'Relay copy', createdAt: 1_700_500_000 });
    const merged = mergeApiAndRelayMarkets([fakeApiMarket()], [relay]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('API market');
    expect(merged[0].viaRelay).toBe(false);
  });

  it('sorts merged markets newest-first', () => {
    const api = fakeApiMarket({ marketId: 'api', createdAt: 1_700_000_000 });
    const relay = fakeApiMarket({ marketId: 'relay', createdAt: 1_700_500_000 });
    const merged = mergeApiAndRelayMarkets([api], [relay]);
    expect(merged.map((m) => m.marketId)).toEqual(['relay', 'api']);
  });
});
