import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { deduplicateEvents } from './deduplicateEvents';

function event(id: string, createdAt: number): NostrEvent {
  return {
    id,
    pubkey: '1'.repeat(64),
    created_at: createdAt,
    kind: 30023,
    tags: [['d', 'same-coordinate']],
    content: id,
    sig: '2'.repeat(128),
  };
}

describe('deduplicateEvents', () => {
  it('keeps the newest replaceable event', () => {
    expect(deduplicateEvents([[event('b'.repeat(64), 10), event('a'.repeat(64), 11)]])[0]?.created_at).toBe(11);
  });

  it('uses the lexicographically lowest id for equal timestamps regardless of input order', () => {
    const low = event('a'.repeat(64), 10);
    const high = event('b'.repeat(64), 10);

    expect(deduplicateEvents([[high, low]])).toEqual([low]);
    expect(deduplicateEvents([[low, high]])).toEqual([low]);
  });
});
