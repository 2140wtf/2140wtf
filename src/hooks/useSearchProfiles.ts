import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NSchema as n } from '@nostrify/nostrify';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { useFollowList } from '@/hooks/useFollowActions';
import { useDebounce } from '@/hooks/useDebounce';

export interface SearchProfile {
  pubkey: string;
  metadata: NostrMetadata;
  event: NostrEvent;
}

/** Score how well a profile matches a lowercase query. Higher is better. */
function matchScore(profile: SearchProfile, query: string): number {
  const name = profile.metadata.name?.toLowerCase() ?? '';
  const displayName = profile.metadata.display_name?.toLowerCase() ?? '';
  const nip05 = profile.metadata.nip05?.toLowerCase() ?? '';

  // Exact match is best
  if (name === query || displayName === query || nip05 === query) return 100;
  // Prefix match is next
  if (name.startsWith(query) || displayName.startsWith(query) || nip05.startsWith(query)) return 80;
  // Word-boundary prefix match
  const hasWordBoundary = (s: string) => s.split(/\s+/).some((word) => word.startsWith(query));
  if (hasWordBoundary(name) || hasWordBoundary(displayName) || hasWordBoundary(nip05)) return 60;
  // Contains match
  if (name.includes(query) || displayName.includes(query) || nip05.includes(query)) return 40;
  return 0;
}

/**
 * Search cached author profiles in the TanStack Query cache.
 * Scans all ['author', pubkey] entries for name/display_name/nip05 matches.
 */
function searchCachedProfiles(
  queryClient: ReturnType<typeof useQueryClient>,
  query: string,
  followedPubkeys: Set<string>,
  limit: number = 50,
): SearchProfile[] {
  const lowerQuery = query.toLowerCase();
  const results: SearchProfile[] = [];

  const cache = queryClient.getQueryCache().findAll({ queryKey: ['author'] });

  for (const entry of cache) {
    const data = entry.state.data as { event?: NostrEvent; metadata?: NostrMetadata } | undefined;
    if (!data?.event || !data?.metadata) continue;

    const { metadata, event } = data;
    const name = metadata.name?.toLowerCase() ?? '';
    const displayName = metadata.display_name?.toLowerCase() ?? '';
    const nip05 = metadata.nip05?.toLowerCase() ?? '';

    if (name.includes(lowerQuery) || displayName.includes(lowerQuery) || nip05.includes(lowerQuery)) {
      results.push({ pubkey: event.pubkey, metadata, event });
    }
  }

  // Sort: followed first, then alphabetical by name
  results.sort((a, b) => {
    const aFollowed = followedPubkeys.has(a.pubkey) ? 0 : 1;
    const bFollowed = followedPubkeys.has(b.pubkey) ? 0 : 1;
    if (aFollowed !== bFollowed) return aFollowed - bFollowed;
    const aName = (a.metadata.name || a.metadata.display_name || '').toLowerCase();
    const bName = (b.metadata.name || b.metadata.display_name || '').toLowerCase();
    return aName.localeCompare(bName);
  });

  return results.slice(0, limit);
}

