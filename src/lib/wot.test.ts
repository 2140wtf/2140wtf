import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  buildFollowGraph,
  DEFAULT_WOT_DEPTH,
  followDistances,
  isWithinWot,
  WOT_GRAPH_CAP,
  wotScore,
  wotScores,
} from './wot';

/** Deterministic 64-char hex pubkey from a small integer. */
function pk(n: number): string {
  return n.toString(16).padStart(64, '0');
}

const ANCHOR = pk(1);
const ALICE = pk(2);
const BOB = pk(3);
const CAROL = pk(4);
const DAVE = pk(5);
const EVE = pk(6);

let idCounter = 0;
function kind3(pubkey: string, follows: string[], createdAt = 1000): NostrEvent {
  return {
    id: (idCounter++).toString(16).padStart(64, '0'),
    pubkey,
    kind: 3,
    created_at: createdAt,
    tags: follows.map((f) => ['p', f]),
    content: '',
    sig: 'c'.repeat(128),
  };
}

describe('buildFollowGraph', () => {
  it('maps each author to the set of p-tag pubkeys', () => {
    const graph = buildFollowGraph([kind3(ANCHOR, [ALICE, BOB])]);
    expect(graph.get(ANCHOR)).toEqual(new Set([ALICE, BOB]));
  });

  it('lets the newest event per pubkey win', () => {
    const graph = buildFollowGraph([
      kind3(ANCHOR, [ALICE], 2000),
      kind3(ANCHOR, [BOB], 1000),
    ]);
    expect(graph.get(ANCHOR)).toEqual(new Set([ALICE]));
  });

  it('lets the newest event win regardless of input order', () => {
    const graph = buildFollowGraph([
      kind3(ANCHOR, [BOB], 1000),
      kind3(ANCHOR, [ALICE], 2000),
    ]);
    expect(graph.get(ANCHOR)).toEqual(new Set([ALICE]));
  });

  it('ignores non-kind-3 events and malformed p tags', () => {
    const notKind3: NostrEvent = { ...kind3(ANCHOR, [DAVE]), kind: 1 };
    const malformed: NostrEvent = {
      ...kind3(BOB, []),
      tags: [['p', 'not-hex'], ['p', ALICE], ['e', CAROL]],
    };
    const graph = buildFollowGraph([notKind3, malformed]);
    expect(graph.has(ANCHOR)).toBe(false);
    expect(graph.get(BOB)).toEqual(new Set([ALICE]));
  });

  it('deduplicates repeated follows', () => {
    const graph = buildFollowGraph([kind3(ANCHOR, [ALICE, ALICE, ALICE])]);
    expect(graph.get(ANCHOR)).toEqual(new Set([ALICE]));
  });
});

describe('followDistances', () => {
  // ANCHOR -> ALICE, BOB; ALICE -> CAROL; BOB -> CAROL; CAROL -> DAVE
  const graph = buildFollowGraph([
    kind3(ANCHOR, [ALICE, BOB]),
    kind3(ALICE, [CAROL]),
    kind3(BOB, [CAROL]),
    kind3(CAROL, [DAVE]),
  ]);

  it('assigns distance 0 to the anchor, 1 to direct follows, 2 to follows-of-follows', () => {
    const distances = followDistances(graph, ANCHOR, 3);
    expect(distances.get(ANCHOR)).toBe(0);
    expect(distances.get(ALICE)).toBe(1);
    expect(distances.get(BOB)).toBe(1);
    expect(distances.get(CAROL)).toBe(2);
    expect(distances.get(DAVE)).toBe(3);
  });

  it('omits unreachable pubkeys', () => {
    const distances = followDistances(graph, ANCHOR, 3);
    expect(distances.has(EVE)).toBe(false);
  });

  it('caps traversal at maxDepth', () => {
    const distances = followDistances(graph, ANCHOR, 1);
    expect(distances.get(ALICE)).toBe(1);
    expect(distances.has(CAROL)).toBe(false);
    expect(distances.has(DAVE)).toBe(false);
  });

  it('maxDepth 0 returns only the anchor', () => {
    const distances = followDistances(graph, ANCHOR, 0);
    expect([...distances.entries()]).toEqual([[ANCHOR, 0]]);
  });

  it('handles cycles without inflating distances', () => {
    const cyclic = buildFollowGraph([
      kind3(ANCHOR, [ALICE]),
      kind3(ALICE, [BOB]),
      kind3(BOB, [ANCHOR, ALICE]), // back edges
    ]);
    const distances = followDistances(cyclic, ANCHOR, 5);
    expect(distances.get(ANCHOR)).toBe(0);
    expect(distances.get(ALICE)).toBe(1);
    expect(distances.get(BOB)).toBe(2);
    expect(distances.size).toBe(3);
  });

  it('handles self-follows', () => {
    const selfy = buildFollowGraph([
      kind3(ANCHOR, [ANCHOR, ALICE]),
      kind3(ALICE, [ALICE]),
    ]);
    const distances = followDistances(selfy, ANCHOR, 2);
    expect(distances.get(ANCHOR)).toBe(0);
    expect(distances.get(ALICE)).toBe(1);
  });

  it('returns only the anchor for an empty graph', () => {
    const distances = followDistances(new Map(), ANCHOR, 2);
    expect([...distances.entries()]).toEqual([[ANCHOR, 0]]);
  });
});

