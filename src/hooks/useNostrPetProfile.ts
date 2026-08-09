import { queryPetsRelay } from '@/pets/core/lib/pets-relay';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useLocalStorage } from './useLocalStorage';
import { useNostrStorage } from './useNostrStorage';
import {
  KIND_NOSTR_PET_PROFILE,
  NOSTR_PET_PROFILE_KINDS,
  PETS_CACHE_KEY,
  getNostrPetProfileQueryDValues,
  isValidNostrPetProfileEvent,
  isLegacyNostrPetProfileKind,
  parseNostrPetProfileEvent,
  type PetsBootCache,
  type NostrPetProfile,
} from '@/pets/core/lib/pets';

/**
 * Hook to fetch and manage the Nostr Pet Profile for the logged-in user.
 * 
 * Features:
 * - localStorage boot cache for instant UI on page load
 * - Fetches from relays with support for both current (11125) and legacy (31125) kinds
 * - Prefers current kind (11125) over legacy kind (31125) when both exist
 * - React Query handles request deduplication via queryKey and staleTime
 * - Provides the parsed profile or null if none exists
 * - Returns `needsKindMigration` flag if profile is on legacy kind
 */
export function useNostrPetProfile() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { store } = useNostrStorage();
  
  // Boot cache in localStorage
  const [bootCache, setBootCache] = useLocalStorage<PetsBootCache | null>(
    PETS_CACHE_KEY,
    null
  );
  
  // Get the cached profile immediately on mount (before async query)
  // Validate that the cache belongs to the current user
  const cachedProfile = useMemo((): NostrPetProfile | null => {
    if (!bootCache || !user?.pubkey) {
      return null;
    }
    
    // Validate cache ownership
    if (bootCache.pubkey !== user.pubkey) {
      return null;
    }
    
    if (!bootCache.profile) {
      return null;
    }
    
    // Verify the cached profile event belongs to the current user
    if (bootCache.profile.event.pubkey !== user.pubkey) {
      return null;
    }
    
    return bootCache.profile;
  }, [bootCache, user?.pubkey]);

  const parsePreferredProfile = useCallback((events: NostrEvent[]): NostrPetProfile | null => {
    const validEvents = events.filter(isValidNostrPetProfileEvent);
    const preferred = validEvents
      .sort((a, b) => {
        const kindPriority = Number(b.kind === KIND_NOSTR_PET_PROFILE) - Number(a.kind === KIND_NOSTR_PET_PROFILE);
        return kindPriority || b.created_at - a.created_at;
      })[0];
    return preferred ? (parseNostrPetProfileEvent(preferred) ?? null) : null;
  }, []);
  
  // Debug logging removed - was causing console flood on every render
  // If debugging is needed, uncomment this block temporarily:
  // if (import.meta.env.DEV) {
  //   console.log('[useNostrPetProfile] Hook state:', {
  //     pubkey: user?.pubkey,
  //     enabled: !!user?.pubkey,
  //     hasCachedProfile: !!cachedProfile,
  //   });
  // }
  
  // Main query to fetch the profile from relays
  const query = useQuery({
    queryKey: ['nostr-pet-profile', user?.pubkey],
    queryFn: async () => {
      if (!user?.pubkey) {
        return null;
      }
      
      // Query with all possible d-tag values (canonical + legacy)
      const dValues = getNostrPetProfileQueryDValues(user.pubkey);
      
      // Query BOTH current (11125) and legacy (31125) kinds for migration support
      const filter = {
        kinds: [...NOSTR_PET_PROFILE_KINDS],
        authors: [user.pubkey],
        '#d': dValues,
      };
      
      const localEvents = await store.query([filter]).catch(() => [] as NostrEvent[]);
      const localProfile = parsePreferredProfile(localEvents);
      const current = queryClient.getQueryData<NostrPetProfile | null>([
        'nostr-pet-profile',
        user.pubkey,
      ]);
      if (!localProfile) return current ?? null;
      return !current || localProfile.event.created_at > current.event.created_at
        ? localProfile
        : current;
    },
    enabled: !!user?.pubkey,
    staleTime: 30_000, // 30 seconds - don't refetch if data is fresh
    gcTime: 5 * 60 * 1000, // 5 minutes garbage collection
    refetchOnWindowFocus: false, // Prevent unnecessary refetches
    refetchOnReconnect: true, // Refetch when connection is restored
    refetchOnMount: 'always', // Always fetch on mount, even with initialData
    retry: false,
    // Use cached profile as initial data for instant UI
    // initialDataUpdatedAt tells React Query when this data was fetched
    // so it knows whether to refetch based on staleTime
    // `null` is real progressive data: it renders the adoption/dashboard
    // shell immediately while IndexedDB and relays refresh in the background.
    // Leaving this undefined makes React Query hold the whole route in its
    // loading skeleton until storage initialization finishes.
    initialData: cachedProfile ?? null,
    initialDataUpdatedAt: cachedProfile ? (bootCache?.cachedAt ?? 0) : undefined,
  });

  // Relay refresh is independent from React Query's local-store request. This
  // prevents either source from overwriting the other when they finish in the
  // opposite order, and keeps both off the first-paint path.
  useEffect(() => {
    if (!user?.pubkey) return;
    const filter = {
      kinds: [...NOSTR_PET_PROFILE_KINDS],
      authors: [user.pubkey],
      '#d': getNostrPetProfileQueryDValues(user.pubkey),
    };
    let cancelled = false;
    void queryPetsRelay(nostr, [filter], {
      signal: AbortSignal.timeout(5_000),
    }).then((relayEvents) => {
      if (cancelled) return;
      const relayProfile = parsePreferredProfile(relayEvents);
      if (!relayProfile) return;
      queryClient.setQueryData<NostrPetProfile | null>(
        ['nostr-pet-profile', user.pubkey],
        (current) => !current || relayProfile.event.created_at > current.event.created_at
          ? relayProfile
          : current,
      );
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [nostr, parsePreferredProfile, queryClient, user?.pubkey]);
  
  // Create stable signature for profile to detect actual changes
  const profileSignature = useMemo(() => {
    const profile = query.data;
    if (!profile) return '';
    return `${profile.d}:${profile.event.created_at}`;
  }, [query.data]);
  
  // Track last synced signature to prevent redundant cache updates
  const lastSyncedSignatureRef = useRef<string>('');
  
  // Update boot cache when we get fresh data from relays
  // FIXED: Moved from useMemo to useEffect - side effects should not be in useMemo
  useEffect(() => {
    // Guard: no data or no user
    if (!query.data || !user?.pubkey) return;
    
    // Guard: data doesn't belong to current user
    if (query.data.event.pubkey !== user.pubkey) return;
    
    // Guard: already synced this exact signature (prevents redundant updates)
    if (lastSyncedSignatureRef.current === profileSignature) return;
    
    // Mark as synced before updating to prevent loops
    lastSyncedSignatureRef.current = profileSignature;
    
    setBootCache(prev => {
      const prevSignature = prev?.profile 
        ? `${prev.profile.d}:${prev.profile.event.created_at}`
        : '';
      
      // Skip update if nothing actually changed
      if (prev?.pubkey === user.pubkey && prevSignature === profileSignature) {
        return prev;
      }
      
      return {
        pubkey: user.pubkey,
        profile: query.data,
        companion: prev?.pubkey === user.pubkey ? (prev.companion ?? null) : null,
        cachedAt: Date.now(),
      };
    });
  }, [profileSignature, user?.pubkey, query.data, setBootCache]);
  
  // Helper to invalidate and refetch after publishing
  const invalidate = useCallback(() => {
    if (user?.pubkey) {
      queryClient.invalidateQueries({ queryKey: ['nostr-pet-profile', user.pubkey] });
    }
  }, [queryClient, user?.pubkey]);
  
  // Update the profile event in the query cache (optimistic update)
  const updateProfileEvent = useCallback((event: NostrEvent) => {
    const parsed = parseNostrPetProfileEvent(event);
    if (parsed && user?.pubkey) {
      queryClient.setQueryData(['nostr-pet-profile', user.pubkey], parsed);
      // Also update boot cache (preserve companions) with stable comparison
      setBootCache(prev => {
        // Check if the profile actually changed
        if (
          prev?.pubkey === user.pubkey &&
          prev.profile?.event.created_at === parsed.event.created_at &&
          prev.profile?.d === parsed.d
        ) {
          return prev; // No change, return same reference
        }
        
        return {
          pubkey: user.pubkey,
          profile: parsed,
          companion: prev?.pubkey === user.pubkey ? (prev.companion ?? null) : null,
          cachedAt: Date.now(),
        };
      });
    }
  }, [queryClient, user?.pubkey, setBootCache]);
  
  // Derive effectiveCompanionD from profile: the explicitly-set
  // `current_companion`, or undefined. We no longer fall back to the profile
  // `has` list — ownership/order is derived from the authored kind 31124
  // collection (useBlobbisCollection), not the redundant `has` mirror.
  const effectiveCompanionD = useMemo(() => {
    const profile = query.data;
    return profile?.currentCompanion;
  }, [query.data]);
  
  // Check if profile needs migration to new kind (11125)
  const needsKindMigration = useMemo(() => {
    const profile = query.data;
    if (!profile) return false;
    return isLegacyNostrPetProfileKind(profile.event);
  }, [query.data]);
  
  return {
    profile: query.data ?? null,
    /** The d-tag of the companion to display (current_companion or first in has[]) */
    effectiveCompanionD,
    /** True only when we have no cached data AND query is loading */
    isLoading: query.isLoading && !cachedProfile,
    /** True when actively fetching (may have cached data displayed) */
    isFetching: query.isFetching,
    /** True when displaying stale data */
    isStale: query.isStale,
    error: query.error,
    invalidate,
    updateProfileEvent,
    /** Whether we're showing cached data while fetching fresh data */
    isFromCache: !!cachedProfile && query.isFetching,
    /** True if profile is on legacy kind (31125) and needs migration to 11125 */
    needsKindMigration,
  };
}
