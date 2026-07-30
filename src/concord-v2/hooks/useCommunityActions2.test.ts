import { describe, expect, it } from 'vitest';

import { defaultCreateRelays, FEED_RELAY_CANDIDATES } from './useCommunityActions2';
import { MAX_COMMUNITY_RELAYS, canonicalRelayUrl } from '@/concord-v2/lib/types';

describe('FEED_RELAY_CANDIDATES', () => {
  it('offers the curated feed relay set as portable wss:// candidates', () => {
    expect(FEED_RELAY_CANDIDATES.length).toBeGreaterThanOrEqual(10);
    for (const url of FEED_RELAY_CANDIDATES) {
      expect(url.startsWith('wss://')).toBe(true);
    }
  });
});

describe('defaultCreateRelays', () => {
  it('draws the default set from the feed relay candidates when nothing else is configured', () => {
    const relays = defaultCreateRelays([], []);
    expect(relays.length).toBeGreaterThan(0);
    expect(relays.length).toBeLessThanOrEqual(MAX_COMMUNITY_RELAYS);
    // Every feed candidate that fits under the cap is in the default set
    // (compared canonically — capRelays emits the canonical form).
    const canonical = new Set(relays);
    for (const url of FEED_RELAY_CANDIDATES.slice(0, MAX_COMMUNITY_RELAYS)) {
      expect(canonical.has(canonicalRelayUrl(url))).toBe(true);
    }
  });

  it('leads with the app relays and stays within the community relay cap', () => {
    const relays = defaultCreateRelays(['wss://my.relay/'], []);
    expect(relays[0]).toBe('wss://my.relay');
    expect(relays.length).toBeLessThanOrEqual(MAX_COMMUNITY_RELAYS);
    expect(relays).toContain(canonicalRelayUrl(FEED_RELAY_CANDIDATES[0]));
  });

  it('dedupes an app relay that is also a feed relay (canonical form)', () => {
    const shared = FEED_RELAY_CANDIDATES[0];
    const relays = defaultCreateRelays([shared], []);
    expect(relays.filter((u) => u === canonicalRelayUrl(shared))).toHaveLength(1);
  });

  it('never exceeds the cap even with app, feed, stock and DM relays combined', () => {
    const relays = defaultCreateRelays(['wss://my.relay/'], ['wss://my-inbox.relay/']);
    expect(relays.length).toBeLessThanOrEqual(MAX_COMMUNITY_RELAYS);
    expect(relays[0]).toBe('wss://my.relay');
    expect(new Set(relays).size).toBe(relays.length);
  });
});
