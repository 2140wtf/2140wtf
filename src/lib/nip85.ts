import type { NostrEvent } from '@nostrify/nostrify';

// ============================================================================
// NIP-85 Trusted Assertions — global Web-of-Trust ranks for the feed filter.
//
// Independent assertion providers (the GrapeRank/Brainstorm family — the same
// scoring lineage Vertex Lab popularized) publish kind-30382 addressable
// events whose `d` tag is the scored pubkey and whose `rank` tag is an
// integer 0..100 global trust rank. A dedicated assertions relay aggregates
// them, so a client can batch-score every author on a feed page with a few
// plain Nostr queries — no API keys, no credits, works for logged-out
// guests.
//
// Multiple providers assert a rank for the same pubkey (they disagree
// slightly), so the score exposed here is the MEDIAN across providers,
// which is robust against a single outlier provider.
//
// Pubkeys with no assertion have no entry in the returned map; callers
// treat them as rank 0 ("unknown") when filtering.
// ============================================================================

/** Primary relay that aggregates NIP-85 trusted assertions from many providers. */
export const NIP85_RELAY = 'wss://nip85.nostr1.com';

/**
 * Relays queried for assertions, most-specific first. The dedicated
 * aggregator is authoritative; general relays replicate many of the same
 * assertions and cover us when the aggregator is down or unreachable.
 */
export const NIP85_RELAYS = [NIP85_RELAY, 'wss://nos.lol'] as const;

/** NIP-85 Trusted Assertion kind. */
export const NIP85_KIND = 30382;

/** Maximum authors scored per feed render — bounds relay filter sizes. */
export const WOT_MAX_AUTHORS = 500;

/** `#d` values per relay filter — keeps each query well under relay limits. */
export const WOT_CHUNK_SIZE = 100;

const HEX_64 = /^[0-9a-f]{64}$/;

/** Median of a non-empty list, rounded to an integer. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value);
}

/**
 * Collapse kind-30382 assertion events into a `Map<pubkey, rank 0..100>`.
 *
 * Malformed events are dropped: wrong kind, missing/invalid `d` tag, or a
 * missing/non-numeric `rank` tag (many assertions carry only stats such as
 * follower counts). Ranks are clamped to 0..100 and the per-pubkey score is
 * the median across provider assertions.
 */
export function parseRankAssertions(events: NostrEvent[]): Map<string, number> {
  const byPubkey = new Map<string, number[]>();

  for (const event of events) {
    if (event.kind !== NIP85_KIND) continue;
    const d = event.tags.find(([name]) => name === 'd')?.[1];
    if (!d || !HEX_64.test(d)) continue;
    const rankRaw = event.tags.find(([name]) => name === 'rank')?.[1];
    if (rankRaw === undefined) continue;
    const rank = Number(rankRaw);
    if (!Number.isFinite(rank)) continue;
    const clamped = Math.min(100, Math.max(0, Math.round(rank)));
    const list = byPubkey.get(d);
    if (list) {
      list.push(clamped);
    } else {
      byPubkey.set(d, [clamped]);
    }
  }

  const result = new Map<string, number>();
  for (const [pubkey, ranks] of byPubkey) {
    result.set(pubkey, median(ranks));
  }
  return result;
}

/** Split a pubkey list into fixed-size chunks for batched `#d` filters. */
export function chunkPubkeys(pubkeys: string[], size: number = WOT_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < pubkeys.length; i += size) {
    chunks.push(pubkeys.slice(i, i + size));
  }
  return chunks;
}
