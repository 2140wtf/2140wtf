import { describe, expect, it } from 'vitest';

import { shouldReplaceNostrEvent } from './replaceableEvent';

describe('shouldReplaceNostrEvent', () => {
  it('prefers newer timestamps', () => {
    expect(shouldReplaceNostrEvent(
      { id: 'a', created_at: 10 },
      { id: 'f', created_at: 11 },
    )).toBe(true);
    expect(shouldReplaceNostrEvent(
      { id: 'a', created_at: 10 },
      { id: '0', created_at: 9 },
    )).toBe(false);
  });

  it('prefers the lexicographically lowest id for timestamp ties', () => {
    expect(shouldReplaceNostrEvent(
      { id: 'b', created_at: 10 },
      { id: 'a', created_at: 10 },
    )).toBe(true);
    expect(shouldReplaceNostrEvent(
      { id: 'a', created_at: 10 },
      { id: 'b', created_at: 10 },
    )).toBe(false);
    expect(shouldReplaceNostrEvent(
      { id: 'a', created_at: 10 },
      { id: 'a', created_at: 10 },
    )).toBe(false);
  });
});
