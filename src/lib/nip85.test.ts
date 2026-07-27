import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  chunkPubkeys,
  median,
  NIP85_KIND,
  parseRankAssertions,
  WOT_CHUNK_SIZE,
} from '@/lib/nip85';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

function assertion(d: string, tags: string[][], kind = NIP85_KIND): NostrEvent {
  return {
    id: 'x'.repeat(64),
    pubkey: 'c'.repeat(64),
    kind,
    created_at: 1_700_000_000,
    content: '',
    sig: 'y'.repeat(128),
    tags: [['d', d], ...tags],
  };
}

describe('median', () => {
  it('picks the middle of an odd list', () => {
    expect(median([10, 90, 50])).toBe(50);
  });

  it('averages the two middles of an even list', () => {
    expect(median([40, 60])).toBe(50);
    expect(median([40, 61])).toBe(51); // rounds 50.5 up
  });
});

describe('parseRankAssertions', () => {
  it('maps a single assertion to its clamped rank', () => {
    const ranks = parseRankAssertions([assertion(PK_A, [['rank', '87']])]);
    expect(ranks.get(PK_A)).toBe(87);
  });

  it('medians multiple provider assertions for the same pubkey', () => {
    const ranks = parseRankAssertions([
      assertion(PK_A, [['rank', '90']]),
      assertion(PK_A, [['rank', '91']]),
      assertion(PK_A, [['rank', '12']]), // outlier provider is absorbed
    ]);
    expect(ranks.get(PK_A)).toBe(90);
  });

  it('clamps out-of-range ranks to 0..100', () => {
    const ranks = parseRankAssertions([
      assertion(PK_A, [['rank', '140']]),
      assertion(PK_B, [['rank', '-3']]),
    ]);
    expect(ranks.get(PK_A)).toBe(100);
    expect(ranks.get(PK_B)).toBe(0);
  });

  it('ignores stats-only assertions without a rank tag', () => {
    const ranks = parseRankAssertions([assertion(PK_A, [['followers', '1234']])]);
    expect(ranks.size).toBe(0);
  });

  it('ignores wrong kinds, bad d tags, and non-numeric ranks', () => {
    const ranks = parseRankAssertions([
      assertion(PK_A, [['rank', '50']], 1),
      assertion('not-hex', [['rank', '50']]),
      assertion(PK_B, [['rank', 'high']]),
    ]);
    expect(ranks.size).toBe(0);
  });

  it('scores each d tag independently', () => {
    const ranks = parseRankAssertions([
      assertion(PK_A, [['rank', '80']]),
      assertion(PK_B, [['rank', '20']]),
    ]);
    expect(ranks.get(PK_A)).toBe(80);
    expect(ranks.get(PK_B)).toBe(20);
  });
});

describe('chunkPubkeys', () => {
  it('splits into fixed-size chunks', () => {
    const pubkeys = Array.from({ length: WOT_CHUNK_SIZE * 2 + 1 }, (_, i) => String(i));
    const chunks = chunkPubkeys(pubkeys);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(WOT_CHUNK_SIZE);
    expect(chunks[2]).toHaveLength(1);
  });

  it('returns no chunks for an empty list', () => {
    expect(chunkPubkeys([])).toEqual([]);
  });
});
