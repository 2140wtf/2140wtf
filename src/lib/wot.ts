import type { NostrEvent } from '@nostrify/nostrify';

import { isNostrId } from '@/lib/nostrId';

// ============================================================================
// Web-of-Trust scoring over kind 3 contact lists.
//
// MODEL
//
//   * Anchor — the pubkey whose perspective scores are computed from (the
//     viewer, or a community anchor in BAO chat workspaces). The anchor
//     trusts itself.
//   * Follow graph — a directed graph built from kind 3 events: an edge
//     A -> B means "A follows B" (B appears as a `p` tag in A's kind 3).
//     Kind 3 is replaceable, so the newest event per pubkey wins.
//   * Distance — BFS hop count from the anchor along follow edges:
//     0 = the anchor, 1 = a direct follow, 2 = a follow-of-a-follow, ...
//     Pubkeys not reachable within the depth budget have distance `null`.
//   * Score — `1 / (1 + distance)` for reachable pubkeys, `0` for
//     unreachable ones: the anchor scores 1, a direct follow 1/2,
//     distance 2 scores 1/3. The score is strictly monotone decreasing in
//     distance, so "closer to the anchor" always means "higher score".
//   * followersWithin — a raw "vouch" signal exposed alongside the score so
//     UI can explain it: how many pubkeys in the anchor's distance 1..2
//     neighborhood follow the candidate. Not folded into the score — the
//     score stays a pure function of distance.
//
// CAPS
//
//   * `followDistances` and `isWithinWot` take an explicit `maxDepth`; the
//     batch scorer defaults to `DEFAULT_WOT_DEPTH` (2) — deep enough for a
//     meaningful vouch signal, shallow enough to bound relay fetches.
//   * The relay-facing layer (`src/hooks/useWot.ts`) builds a depth-2 graph
//     by fetching kind 3s for the anchor plus at most `WOT_GRAPH_CAP`
//     (1000) of the anchor's follows, so a bounded query set covers the
//     whole graph.
//
// Everything here is pure and synchronous — no relay access, no React.
// Relay fetching lives in `src/hooks/useWot.ts`.
// ============================================================================

/** Directed follow graph: pubkey -> set of pubkeys it follows. */
export type FollowGraph = Map<string, Set<string>>;

/** Default BFS depth for batch scoring and the relay-facing hook. */
export const DEFAULT_WOT_DEPTH = 2;

/**
 * Maximum number of the anchor's follows whose kind 3s the relay-facing
 * layer fetches to build a depth-2 graph. Bounds both the relay filter
 * size and the graph build cost; follows beyond the cap are treated as
 * leaf nodes (their own follows are unknown).
 */
export const WOT_GRAPH_CAP = 1000;

/** Score plus the raw signals needed to explain it in UI. */
export interface WotScore {
  /** `1 / (1 + distance)` when reachable, `0` when unreachable. */
  score: number;
  /** BFS hops from the anchor; `null` when unreachable within the depth budget. */
  distance: number | null;
  /** How many pubkeys at distance 1..2 from the anchor follow this candidate. */
  followersWithin: number;
}

/**
 * Build a follow graph from kind 3 contact-list events.
 *
 * The newest event per pubkey wins (kind 3 is replaceable); non-kind-3
 * events and malformed (non-hex) `p` tag values are dropped. Duplicate
 * follows collapse into the per-pubkey set. Self-follow edges are kept —
 * BFS visits the anchor first at distance 0, so they are harmless.
 */
export function buildFollowGraph(events: NostrEvent[]): FollowGraph {
  const latest = new Map<string, NostrEvent>();

  for (const event of events) {
    if (event.kind !== 3) continue;
    const existing = latest.get(event.pubkey);
    if (!existing || event.created_at > existing.created_at) {
      latest.set(event.pubkey, event);
    }
  }

  const graph: FollowGraph = new Map();
  for (const [pubkey, event] of latest) {
    const follows = new Set<string>();
    for (const [name, pk] of event.tags) {
      if (name === 'p' && isNostrId(pk)) follows.add(pk);
    }
    graph.set(pubkey, follows);
  }
  return graph;
}

/**
 * Breadth-first distances from `anchor`, up to `maxDepth` hops.
 *
 * The anchor is always present at distance 0. Pubkeys beyond `maxDepth`
 * (or entirely unreachable) are absent from the map. Cycles and
 * self-follows are safe: each pubkey is visited once, at its shortest
 * distance.
 */
export function followDistances(
  graph: FollowGraph,
  anchor: string,
  maxDepth: number,
): Map<string, number> {
  const distances = new Map<string, number>([[anchor, 0]]);

  let frontier = [anchor];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const pubkey of frontier) {
      for (const follow of graph.get(pubkey) ?? []) {
        if (!distances.has(follow)) {
          distances.set(follow, depth);
          next.push(follow);
        }
      }
    }
    frontier = next;
  }

  return distances;
}

/**
 * Count how many pubkeys at distance 1..2 from the anchor (per an already
 * computed distance map) follow `pubkey`. The anchor itself (distance 0)
 * never counts as a voucher.
 */
function countFollowersWithin(
  graph: FollowGraph,
  distances: Map<string, number>,
  pubkey: string,
): number {
  let count = 0;
  for (const [voucher, distance] of distances) {
    if (distance >= 1 && distance <= 2 && graph.get(voucher)?.has(pubkey)) {
      count++;
    }
  }
  return count;
}

function toScore(distance: number | null): number {
  return distance === null ? 0 : 1 / (1 + distance);
}

/**
 * Score a single pubkey relative to the anchor.
 *
 * Does a full BFS by default (the graph is built in-memory by the caller,
 * so it is already bounded); pass `maxDepth` to bound the traversal.
 * Unreachable pubkeys score 0 with `distance: null`.
 */
export function wotScore(
  graph: FollowGraph,
  anchor: string,
  pubkey: string,
  maxDepth: number = Number.POSITIVE_INFINITY,
): WotScore {
  const distances = followDistances(graph, anchor, maxDepth);
  const distance = distances.get(pubkey) ?? null;
  return {
    score: toScore(distance),
    distance,
    followersWithin: countFollowersWithin(graph, distances, pubkey),
  };
}

/**
 * Score a batch of candidate pubkeys with a single BFS.
 *
 * Distances are computed once up to `maxDepth` (default
 * `DEFAULT_WOT_DEPTH`); candidates not reached within that budget score 0.
 * Duplicate candidates collapse — the result is keyed by pubkey.
 */
export function wotScores(
  graph: FollowGraph,
  anchor: string,
  candidates: string[],
  maxDepth: number = DEFAULT_WOT_DEPTH,
): Map<string, WotScore> {
  const distances = followDistances(graph, anchor, maxDepth);

  const result = new Map<string, WotScore>();
  for (const pubkey of candidates) {
    if (result.has(pubkey)) continue;
    const distance = distances.get(pubkey) ?? null;
    // `followersWithin` is computed even for unreachable candidates: a
    // candidate beyond the depth budget can still be vouched for by the
    // anchor's distance 1..2 neighborhood.
    result.set(pubkey, {
      score: toScore(distance),
      distance,
      followersWithin: countFollowersWithin(graph, distances, pubkey),
    });
  }
  return result;
}

/**
 * Whether `pubkey` is reachable from the anchor within `maxDistance` hops.
 * The anchor is always within its own web of trust (distance 0).
 */
export function isWithinWot(
  graph: FollowGraph,
  anchor: string,
  pubkey: string,
  maxDistance: number,
): boolean {
  return followDistances(graph, anchor, maxDistance).has(pubkey);
}
