import { queryPetsRelay } from '@/pets/core/lib/pets-relay';
import { useCallback, useEffect, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrStorage } from '@/hooks/useNostrStorage';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { useAppContext } from '@/hooks/useAppContext';
import { getEffectiveRelays } from '@/lib/appRelays';
import {
  KIND_PETS_STATE,
  PETS_ECOSYSTEM_NAMESPACE,
  isValidPetsEvent,
  parsePetsEvent,
  type PetsCompanion,
} from '../lib/pets';

/** Maximum number of d-tags per query chunk to avoid relay issues */
const CHUNK_SIZE = 20;
const PETS_READ_TIMEOUT_MS = 1_000;

type PetsCollectionData = {
  companionsByD: Record<string, PetsCompanion>;
  companions: PetsCompanion[];
};

/**
 * Event ids already re-broadcast this session (repatriation pass).
 * Module-scoped so every collection consumer shares the dedupe.
 */
const repatriatedEventIds = new Set<string>();
const failedRepatriationEventIds = new Set<string>();

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

/** Parse, validate, and deduplicate a set of authored pet-state events. */
function buildPetsCollection(events: NostrEvent[]): PetsCollectionData {
  const eventsByD = new Map<string, NostrEvent>();

  for (const event of events.filter(isValidPetsEvent)) {
    const dTag = event.tags.find(([name]) => name === 'd')?.[1];
    if (!dTag) continue;
    const existing = eventsByD.get(dTag);
    if (!existing || event.created_at > existing.created_at) eventsByD.set(dTag, event);
  }

  const companionsByD: Record<string, PetsCompanion> = {};
  for (const [dTag, event] of eventsByD) {
    const parsed = parsePetsEvent(event);
    if (parsed) companionsByD[dTag] = parsed;
  }

  return { companionsByD, companions: Object.values(companionsByD) };
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
  const { store } = useNostrStorage();
  
  // Determine the mode: 'all' fetches everything, 'dlist' fetches by specific d-tags
  const mode = dList === undefined ? 'all' : 'dlist';
  
  // Create a stable query key based on sorted d-tags (for dlist mode)
  const sortedDList = useMemo(() => {
    if (mode === 'all' || !dList || dList.length === 0) return null;
    return [...dList].sort();
  }, [mode, dList]);
  
  // Query key segment: 'all' for fetch-all mode, comma-joined d-tags for dlist mode
  const queryKeySegment = mode === 'all' ? 'all' : (sortedDList?.join(',') ?? '');
  const queryKey = useMemo(
    () => ['pets-collection', user?.pubkey, queryKeySegment] as const,
    [user?.pubkey, queryKeySegment],
  );

  const collectionFilters = useMemo(() => {
    if (!user?.pubkey) return [];
    if (mode === 'all') {
      return [{
        kinds: [KIND_PETS_STATE],
        authors: [user.pubkey],
        '#b': [PETS_ECOSYSTEM_NAMESPACE],
      }];
    }
    if (!sortedDList?.length) return [];
    return chunkArray(sortedDList, CHUNK_SIZE).map((chunk) => ({
      kinds: [KIND_PETS_STATE],
      authors: [user.pubkey],
      '#d': chunk,
    }));
  }, [mode, sortedDList, user?.pubkey]);

  // Main query to fetch companions from relays
  const query = useQuery({
    queryKey: ['pets-collection', user?.pubkey, queryKeySegment],
    queryFn: async () => {
      if (!user?.pubkey) {
        console.log('[usePetssCollection] No pubkey, returning empty');
        return { companionsByD: {}, companions: [] };
      }

      // A genuine refetch is the retry boundary for failed re-broadcasts.
      const existing = queryClient.getQueryData<PetsCollectionData>(queryKey);
      for (const companion of existing?.companions ?? []) {
        failedRepatriationEventIds.delete(companion.event.id);
      }
      
      const cachedEvents = collectionFilters.length > 0
        ? await store.query(collectionFilters).catch(() => [] as NostrEvent[])
        : [];
      const current = queryClient.getQueryData<PetsCollectionData>(queryKey);
      const currentEvents = current?.companions.map((companion) => companion.event) ?? [];
      return buildPetsCollection([...currentEvents, ...cachedEvents]);
    },
    enabled: !!user?.pubkey && (mode === 'all' || (!!sortedDList && sortedDList.length > 0)),
    staleTime: 30_000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: false,
    // Render the page shell immediately. The query replaces this with the
    // IndexedDB collection and then the detached relay refresh.
    initialData: { companionsByD: {}, companions: [] },
    initialDataUpdatedAt: 0,
  });

  // Refresh relays independently of the local-store query. Both can update
  // the same progressive cache without either being on the render path.
  useEffect(() => {
    if (!user?.pubkey || collectionFilters.length === 0) return;
    let cancelled = false;
    void (async () => {
      const relayEvents: NostrEvent[] = [];
      for (const filter of collectionFilters) {
        const events = await queryPetsRelay(nostr, [filter], {
          signal: AbortSignal.timeout(PETS_READ_TIMEOUT_MS),
        }).catch(() => [] as NostrEvent[]);
        relayEvents.push(...events);
      }
      if (cancelled || relayEvents.length === 0) return;
      queryClient.setQueryData<PetsCollectionData>(queryKey, (current) => {
        const currentEvents = current?.companions.map((companion) => companion.event) ?? [];
        return buildPetsCollection([...currentEvents, ...relayEvents]);
      });
    })();
    return () => { cancelled = true; };
  }, [collectionFilters, nostr, queryClient, queryKey, user?.pubkey]);
  
  // ─── Repatriation pass ─────────────────────────────────────────────────────
  // Pet events published while a relay was (temporarily) in the effective set
  // can end up stranded on relays the current build no longer reads — e.g.
  // events written to the BAO test relay from a dev build are invisible to
  // production builds, which exclude it. The profile's has[] then lists pets
  // the collection can never see ("one pet shows up, can't switch"). Any
  // client that CAN read them (dev builds, other apps) heals this by
  // re-broadcasting the user's own already-signed events to its pool: relays
  // that already have an event dedupe it by id, relays missing it store it.
  // Gated by the pets publish preference; once per session per event id.
  const { isEnabled } = usePublishPreferences();
  const petsPublishEnabled = isEnabled('pets');
  const fetchedCompanions = query.data?.companions;
  const { config } = useAppContext();

  useEffect(() => {
    if (!petsPublishEnabled || !user?.pubkey || !fetchedCompanions) return;
    const relayUrls = getEffectiveRelays(config.relayMetadata, config.useAppRelays, config.useUserRelays)
      .relays.map((r) => r.url);
    if (relayUrls.length === 0) return;
    for (const companion of fetchedCompanions) {
      const event = companion.event;
      if (!event || repatriatedEventIds.has(event.id) || failedRepatriationEventIds.has(event.id)) continue;
      repatriatedEventIds.add(event.id);
      nostr.group(relayUrls).event(event, { signal: AbortSignal.timeout(10_000) }).catch((err) => {
        // Retry on the next genuine query refetch, not on incidental cache
        // merges from the parallel IndexedDB/relay restoration paths.
        repatriatedEventIds.delete(event.id);
        failedRepatriationEventIds.add(event.id);
        console.warn('[usePetssCollection] repatriation publish failed:', err);
      });
    }
  }, [fetchedCompanions, petsPublishEnabled, user?.pubkey, nostr, config.relayMetadata, config.useAppRelays, config.useUserRelays, query.isFetching]);

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
