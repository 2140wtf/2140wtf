import { type NostrEvent, type NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { NIP99_RELAYS } from '@/lib/appRelays';
import { dedupeNip99Listings, isArtListing, NIP99_CLASSIFIED_KIND } from '@/lib/nip99';

const QUERY_LIMIT = 500;
const LOOKBACK_DAYS = 180;
// Round 36: hard ceilings for caller-supplied query options. `limit: 100000`
// asks each relay set for 100k events (memory + aggregation cost), while an
// absurd `lookbackDays` overflows `86400 * days` into a `-Infinity` `since`
// that makes relays scan their whole store.
const MAX_QUERY_LIMIT = 2_000;
const MAX_LOOKBACK_DAYS = 3_650;

/**
 * Clamp caller-supplied query options to safe ranges (round 36).
 * Exported for testing.
 */
export function clampNip99QueryOptions(options: UseNip99ListingsOptions): { lookbackDays: number; limit: number } {
  const rawDays = options.lookbackDays ?? LOOKBACK_DAYS;
  const rawLimit = options.limit ?? QUERY_LIMIT;
  const lookbackDays = Number.isFinite(rawDays)
    ? Math.max(0, Math.min(MAX_LOOKBACK_DAYS, Math.floor(rawDays)))
    : LOOKBACK_DAYS;
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.floor(rawLimit)))
    : QUERY_LIMIT;
  return { lookbackDays, limit };
}

// Round 36: categories ride into the relay `#t` filter and the react-query
// key — cap at 64 chars (matches the per-category cap in parseNip99Listing)
// so a hostile caller cannot bloat either.
const MAX_CATEGORY_LENGTH = 64;

export function clampNip99Category(category: string): string {
  return category.toLowerCase().slice(0, MAX_CATEGORY_LENGTH);
}
/**
 * Relay queries resolve when relays EOSE or the timeout fires — so the
 * timeout IS the perceived load time. Keep it tight: the fastest relays
 * answer well under a second, and anything slower is not worth waiting for
 * on first paint. Default and extra relay sets run in parallel.
 */
const DEFAULT_TIMEOUT_MS = 3_000;
const EXTRA_TIMEOUT_MS = 3_500;

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
  // Round 36: clamp caller-supplied ranges before they reach the relay or
  // the query key.
  const { lookbackDays, limit } = clampNip99QueryOptions(options);
  const clampedCategory = clampNip99Category(category);
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
    () => ['nip99-listings', 'feed', clampedCategory, lookbackDays, limit],
    [clampedCategory, lookbackDays, limit],
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
      const tag = categoryTag(clampedCategory);
      if (tag) {
        relayFilter['#t'] = [tag];
      }

      // Run both relay sets in parallel — the extra-relay query used to run
      // strictly after the default one, which doubled the time to first card.
      const defaultSignal = AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]);
      const defaultPromise = nostr.query([relayFilter], { signal: defaultSignal });

      const extraPromise =
        extraRelays.length > 0
          ? nostr
              .group(extraRelays)
              .query([relayFilter], {
                signal: AbortSignal.any([signal, AbortSignal.timeout(EXTRA_TIMEOUT_MS)]),
              })
              .catch(() => [] as NostrEvent[]) // best-effort: extra relays are not required
          : Promise.resolve([] as NostrEvent[]);

      const [defaultResults, extraResults] = await Promise.all([defaultPromise, extraPromise]);

      const all = new Map<string, NostrEvent>();
      for (const ev of defaultResults) all.set(ev.id, ev);
      for (const ev of extraResults) all.set(ev.id, ev);
      return Array.from(all.values()).sort((a, b) => b.created_at - a.created_at);
    },
    staleTime: 10 * 60 * 1000, // 10 minutes — revisits render instantly from cache
    gcTime: 30 * 60 * 1000,
  });

  const listings = useMemo(() => {
    let items = dedupeNip99Listings(rawEvents);

    if (clampedCategory === 'art') {
      items = items.filter(isArtListing);
    } else if (clampedCategory && clampedCategory !== 'all') {
      const tag = clampedCategory;
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
  }, [rawEvents, clampedCategory, onlyActive, search]);

  return {
    listings,
    isLoading,
    error: error ? (error instanceof Error ? error.message : 'Failed to load marketplace listings') : null,
    refetch,
  };
}
