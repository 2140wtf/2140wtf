import { queryPetsRelay } from '@/pets/core/lib/pets-relay';
import { useCallback, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  KIND_PETS_STATE,
  PETS_ECOSYSTEM_NAMESPACE,
  isValidPetsEvent,
  parsePetsEvent,
  type PetsCompanion,
} from '../lib/pets';

/** Maximum number of d-tags per query chunk to avoid relay issues */
const CHUNK_SIZE = 20;

/**
 * Split an array into chunks of a given size.
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Hook to fetch Pets companions (Kind 31124) owned by the logged-in user.
 * 
 * Two modes:
 * - **No dList** (default): Fetches ALL the user's pets events by author +
 *   ecosystem namespace tag. This is the authoritative source of truth —
 *   the user authored these events, so we don't need a secondary index.
 * - **With dList**: Fetches only the specified d-tags. Use this when you only
 *   need a specific subset (e.g. the companion layer needs just one pets).
 * 
 * Features:
 * - Chunks large d-lists into multiple queries for relay compatibility
 * - Keeps only the newest event per d-tag
 * - Returns both a lookup record and array of companions
 * - Provides invalidation and optimistic update helpers
 */
export function usePetssCollection(dList?: string[] | undefined) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  
  // Determine the mode: 'all' fetches everything, 'dlist' fetches by specific d-tags
  const mode = dList === undefined ? 'all' : 'dlist';
  
  // Create a stable query key based on sorted d-tags (for dlist mode)
  const sortedDList = useMemo(() => {
    if (mode === 'all' || !dList || dList.length === 0) return null;
    return [...dList].sort();
  }, [mode, dList]);
  
  // Query key segment: 'all' for fetch-all mode, comma-joined d-tags for dlist mode
  const queryKeySegment = mode === 'all' ? 'all' : (sortedDList?.join(',') ?? '');
  
  // Main query to fetch companions from relays
  const query = useQuery({
    queryKey: ['pets-collection', user?.pubkey, queryKeySegment],
    queryFn: async ({ signal }) => {
      if (!user?.pubkey) {
        console.log('[usePetssCollection] No pubkey, returning empty');
        return { companionsByD: {}, companions: [] };
      }
      
      let allEvents: NostrEvent[];
      
      if (mode === 'all') {
        // Fetch ALL the user's pets events — author is the source of truth
        const filter = {
          kinds: [KIND_PETS_STATE],
          authors: [user.pubkey],
          '#b': [PETS_ECOSYSTEM_NAMESPACE],
        };
        
        console.log('[Pets] 31124 query filter (all):', JSON.stringify(filter, null, 2));
        
        allEvents = await queryPetsRelay(nostr, [filter], { signal });
        
        console.log('[usePetssCollection] Fetch-all returned', allEvents.length, 'events');
      } else {
        // Fetch by specific d-tags (for companion layer etc.)
        if (!sortedDList || sortedDList.length === 0) {
          console.log('[usePetssCollection] Empty dList, returning empty');
          return { companionsByD: {}, companions: [] };
        }
        
        console.log('[Pets] dList:', sortedDList);
        
        const chunks = chunkArray(sortedDList, CHUNK_SIZE);
        console.log('[usePetssCollection] Splitting into', chunks.length, 'chunk(s)');
        
        allEvents = [];
        
        for (const chunk of chunks) {
          const filter = {
            kinds: [KIND_PETS_STATE],
            authors: [user.pubkey],
            '#d': chunk,
          };
          
          console.log('[Pets] 31124 query filter:', JSON.stringify(filter, null, 2));
          
          const events = await queryPetsRelay(nostr, [filter], { signal });
          allEvents.push(...events);
          
          console.log('[usePetssCollection] Chunk returned', events.length, 'events');
        }
      }
      
      console.log('[usePetssCollection] Total events received:', allEvents.length);
      
      // Filter to valid events
      const validEvents = allEvents.filter(isValidPetsEvent);
      
      console.log('[usePetssCollection] Valid events:', validEvents.length);
      
      // Group events by d-tag and keep only the newest per d
      const eventsByD = new Map<string, NostrEvent>();
      
      for (const event of validEvents) {
        const dTag = event.tags.find(([name]) => name === 'd')?.[1];
        if (!dTag) continue;
        
        const existing = eventsByD.get(dTag);
        if (!existing || event.created_at > existing.created_at) {
          eventsByD.set(dTag, event);
        }
      }
      
      // Parse all events into PetsCompanion objects
      const companionsByD: Record<string, PetsCompanion> = {};
      const companions: PetsCompanion[] = [];
      
      for (const [dTag, event] of eventsByD) {
        const parsed = parsePetsEvent(event);
        if (parsed) {
          companionsByD[dTag] = parsed;
          companions.push(parsed);
        }
      }
      
      console.log('[usePetssCollection] Parsed companions:', {
        count: companions.length,
        dTags: Object.keys(companionsByD),
      });
      
      return { companionsByD, companions };
    },
    enabled: !!user?.pubkey && (mode === 'all' || (!!sortedDList && sortedDList.length > 0)),
    staleTime: 30_000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
  
  // Helper to invalidate and refetch after publishing.
  // NOTE: In most mutation paths this is no longer needed — the read-modify-write
  // pattern (fetch fresh → mutate → optimistic update) keeps the cache correct.
  // Only call this when the set of d-tags itself changes (e.g. adoption, deletion).
  const invalidate = useCallback(() => {
    if (user?.pubkey) {
      queryClient.invalidateQueries({
        queryKey: ['pets-collection', user.pubkey, queryKeySegment],
      });
    }
  }, [queryClient, user?.pubkey, queryKeySegment]);
  
  // Update a single companion event in the query cache (optimistic update).
  // CRITICAL: Updates ALL pets-collection queries for this user, not just the
  // one matching the current queryKeySegment. This ensures the PetsPage cache
  // and companion layer cache stay in sync (they use different query modes).
  const updateCompanionEvent = useCallback((event: NostrEvent) => {
    const parsed = parsePetsEvent(event);
    if (!parsed || !user?.pubkey) return;
    
    type CollectionData = { companionsByD: Record<string, PetsCompanion>; companions: PetsCompanion[] };
    const matchingQueries = queryClient.getQueriesData<CollectionData>({
      queryKey: ['pets-collection', user.pubkey],
    });

    for (const [queryKey, data] of matchingQueries) {
      if (!data) continue;
      const newCompanionsByD = { ...data.companionsByD, [parsed.d]: parsed };
      queryClient.setQueryData<CollectionData>(queryKey, {
        companionsByD: newCompanionsByD,
        companions: Object.values(newCompanionsByD),
      });
    }

    // If no existing queries matched (first load), set our own query key
    if (matchingQueries.length === 0) {
      queryClient.setQueryData<CollectionData>(
        ['pets-collection', user.pubkey, queryKeySegment],
        {
          companionsByD: { [parsed.d]: parsed },
          companions: [parsed],
        },
      );
    }
  }, [queryClient, user?.pubkey, queryKeySegment]);
  
  // Memoize return values for stability
  const companionsByD = query.data?.companionsByD ?? {};
  const companions = query.data?.companions ?? [];
  
  return {
    /** Record of companions keyed by d-tag */
    companionsByD,
    /** Array of all companions (newest per d-tag) */
    companions,
    /** True only when query is loading and no data available */
    isLoading: query.isLoading,
    /** True when actively fetching */
    isFetching: query.isFetching,
    /** True when data is stale */
    isStale: query.isStale,
    /** Query error if any */
    error: query.error,
    /** Invalidate and refetch the collection (use only when d-tag set changes, not after mutations) */
    invalidate,
    /** Optimistically update a single companion in the cache */
    updateCompanionEvent,
  };
}