describe('wotScore', () => {
  // ANCHOR -> ALICE; ALICE -> BOB; BOB -> CAROL. EVE is unreachable.
  // DAVE is followed by both ALICE and BOB (vouch signal), but not by ANCHOR.
  const graph = buildFollowGraph([
    kind3(ANCHOR, [ALICE]),
    kind3(ALICE, [BOB, DAVE]),
    kind3(BOB, [CAROL, DAVE]),
    kind3(CAROL, []),
  ]);

  it('scores the anchor 1, direct follow 1/2, distance 2 -> 1/3, unreachable 0', () => {
    expect(wotScore(graph, ANCHOR, ANCHOR).score).toBe(1);
    expect(wotScore(graph, ANCHOR, ALICE).score).toBe(1 / 2);
    expect(wotScore(graph, ANCHOR, BOB).score).toBe(1 / 3);
    expect(wotScore(graph, ANCHOR, CAROL).score).toBe(1 / 4);
    expect(wotScore(graph, ANCHOR, EVE).score).toBe(0);
  });

  it('exposes distance and null distance for unreachable pubkeys', () => {
    expect(wotScore(graph, ANCHOR, BOB).distance).toBe(2);
    expect(wotScore(graph, ANCHOR, EVE).distance).toBeNull();
  });

  it('is monotone decreasing in distance', () => {
    const scores = [ANCHOR, ALICE, BOB, CAROL, EVE].map(
      (pubkey) => wotScore(graph, ANCHOR, pubkey).score,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it('counts followers within the anchor distance 1..2 neighborhood', () => {
    // ALICE (d1) and BOB (d2) both follow DAVE.
    expect(wotScore(graph, ANCHOR, DAVE).followersWithin).toBe(2);
    // Only ALICE (d1) follows BOB.
    expect(wotScore(graph, ANCHOR, BOB).followersWithin).toBe(1);
    // Nobody in the neighborhood follows EVE.
    expect(wotScore(graph, ANCHOR, EVE).followersWithin).toBe(0);
  });

  it('does not count the anchor itself as a voucher', () => {
    const directOnly = buildFollowGraph([kind3(ANCHOR, [ALICE])]);
    expect(wotScore(directOnly, ANCHOR, ALICE).followersWithin).toBe(0);
  });
});

describe('wotScores', () => {
  const graph = buildFollowGraph([
    kind3(ANCHOR, [ALICE]),
    kind3(ALICE, [BOB]),
    kind3(BOB, [CAROL]),
  ]);

  it('scores each candidate with a single BFS, capped at maxDepth', () => {
    const scores = wotScores(graph, ANCHOR, [ALICE, BOB, CAROL], 2);
    expect(scores.get(ALICE)).toMatchObject({ score: 1 / 2, distance: 1 });
    expect(scores.get(BOB)).toMatchObject({ score: 1 / 3, distance: 2 });
    // CAROL is at distance 3 — beyond the depth budget, so score 0 — but
    // BOB (distance 2) follows her, so the vouch signal is still reported.
    expect(scores.get(CAROL)).toEqual({ score: 0, distance: null, followersWithin: 1 });
  });

  it('defaults to DEFAULT_WOT_DEPTH', () => {
    expect(DEFAULT_WOT_DEPTH).toBe(2);
    const scores = wotScores(graph, ANCHOR, [CAROL]);
    expect(scores.get(CAROL)?.score).toBe(0);
  });

  it('collapses duplicate candidates', () => {
    const scores = wotScores(graph, ANCHOR, [ALICE, ALICE]);
    expect(scores.size).toBe(1);
  });

  it('scores every candidate 0 on an empty graph', () => {
    const scores = wotScores(new Map(), ANCHOR, [ALICE, BOB]);
    expect(scores.get(ALICE)).toEqual({ score: 0, distance: null, followersWithin: 0 });
    expect(scores.get(BOB)).toEqual({ score: 0, distance: null, followersWithin: 0 });
  });
});

describe('isWithinWot', () => {
  const graph = buildFollowGraph([
    kind3(ANCHOR, [ALICE]),
    kind3(ALICE, [BOB]),
    kind3(BOB, [CAROL]),
  ]);

  it('is true for the anchor and pubkeys within maxDistance', () => {
    expect(isWithinWot(graph, ANCHOR, ANCHOR, 2)).toBe(true);
    expect(isWithinWot(graph, ANCHOR, ALICE, 1)).toBe(true);
    expect(isWithinWot(graph, ANCHOR, BOB, 2)).toBe(true);
  });

  it('is false beyond maxDistance or for unreachable pubkeys', () => {
    expect(isWithinWot(graph, ANCHOR, BOB, 1)).toBe(false);
    expect(isWithinWot(graph, ANCHOR, CAROL, 2)).toBe(false);
    expect(isWithinWot(graph, ANCHOR, EVE, 10)).toBe(false);
  });
});

describe('caps', () => {
  it('exposes a 1000-pubkey graph cap for the relay layer', () => {
    expect(WOT_GRAPH_CAP).toBe(1000);
  });

  it('handles graphs at the cap scale without pathological behavior', () => {
    // ANCHOR follows 1000 pubkeys; each of those follows EVE.
    const fanout = Array.from({ length: WOT_GRAPH_CAP }, (_, i) => pk(100 + i));
    const events = [
      kind3(ANCHOR, fanout),
      ...fanout.map((pubkey) => kind3(pubkey, [EVE])),
    ];
    const graph = buildFollowGraph(events);
    const distances = followDistances(graph, ANCHOR, 2);
    expect(distances.size).toBe(WOT_GRAPH_CAP + 2); // anchor + fanout + EVE
    expect(wotScore(graph, ANCHOR, EVE).followersWithin).toBe(WOT_GRAPH_CAP);
  });
});
