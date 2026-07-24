import { describe, expect, it } from 'vitest';

import type { WotScore } from './wot';
import {
  DEFAULT_WOT_AGENT_MAX_DISTANCE,
  isOutsideWot,
  partitionMembersByWot,
  wotBadge,
  wotBadgeLabel,
} from './wotFilter';

/** Deterministic 64-char hex pubkey from a small integer. */
function pk(n: number): string {
  return n.toString(16).padStart(64, '0');
}

const ANCHOR = pk(1);
const FOLLOW = pk(2); // distance 1
const FOAF = pk(3); // distance 2
const DEEP = pk(4); // distance 3
const STRANGER = pk(5); // unreachable, unvouched
const VOUCHED = pk(6); // unreachable, but vouched by the 1..2 neighborhood

function score(distance: number | null, followersWithin = 0): WotScore {
  return {
    score: distance === null ? 0 : 1 / (1 + distance),
    distance,
    followersWithin,
  };
}

const MEMBERS = [ANCHOR, FOLLOW, FOAF, DEEP, STRANGER, VOUCHED];

const SCORES = new Map<string, WotScore>([
  [ANCHOR, score(0)],
  [FOLLOW, score(1)],
  [FOAF, score(2)],
  [DEEP, score(3)],
  [STRANGER, score(null)],
  [VOUCHED, score(null, 4)],
]);

describe('isOutsideWot', () => {
  it('treats unreachable pubkeys as outside', () => {
    expect(isOutsideWot(score(null), 2)).toBe(true);
  });

  it('treats distance at or under the cap as inside', () => {
    expect(isOutsideWot(score(0), 2)).toBe(false);
    expect(isOutsideWot(score(1), 2)).toBe(false);
    expect(isOutsideWot(score(2), 2)).toBe(false);
  });

  it('treats distance beyond the cap as outside', () => {
    expect(isOutsideWot(score(3), 2)).toBe(true);
  });

  it('fails open on a missing score', () => {
    expect(isOutsideWot(undefined, 2)).toBe(false);
  });
});

describe('partitionMembersByWot', () => {
  it('returns everyone visible when disabled', () => {
    const { visible, filtered } = partitionMembersByWot(MEMBERS, SCORES, {
      enabled: false,
      resolved: true,
    });
    expect(visible).toEqual(MEMBERS);
    expect(filtered).toEqual([]);
  });

  it('returns everyone visible while scores are unresolved (fail open)', () => {
    const { visible, filtered } = partitionMembersByWot(MEMBERS, SCORES, {
      enabled: true,
      resolved: false,
    });
    expect(visible).toEqual(MEMBERS);
    expect(filtered).toEqual([]);
  });

  it('collapses unreachable and beyond-cap pubkeys with the default radius', () => {
    expect(DEFAULT_WOT_AGENT_MAX_DISTANCE).toBe(2);
    const { visible, filtered } = partitionMembersByWot(MEMBERS, SCORES, {
      enabled: true,
      resolved: true,
    });
    expect(visible).toEqual([ANCHOR, FOLLOW, FOAF]);
    expect(filtered).toEqual([DEEP, STRANGER, VOUCHED]);
  });

  it('honors a custom maxDistance', () => {
    const { visible, filtered } = partitionMembersByWot(MEMBERS, SCORES, {
      enabled: true,
      resolved: true,
      maxDistance: 1,
    });
    expect(visible).toEqual([ANCHOR, FOLLOW]);
    expect(filtered).toEqual([FOAF, DEEP, STRANGER, VOUCHED]);
  });

  it('never filters exempt pubkeys, even when unreachable', () => {
    const { visible, filtered } = partitionMembersByWot(MEMBERS, SCORES, {
      enabled: true,
      resolved: true,
      exempt: new Set([STRANGER]),
    });
    expect(visible).toEqual([ANCHOR, FOLLOW, FOAF, STRANGER]);
    expect(filtered).toEqual([DEEP, VOUCHED]);
  });

  it('fails open for members with no score entry', () => {
    const unknown = pk(7);
    const { visible, filtered } = partitionMembersByWot([unknown], SCORES, {
      enabled: true,
      resolved: true,
    });
    expect(visible).toEqual([unknown]);
    expect(filtered).toEqual([]);
  });

  it('preserves input order within both partitions', () => {
    const shuffled = [STRANGER, FOAF, DEEP, FOLLOW, ANCHOR];
    const { visible, filtered } = partitionMembersByWot(shuffled, SCORES, {
      enabled: true,
      resolved: true,
    });
    expect(visible).toEqual([FOAF, FOLLOW, ANCHOR]);
    expect(filtered).toEqual([STRANGER, DEEP]);
  });
});

describe('wotBadge', () => {
  it('returns undefined without a score (still loading)', () => {
    expect(wotBadge(undefined)).toBeUndefined();
  });

  it('maps distance 0 to self', () => {
    expect(wotBadge(score(0))).toEqual({ kind: 'self' });
  });

  it('maps reachable distances to within', () => {
    expect(wotBadge(score(1))).toEqual({ kind: 'within', distance: 1 });
    expect(wotBadge(score(2))).toEqual({ kind: 'within', distance: 2 });
  });

  it('maps unreachable-but-vouched to vouched', () => {
    expect(wotBadge(score(null, 3))).toEqual({ kind: 'vouched', followersWithin: 3 });
  });

  it('maps unreachable-and-unvouched to outside', () => {
    expect(wotBadge(score(null))).toEqual({ kind: 'outside' });
  });

  it('prefers within over vouched when reachable', () => {
    expect(wotBadge(score(2, 5))).toEqual({ kind: 'within', distance: 2 });
  });
});

describe('wotBadgeLabel', () => {
  it('labels each badge kind', () => {
    expect(wotBadgeLabel({ kind: 'self' })).toBe('This is you');
    expect(wotBadgeLabel({ kind: 'within', distance: 1 })).toBe(
      'In your web of trust — you follow them',
    );
    expect(wotBadgeLabel({ kind: 'within', distance: 2 })).toBe('In your web of trust (2 hops)');
    expect(wotBadgeLabel({ kind: 'vouched', followersWithin: 4 })).toBe(
      'Outside your web of trust — vouched by 4 in your network',
    );
    expect(wotBadgeLabel({ kind: 'outside' })).toBe('Outside your web of trust');
  });
});
