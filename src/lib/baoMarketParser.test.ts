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

// ── Round 35 adversarial cases ────────────────────────────────────────────────

describe('round 35: outcome/end-time/category caps', () => {
  it('caps a flooded content outcomes array at 20', () => {
    const outcomes = Array.from({ length: 5000 }, (_, i) => `Outcome ${i}`);
    const event = createMarketEvent({ content: JSON.stringify({ title: 'T', outcomes }) });
    const parsed = parseBaoMarket(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.outcomes.length).toBeLessThanOrEqual(20);
  });

  it('caps a flooded outcome-tag list at 20', () => {
    const tags = [['d', 'm-tags'], ...Array.from({ length: 5000 }, (_, i) => ['outcome', `Opt ${i}`])] as string[][];
    const event = createMarketEvent({ content: JSON.stringify({ title: 'T' }), tags });
    const parsed = parseBaoMarket(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.outcomes.length).toBeLessThanOrEqual(20);
  });

  it('clamps absurd end dates to unknown instead of pinning time sorts', () => {
    const year285k = createMarketEvent({ tags: [['d', 'm-end'], ['end', '9007199254740991']] });
    expect(parseBaoMarket(year285k)!.endTime).toBe(0);
    // Millis path is converted to seconds: 2286-11-20 in ms is >1e12 but the
    // resulting epoch seconds still exceed the sane window → unknown.
    const farMs = createMarketEvent({ tags: [['d', 'm-end2'], ['end', '9999999999999']] });
    expect(parseBaoMarket(farMs)!.endTime).toBe(0);
    // A realistic end date survives intact.
    const sane = createMarketEvent({ tags: [['d', 'm-end3'], ['end', '1800000000']] });
    expect(parseBaoMarket(sane)!.endTime).toBe(1800000000);
  });

  it('caps over-long category/state fields at 64 chars', () => {
    const event = createMarketEvent({ tags: [['d', 'm-cat'], ['category', 'x'.repeat(9000)]] });
    const parsed = parseBaoMarket(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.category.length).toBeLessThanOrEqual(64);
  });
});
