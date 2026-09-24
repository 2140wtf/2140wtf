import { describe, expect, it } from 'vitest';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';

import { parseBaoMarket, BAO_MARKET_KIND } from './baoMarketParser';

const sk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
const pubkey = getPublicKey(sk);

function createMarketEvent(overrides?: Partial<Parameters<typeof finalizeEvent>[0]>): ReturnType<typeof finalizeEvent> {
  return finalizeEvent(
    {
      kind: BAO_MARKET_KIND,
      content: JSON.stringify({
        title: 'Will it rain?',
        outcomes: ['Yes', 'No'],
      }),
      tags: [
        ['d', 'market-1'],
        ['category', 'weather'],
      ],
      created_at: 1000,
      ...overrides,
    },
    sk,
  );
}

describe('parseBaoMarket', () => {
  it('parses a valid signed market event', () => {
    const event = createMarketEvent();
    const parsed = parseBaoMarket(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.marketId).toBe('market-1');
    expect(parsed?.creatorPubkey).toBe(pubkey);
  });

  it('returns null for an event with an invalid signature', () => {
    const event = JSON.parse(JSON.stringify(createMarketEvent())) as ReturnType<typeof createMarketEvent>;
    event.sig = event.sig.slice(0, -1) + (event.sig.slice(-1) === '0' ? '1' : '0');
    expect(parseBaoMarket(event)).toBeNull();
  });

  it('returns null for a non-market kind', () => {
    const event = createMarketEvent({ kind: 1 });
    expect(parseBaoMarket(event)).toBeNull();
  });

  it('returns null for a market without a title', () => {
    const event = createMarketEvent({ content: JSON.stringify({}) });
    expect(parseBaoMarket(event)).toBeNull();
  });
});
