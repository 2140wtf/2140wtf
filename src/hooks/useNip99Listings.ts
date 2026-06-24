import { type NostrEvent, type NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { NIP99_RELAYS } from '@/lib/appRelays';
import { dedupeNip99Listings, isArtListing, NIP99_CLASSIFIED_KIND } from '@/lib/nip99';

const QUERY_LIMIT = 500;
const LOOKBACK_DAYS = 180;
const DEFAULT_TIMEOUT_MS = 10_000;
const EXTRA_TIMEOUT_MS = 12_000;

export type Nip99Category = 'art' | 'all' | string;

export interface UseNip99ListingsOptions {
  category?: Nip99Category;
  search?: string;
  onlyActive?: boolean;
  /** How far back to look, in days. Default 180. */
  lookbackDays?: number;
  /** Maximum events to fetch per relay set. Default 500. */
  limit?: number;
}

function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

function categoryTag(category: string): string | undefined {
  // 'all' and 'art' are matched locally: 'art' uses a broad text/tag matcher
  // so we don't miss listings tagged "bitcoinart", "digitalart", etc.
  if (category === 'all' || category === 'art') {
    return undefined;
  }
  return category.toLowerCase();
}

export function useNip99Listings(options: UseNip99ListingsOptions = {}) {
  const { category = 'all', search = '', onlyActive = true } = options;
  const lookbackDays = options.lookbackDays ?? LOOKBACK_DAYS;
  const limit = options.limit ?? QUERY_LIMIT;
  const { nostr } = useNostr();
  const { config } = useAppContext();

  const readRelays = config.relayMetadata.relays
    .filter((r) => r.read)
    .map((r) => r.url);
  const normalizedRead = new Set(readRelays.map(normalizeUrl));
  const extraRelays = NIP99_RELAYS.filter(
    (url) => !normalizedRead.has(normalizeUrl(url)),
  );

  const queryKey = useMemo(
    () => ['nip99-listings', 'feed', category.toLowerCase(), lookbackDays, limit],
    [category, lookbackDays, limit],
  );

  const { data: rawEvents = [], isLoading, error, refetch } = useQuery<NostrEvent[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const since = Math.floor(Date.now() / 1000) - 86400 * lookbackDays;
      const relayFilter: NostrFilter = {
        kinds: [NIP99_CLASSIFIED_KIND],
        limit,
        since,
      };
      const tag = categoryTag(category);
      if (tag) {
        relayFilter['#t'] = [tag];
      }

      const defaultSignal = AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]);
      const defaultResults = await nostr.query([relayFilter], { signal: defaultSignal });

      let extraResults: NostrEvent[] = [];
      if (extraRelays.length > 0) {
        try {
          const extraSignal = AbortSignal.any([signal, AbortSignal.timeout(EXTRA_TIMEOUT_MS)]);
          extraResults = await nostr
            .group(extraRelays)
            .query([relayFilter], { signal: extraSignal });
        } catch {
          // best-effort: extra relays are not required
        }
      }

      const all = new Map<string, NostrEvent>();
      for (const ev of defaultResults) all.set(ev.id, ev);
      for (const ev of extraResults) all.set(ev.id, ev);
      return Array.from(all.values()).sort((a, b) => b.created_at - a.created_at);
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000,
  });

  const listings = useMemo(() => {
    let items = dedupeNip99Listings(rawEvents);

    if (category === 'art') {
      items = items.filter(isArtListing);
    } else if (category && category !== 'all') {
      const tag = category.toLowerCase();
      items = items.filter((l) => l.categories.includes(tag));
    }

    if (onlyActive) {
      items = items.filter((l) => l.status === 'active');
    }

    const q = normalizeSearch(search);
    if (q) {
      items = items.filter((l) => {
        const hay = normalizeSearch(`${l.title} ${l.summary} ${l.content} ${l.categories.join(' ')} ${l.location ?? ''}`);
        return hay.includes(q);
      });
    }

    return items;
  }, [rawEvents, category, onlyActive, search]);

  return {
    listings,
    isLoading,
    error: error ? (error instanceof Error ? error.message : 'Failed to load marketplace listings') : null,
    refetch,
  };
}
