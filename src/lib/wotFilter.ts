import type { WotScore } from './wot';

// ============================================================================
// Web-of-Trust "agent filter" decisions for ₿AO chat (Concord V2) workspaces.
//
// Concord V2 has no explicit bot/agent marker on its roster (roles are
// owner/admin/moderator plus custom permission roles; the Buzz "bot" role is
// a NIP-29 concept). So the filter applies to ALL non-exempt members and is
// surfaced in the UI as an "agent filter": community-role holders (the
// `exempt` set — owner, admins, moderators — plus the anchor) act as
// community-vouched and are never collapsed; everyone else whose follow
// distance from the anchor exceeds `maxDistance` (or who is unreachable) is
// treated as a potential agent and collapsed behind an expandable row.
//
// FAIL-OPEN GUARANTEES (agent spam must never cost the user real voices):
//   * `enabled: false`            → nobody is filtered.
//   * `resolved: false` (loading) → nobody is filtered. Zero scores from a
//     not-yet-loaded graph are indistinguishable from "unreachable", so the
//     caller must pass `resolved` only once real scores exist.
//   * a member with no score entry → visible.
//   * an anchor with no kind 3 at all yields an empty graph; the CALLER
//     should keep `resolved` false in that case (see ConcordV2Page), so a
//     follow-less account doesn't filter its whole roster away.
//
// Everything here is pure and synchronous — no React, no relay access.
// ============================================================================

/** Default trust radius: the anchor's follows and follows-of-follows. */
export const DEFAULT_WOT_AGENT_MAX_DISTANCE = 2;

export interface WotAgentFilterOpts {
  /** Master switch — when false, nobody is filtered. */
  enabled: boolean;
  /**
   * True only once the WoT graph has loaded (and is non-empty). While false,
   * the filter fails open: every member stays visible.
   */
  resolved: boolean;
  /** Max BFS hops from the anchor that still count as inside the web of trust. */
  maxDistance?: number;
  /**
   * Pubkeys that can never be filtered: the anchor itself plus community-role
   * holders (owner/admins/moderators), who are already vouched for by the
   * community's own trust structure.
   */
  exempt?: ReadonlySet<string>;
}

/**
 * Whether a single score places its pubkey outside the trust radius.
 * A missing score fails open (`false` — visible).
 */
export function isOutsideWot(score: WotScore | undefined, maxDistance: number): boolean {
  if (!score) return false;
  return score.distance === null || score.distance > maxDistance;
}

/**
 * Split a member list into `visible` and `filtered` (collapsed) pubkeys.
 *
 * Order is preserved within both partitions. With the filter disabled or
 * scores unresolved, `filtered` is empty and `visible` is the input as-is.
 */
export function partitionMembersByWot(
  members: string[],
  scores: Map<string, WotScore>,
  opts: WotAgentFilterOpts,
): { visible: string[]; filtered: string[] } {
  if (!opts.enabled || !opts.resolved) return { visible: members, filtered: [] };

  const maxDistance = opts.maxDistance ?? DEFAULT_WOT_AGENT_MAX_DISTANCE;
  const exempt = opts.exempt;

  const visible: string[] = [];
  const filtered: string[] = [];
  for (const pubkey of members) {
    if (exempt?.has(pubkey) || !isOutsideWot(scores.get(pubkey), maxDistance)) {
      visible.push(pubkey);
    } else {
      filtered.push(pubkey);
    }
  }
  return { visible, filtered };
}

// ── Trust badges ────────────────────────────────────────────────────────────

/**
 * The trust state surfaced next to a member's name:
 *   * `self`    — the anchor (distance 0); the UI renders no dot.
 *   * `within`  — reachable within the depth budget (`distance` hops).
 *   * `vouched` — unreachable, but followed by `followersWithin` pubkeys in
 *                 the anchor's distance 1..2 neighborhood.
 *   * `outside` — unreachable and unvouched.
 */
export type WotBadge =
  | { kind: 'self' }
  | { kind: 'within'; distance: number }
  | { kind: 'vouched'; followersWithin: number }
  | { kind: 'outside' };

/**
 * Map a score to its badge. Returns `undefined` when there is no score yet
 * (graph still loading) — the UI renders nothing rather than a wrong verdict.
 */
export function wotBadge(score: WotScore | undefined): WotBadge | undefined {
  if (!score) return undefined;
  if (score.distance === 0) return { kind: 'self' };
  if (score.distance !== null) return { kind: 'within', distance: score.distance };
  if (score.followersWithin > 0) return { kind: 'vouched', followersWithin: score.followersWithin };
  return { kind: 'outside' };
}

/** Human-readable tooltip for a badge. */
export function wotBadgeLabel(badge: WotBadge): string {
  switch (badge.kind) {
    case 'self':
      return 'This is you';
    case 'within':
      return badge.distance === 1
        ? 'In your web of trust — you follow them'
        : `In your web of trust (${badge.distance} hops)`;
    case 'vouched':
      return `Outside your web of trust — vouched by ${badge.followersWithin} in your network`;
    case 'outside':
      return 'Outside your web of trust';
  }
}
