import { describe, expect, it } from 'vitest';
import { filterRealTrendingTags, isBlockedTrendEvent } from './useTrending';

describe('filterRealTrendingTags', () => {
  it('removes Solana and other altcoin promotion while retaining real topics', () => {
    const result = filterRealTrendingTags([
      { tag: 'Solana', accounts: 30, uses: 50 },
      { tag: '#ETH', accounts: 20, uses: 40 },
      { tag: 'bitcoin', accounts: 10, uses: 20 },
      { tag: 'gardening', accounts: 5, uses: 7 },
    ]);

    expect(result.map(({ tag }) => tag)).toEqual(['bitcoin', 'gardening']);
  });
});

describe('isBlockedTrendEvent', () => {
  it('rejects posts promoting a blocked coin through a topic tag', () => {
    expect(isBlockedTrendEvent({
      id: '1'.repeat(64),
      pubkey: '2'.repeat(64),
      created_at: 1,
      kind: 1,
      tags: [['t', 'SOLANA']],
      content: 'promotion',
      sig: '3'.repeat(128),
    })).toBe(true);
  });
});
