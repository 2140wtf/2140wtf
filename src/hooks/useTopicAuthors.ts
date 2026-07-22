import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { FeedTopic } from '@/lib/feedTopics';
import type { NostrFilter } from '@nostrify/nostrify';

/**
 * How far back to look when discovering active topic authors.
 * A week keeps the list fresh while limiting relay load.
 */
const DISCOVERY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/** Maximum events to fetch per topic discovery query. */
const DISCOVERY_LIMIT = 1500;

/** Maximum authors to return per topic feed. */
const MAX_AUTHORS = 100;

/**
 * Discover the most active authors for a feed topic.
 *
 * - Topics with `#t` tags: query recent kind-1 events tagged with any of the
 *   topic tags, group by pubkey, score by count + recency, and return the top
 *   100 pubkeys.
 * - Topics without tags (e.g. BAO) but with a static `authors` list: return the
 *   static list unchanged so the tab still works.
 *
 * Results are cached for 10 minutes because author rankings change slowly.
 */
export function useTopicAuthors(topic: FeedTopic | null) {
  const { nostr } = useNostr();

  return useQuery<string[], Error>({
    queryKey: ['topic-authors', topic?.id],
    queryFn: async ({ signal }) => {
      if (!topic) return [];

      // Static-author topics without tags (e.g. BAO) bypass discovery.
      if (topic.tags.length === 0) {
        return topic.authors ?? [];
      }

      const now = Math.floor(Date.now() / 1000);
      const since = now - DISCOVERY_WINDOW_SECONDS;
      const tags = topic.tags.map((t) => t.toLowerCase());

      const filter: NostrFilter = {
        kinds: [1],
        '#t': tags,
        since,
        limit: DISCOVERY_LIMIT,
      };

      const events = await nostr.query([filter], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });

      const stats = new Map<string, { count: number; latest: number }>();
      for (const event of events) {
        const entry = stats.get(event.pubkey) ?? { count: 0, latest: event.created_at };
        entry.count += 1;
        if (event.created_at > entry.latest) {
          entry.latest = event.created_at;
        }
        stats.set(event.pubkey, entry);
      }

      const scored = [...stats.entries()].map(([pubkey, { count, latest }]) => {
        const age = now - latest;
        let recency = 0;
        if (age < 24 * 60 * 60) {
          recency = 50;
        } else if (age < 3 * 24 * 60 * 60) {
          recency = 20;
        } else if (age < 7 * 24 * 60 * 60) {
          recency = 5;
        }
        return { pubkey, score: count * 10 + recency };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, MAX_AUTHORS).map(({ pubkey }) => pubkey);
    },
    enabled: !!topic,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
