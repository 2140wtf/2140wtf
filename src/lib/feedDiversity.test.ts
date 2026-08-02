import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { interleaveFeedAuthors } from './feedDiversity';
import type { FeedItem } from './feedUtils';

function item(id: string, pubkey: string, createdAt: number): FeedItem {
  const event: NostrEvent = {
    id: id.padEnd(64, '0'),
    pubkey: pubkey.padEnd(64, '0'),
    kind: 1,
    content: id,
    tags: [],
    created_at: createdAt,
    sig: '0'.repeat(128),
  };
  return { event, sortTimestamp: createdAt };
}

describe('interleaveFeedAuthors', () => {
  it('keeps every event while exposing more authors near the top', () => {
    const original = [
      item('a1', 'a', 6),
      item('a2', 'a', 5),
      item('a3', 'a', 4),
      item('b1', 'b', 3),
      item('c1', 'c', 2),
      item('d1', 'd', 1),
    ];

    const result = interleaveFeedAuthors(original);

    expect(result).toHaveLength(original.length);
    expect(new Set(result.map((entry) => entry.event.id))).toEqual(new Set(original.map((entry) => entry.event.id)));
    expect(new Set(result.slice(0, 4).map((entry) => entry.event.pubkey))).toHaveLength(4);
    expect(result[0].event.content).toBe('a1');
  });
});