/** Search for profiles by username/nip05 using NIP-50 search on 2140.wtf relays. */
export function useSearchProfiles(query: string) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { data: followData } = useFollowList();
  const followedPubkeys = useMemo(
    () => new Set(followData?.pubkeys ?? []),
    [followData?.pubkeys],
  );

  // Debounce the query so we don't hammer the relay on every keystroke
  const debouncedQuery = useDebounce(query, 300);

  const relayResults = useQuery<SearchProfile[]>({
    queryKey: ['search-profiles', debouncedQuery],
    queryFn: async ({ signal }) => {
      if (!debouncedQuery.trim()) return [];

      // NIP-50 profile search (uses pool, reuses existing connections).
      // `autocomplete:true` asks relays to match the query as a prefix against
      // short, name-shaped fields (name/display_name/nip05) instead of full-text
      // content — exactly what a typeahead dropdown wants. Relays that don't
      // support the extension simply ignore the token.
      const events = await nostr.query(
        [{ kinds: [0], search: `${debouncedQuery.trim()} autocomplete:true sort:top`, limit: 20 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );

      const profiles: SearchProfile[] = [];

      for (const event of events) {
        try {
          const metadata = n.json().pipe(n.metadata()).parse(event.content);
          profiles.push({ pubkey: event.pubkey, metadata, event });
        } catch {
          // Skip invalid metadata
        }
      }

      // Deduplicate by pubkey (keep latest event)
      const seen = new Map<string, SearchProfile>();
      for (const profile of profiles) {
        const existing = seen.get(profile.pubkey);
        if (!existing || profile.event.created_at > existing.event.created_at) {
          seen.set(profile.pubkey, profile);
        }
      }

      return Array.from(seen.values());
    },
    enabled: debouncedQuery.trim().length >= 1,
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
  });

  // Merge relay results with cached author profiles. Relays may miss an
  // account or rank it below the top N, so scanning the local cache ensures
  // accounts the app has already loaded still surface. Results are deduped
  // by pubkey and ranked by follow status + match quality.
  const data = useMemo(() => {
    const relayData = relayResults.data ?? [];
    const query = debouncedQuery.trim().toLowerCase();

    const cachedData = query.length >= 1
      ? searchCachedProfiles(queryClient, debouncedQuery.trim(), followedPubkeys)
      : [];

    // Deduplicate by pubkey, keeping the latest kind-0 event.
    const merged = new Map<string, SearchProfile>();
    for (const profile of [...relayData, ...cachedData]) {
      const existing = merged.get(profile.pubkey);
      if (!existing || profile.event.created_at > existing.event.created_at) {
        merged.set(profile.pubkey, profile);
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => {
        const aFollowed = followedPubkeys.has(a.pubkey) ? 0 : 1;
        const bFollowed = followedPubkeys.has(b.pubkey) ? 0 : 1;
        if (aFollowed !== bFollowed) return aFollowed - bFollowed;

        const aScore = matchScore(a, query);
        const bScore = matchScore(b, query);
        if (bScore !== aScore) return bScore - aScore;

        const aName = (a.metadata.name || a.metadata.display_name || '').toLowerCase();
        const bName = (b.metadata.name || b.metadata.display_name || '').toLowerCase();
        return aName.localeCompare(bName);
      })
      .slice(0, 10);
  }, [relayResults.data, followedPubkeys, debouncedQuery, queryClient]);

  return {
    ...relayResults,
    data,
    followedPubkeys,
  };
}

/** Whether a profile matches a lowercase query by name/display_name/nip05. */
function profileMatches(p: SearchProfile, query: string): boolean {
  const name = p.metadata.name?.toLowerCase() ?? '';
  const displayName = p.metadata.display_name?.toLowerCase() ?? '';
  const nip05 = p.metadata.nip05?.toLowerCase() ?? '';
  return name.includes(query) || displayName.includes(query) || nip05.includes(query);
}

/**
 * Resolve a fixed set of pubkeys (e.g. a ₿AO chat channel's members) to
 * profiles for the @-mention autocomplete, filtered by `query`. Reads cached
 * author metadata from the Query cache; pubkeys without cached metadata still
 * appear (matched by their npub/hex) so any member can be mentioned. Used to
 * scope the mention menu to people in the room instead of searching all of
 * Nostr.
 */
export function useMemberProfiles(pubkeys: string[], query: string) {
  const queryClient = useQueryClient();

  return useMemo<SearchProfile[]>(() => {
    const lowerQuery = query.trim().toLowerCase();

    const profiles: SearchProfile[] = pubkeys.map((pubkey) => {
      const entry = queryClient
        .getQueryCache()
        .find({ queryKey: ['author', pubkey] });
      const data = entry?.state.data as
        | { event?: NostrEvent; metadata?: NostrMetadata }
        | undefined;
      return {
        pubkey,
        metadata: data?.metadata ?? {},
        event: data?.event ?? ({ pubkey, tags: [], content: '', kind: 0, created_at: 0, id: '', sig: '' } as NostrEvent),
      };
    });

    const matched = lowerQuery
      ? profiles.filter(
          (p) => profileMatches(p, lowerQuery) || p.pubkey.startsWith(lowerQuery),
        )
      : profiles;

    matched.sort((a, b) => {
      const aName = (a.metadata.name || a.metadata.display_name || a.pubkey).toLowerCase();
      const bName = (b.metadata.name || b.metadata.display_name || b.pubkey).toLowerCase();
      return aName.localeCompare(bName);
    });

    return matched.slice(0, 10);
  }, [pubkeys, query, queryClient]);
}
