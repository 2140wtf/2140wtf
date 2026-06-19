import { type NostrEvent, type NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { dedupeNip99Listings, isArtListing, NIP99_CLASSIFIED_KIND } from '@/lib/nip99';

const QUERY_LIMIT = 200;
const QUERY_TIMEOUT_MS = 15_000;

export type Nip99Category = 'art' | 'all' | string;

export interface UseNip99ListingsOptions {
  category?: Nip99Category;
  search?: string;
  onlyActive?: boolean;
}

function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function useNip99Listings(options: UseNip99ListingsOptions = {}) {
  const { category = 'all', search = '', onlyActive = true } = options;
  const { nostr } = useNostr();

  const relayFilter = useMemo<NostrFilter>(() => {
    const filter: NostrFilter = {
      kinds: [NIP99_CLASSIFIED_KIND],
      limit: QUERY_LIMIT,
    };
    if (category && category !== 'all') {
      filter['#t'] = [category.toLowerCase()];
    }
    return filter;
  }, [category]);

  const queryKey = useMemo(
    () => ['nip99-listings', category.toLowerCase()],
    [category],
  );

  const { data: rawEvents = [], isLoading, error, refetch } = useQuery<NostrEvent[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
      if (signal) {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      try {
        return await nostr.query([relayFilter], { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000,
  });

  const listings = useMemo(() => {
    let items = dedupeNip99Listings(rawEvents);

    if (category === 'art') {
      items = items.filter(isArtListing);
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
