import { useNostr } from '@nostrify/react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from './useAppContext';
import { useCurrentUser } from './useCurrentUser';
import { useFeedSettings } from './useFeedSettings';
import { useFollowList } from './useFollowActions';
import { useLoveList } from './useLoveList';
import { useMutedAuthorFilter } from './useMutedAuthorFilter';
import { parseAuthorEvent } from './useAuthor';
import { useNostrStorage } from './useNostrStorage';
import { getEnabledFeedKinds } from '@/lib/extraKinds';
import {
  getPaginationCursor,
  isRepostKind,
  isReactionKind,
  isZapKind,
  isMastodonBridgeEvent,
  isBlockedFeedDomainEvent,
  isBlockedFeedDomainIdentifier,
  buildFeedItems,
  dedupeFeedItems,
  filterCoordinatedDuplicateSpamEvents,
  type FeedItem,
} from '@/lib/feedUtils';
import { isReplyEvent } from '@/lib/nostrEvents';
import { getStorageKey } from '@/lib/storageKey';
import { FEED_TOPICS } from '@/lib/feedTopics';
import { interleaveFeedAuthors } from '@/lib/feedDiversity';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

const PAGE_SIZE = 15;
const GUEST_DISCOVERY_PAGE_SIZE = 30;

/**
 * Over-fetch multiplier: when client-side reply filtering is active, we ask
 * the relay for more events than `PAGE_SIZE` to compensate for events that
 * will be discarded. This prevents large time gaps in the visible feed.
 */
const OVER_FETCH_MULTIPLIER = 3;

/** Build the union of all topic tags for the unified "All" feed. */
function getAllTopicTags(): string[] {
  const seen = new Set<string>();
  for (const topic of FEED_TOPICS) {
    for (const tag of topic.tags) {
      seen.add(tag.toLowerCase());
    }
  }
  return [...seen];
}

// Re-export FeedItem for backwards compatibility
export type { FeedItem };

/** Extended FeedItem with pagination metadata. */
interface FeedPage {
  items: FeedItem[];
  /** The oldest timestamp from the raw relay query (before deduplication) for pagination. */
  oldestQueryTimestamp: number;
  /** Number of valid events returned by the relay (before client-side filtering). */
  rawCount: number;
}

interface UseFeedOptions {
  /** Override the kinds list instead of using feed settings. Used by kind-specific pages. */
  kinds?: number[];
  /** Additional tag filters to apply (e.g. `{ '#t': ['art'] }`). */
  tagFilters?: Record<string, string[]>;
}

/** Parse the cached community NIP-05 pubkey list from its localStorage raw value. */
function readCommunityPubkeys(raw: string): string[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!data.names || typeof data.names !== 'object') return [];
    return Object.values(data.names).filter((pk): pk is string => typeof pk === 'string');
  } catch {
    return [];
  }
}

/**
 * Reactive wrapper around the community pubkey list stored in localStorage.
 * Re-reads when another tab or NostrSync writes the community data, and on
 * window focus, so the Communities feed doesn't stay stale.
 */
function useCommunityPubkeys(appId: string): string[] {
  const key = getStorageKey(appId, 'communityData');
  const [raw, setRaw] = useState(() => {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    const sync = () => {
      try {
        const next = localStorage.getItem(key) ?? '';
        setRaw((prev) => (prev === next ? prev : next));
      } catch {
        // localStorage may be unavailable
      }
    };
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
    };
  }, [key]);

  return useMemo(() => readCommunityPubkeys(raw), [raw]);
}

/**
 * Remove posts from accounts whose kind-0 NIP-05 identifies a blocked domain.
 * Domain ownership is profile metadata, not a property of the post event, so
 * this lookup is required in addition to the direct event marker check.
 * Metadata failures preserve cached author metadata and otherwise fail open so
 * a slow relay never blanks the feed. A successful query is deliberately
 * over-fetched because relays may return multiple kind-0 versions per author.
 */
async function filterBlockedDomainAuthors(
  events: NostrEvent[],
  nostr: ReturnType<typeof useNostr>['nostr'],
  queryClient: ReturnType<typeof useQueryClient>,
  signal: AbortSignal,
): Promise<NostrEvent[]> {
  const directFiltered = events.filter((event) => !isBlockedFeedDomainEvent(event));
  const authors = [...new Set(directFiltered.map((event) => event.pubkey))];
  if (authors.length === 0) return directFiltered;

  const cachedBlockedAuthors = new Set<string>();
  for (const author of authors) {
    const cached = queryClient.getQueryData<ReturnType<typeof parseAuthorEvent>>(['author', author]);
    const nip05 = cached?.metadata?.nip05;
    if (typeof nip05 === 'string' && isBlockedFeedDomainIdentifier(nip05)) cachedBlockedAuthors.add(author);
  }

  try {
    const metadataEvents = await nostr.query([{ kinds: [0], authors, limit: Math.min(500, Math.max(100, authors.length * 4)) }], { signal });
    const blockedAuthors = new Set(cachedBlockedAuthors);
    for (const metadata of metadataEvents) {
      try {
        const content: unknown = JSON.parse(metadata.content);
        if (typeof content !== 'object' || content === null) continue;
        const nip05 = (content as { nip05?: unknown }).nip05;
        if (typeof nip05 === 'string' && isBlockedFeedDomainIdentifier(nip05)) {
          blockedAuthors.add(metadata.pubkey);
        }
      } catch {
        // Invalid kind-0 metadata is not a reason to hide a post.
      }
      if (!queryClient.getQueryData(['author', metadata.pubkey])) {
        queryClient.setQueryData(['author', metadata.pubkey], parseAuthorEvent(metadata));
      }
    }
    return directFiltered.filter((event) => !blockedAuthors.has(event.pubkey));
  } catch {
    return directFiltered;
  }
}

/** Hook to fetch the global, followed, loved, communities, or unified All feed with infinite scroll pagination. */
export function useFeed(tab: 'all' | 'follows' | 'loved' | 'global' | 'communities', options?: UseFeedOptions) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { data: followData } = useFollowList();
  const followList = followData?.pubkeys;
  // Loved people (kind 15683 Love List) power the dedicated Loved tab.
  // `lovedPubkeys` resolves to [] (never errors) on a relay miss, so it can't
  // block the feed. Like the follow list, it's excluded from the query key —
  // love mutations explicitly invalidate ['feed'].
  const { lovedPubkeys } = useLoveList();
  // Subtract muted pubkeys from the `authors` filter so muted posts never
  // cross the wire. Render-layer mute filters remain as defense in depth
  // (e.g. posts authored by an unmuted user that embed/mention a muted one).
  const { excludeMuted, mutedKey } = useMutedAuthorFilter();
  const { feedSettings } = useFeedSettings();
  const { store } = useNostrStorage();

  // Build the full kinds list from user settings, or use the override.
  const allKinds = options?.kinds ?? getEnabledFeedKinds(feedSettings);

  const tagFilters = options?.tagFilters;

  // Stable key so queries re-run when settings change.
  const kindsKey = [...allKinds].sort().join(',');
  const tagFiltersKey = tagFilters ? JSON.stringify(tagFilters) : '';

  // For the follows tab, wait until the follow list is loaded before running any
  // query (the tab is about those follows; showing global there would be wrong).
  // The loved tab gates on the love list the same way.
  // The all / global / communities tabs run IMMEDIATELY — the queryFn falls back
  // to global discovery while the lists are still loading, so the feed always
  // has instant content instead of a blank screen waiting on slow relays. We
  // refetch once the lists resolve (below) to upgrade to the personalized mix.
  const followsReady =
    tab === 'follows'
      ? !!user && followList !== undefined
      : tab === 'loved'
        ? !!user && lovedPubkeys !== undefined
        : true;

  // Once the follow/love lists resolve, refetch the immediately-started
  // all/global feed so it upgrades from global discovery to the personalized
  // follows+loved mix — without the user waiting or pulling to refresh.
  const listsUpgraded = useRef(false);
  useEffect(() => {
    const listsReady =
      tab === 'all'
        ? !user || (followList !== undefined && lovedPubkeys !== undefined)
        : tab === 'follows'
          ? followList !== undefined
          : tab === 'loved'
            ? lovedPubkeys !== undefined
            : true;
    if (listsReady && !listsUpgraded.current) {
      listsUpgraded.current = true;
      queryClient.refetchQueries({ queryKey: ['feed', tab] });
    }
  }, [tab, user, followList, lovedPubkeys, queryClient]);

  const allCommunityPubkeys = useCommunityPubkeys(config.appId);
  const communityPubkeys = tab === 'communities' ? allCommunityPubkeys : [];

  // ── Instant cold-start seed from the IndexedDB event cache ──
  // Every relay result is persisted to the shared NIndexedDB store, so a
  // repeat visit can render the previous session's posts in <1s while the
  // relay query refreshes them. IDB queries take ~10-50ms. The seed is a
  // rendering accelerator only — the relay pages replace it when they land,
  // and when a relay miss returns nothing, the seed prevents a bogus
  // "No posts found" empty state on a warm device.
  const seedQuery = useQuery<FeedItem[]>({
    queryKey: ['feed-seed', tab, user?.pubkey ?? '', kindsKey],
    queryFn: async ({ signal }) => {
      const postKinds = allKinds.filter((k) => !isRepostKind(k) && !isReactionKind(k) && !isZapKind(k));
      if (postKinds.length === 0) return [];
      const now = Math.floor(Date.now() / 1000);
      const events = await store.query(
        [{ kinds: postKinds, limit: PAGE_SIZE * OVER_FETCH_MULTIPLIER }],
        { signal },
      );
      const seen = new Set<string>();
      const items: FeedItem[] = [];
      const sorted = filterCoordinatedDuplicateSpamEvents(events, now)
        .filter((ev) => ev.created_at <= now && !isMastodonBridgeEvent(ev))
        .sort((a, b) => b.created_at - a.created_at);
      for (const event of sorted) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        if (!feedSettings.followsFeedShowReplies && isReplyEvent(event)) continue;
        items.push({ event, sortTimestamp: event.created_at });
        if (items.length >= PAGE_SIZE) break;
      }
      return items;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const infiniteQuery = useInfiniteQuery<FeedPage, Error>({
    // NOTE: followList is intentionally excluded from the query key
    // (see earlier comment). kindsKey IS included so the feed
    // refetches when the user changes feed kind settings. This is stable
    // on page load because feedSettings is read from localStorage
    // synchronously — the encrypted settings sync at ~5s only calls
    // updateConfig if values actually differ (NostrSync changed guard).
    queryKey: ['feed', tab, user?.pubkey ?? '', kindsKey, tagFiltersKey, communityPubkeys, feedSettings.followsFeedShowReplies, mutedKey],
    queryFn: async ({ pageParam }) => {
      const signal = AbortSignal.timeout(8000);
      const now = Math.floor(Date.now() / 1000);

      /** Seed the `['event', id]` query cache with events we already have in hand. */
      function cacheEvents(items: FeedItem[]): void {
        for (const { event } of items) {
          if (!queryClient.getQueryData(['event', event.id])) {
            queryClient.setQueryData(['event', event.id], event);
          }
          // Persist to the shared IndexedDB store so the cold-start seed can
          // render this session's feed instantly on the next visit.
          // Fire-and-forget — cache writes must never block the feed.
          void store.event(event).catch(() => {});
        }
      }

      if (tab === 'all') {
        // Unified “All” feed — merges follows, loved, community, global, and
        // topic-tagged posts into a single timeline. Multiple filters are sent
        // in one relay round-trip; results are merged and deduplicated below.
        const fetchLimit = !feedSettings.followsFeedShowReplies ? PAGE_SIZE * OVER_FETCH_MULTIPLIER : PAGE_SIZE;
        const showReplies = feedSettings.followsFeedShowReplies;
        const postKinds = allKinds.filter((k) => !isRepostKind(k) && !isReactionKind(k) && !isZapKind(k));
        const authorKinds = allKinds;

        const filters: { kinds: number[]; limit: number; until?: number; authors?: string[]; search?: string; '#t'?: string[] }[] = [];

        if (user && followList !== undefined) {
          const follows = excludeMuted(followList);
          if (follows.length > 0) {
            filters.push({ kinds: authorKinds, authors: [...follows, user.pubkey], limit: fetchLimit });
          }
        }

        if (user && lovedPubkeys !== undefined) {
          const loved = excludeMuted(lovedPubkeys);
          if (loved.length > 0) {
            filters.push({ kinds: postKinds, authors: loved, limit: fetchLimit });
          }
        }

        if (communityPubkeys.length > 0) {
          filters.push({ kinds: authorKinds, authors: communityPubkeys, limit: fetchLimit });
        }

        const discoveryPageSize = user ? PAGE_SIZE : GUEST_DISCOVERY_PAGE_SIZE;
        const guestDistinctAuthors = user ? '' : ' distinct:author';
        filters.push({ kinds: postKinds, limit: discoveryPageSize, search: `sort:hot protocol:nostr${guestDistinctAuthors}` });

        const topicTags = getAllTopicTags();
        if (topicTags.length > 0) {
          filters.push({
            kinds: postKinds,
            '#t': topicTags,
            limit: discoveryPageSize,
            ...(user ? {} : { search: 'distinct:author' }),
          });
        }

        if (pageParam) {
          for (const filter of filters) {
            filter.until = pageParam as number;
          }
        }

        const rawEvents = filters.length > 0
          ? await nostr.query(filters as NostrFilter[], { signal })
          : [];

        const validEvents = rawEvents.filter((ev) => ev.created_at <= now);
        const domainFilteredEvents = await filterBlockedDomainAuthors(validEvents, nostr, queryClient, signal);
        const oldestQueryTimestamp = getPaginationCursor(validEvents);

        // Drop Mastodon / ActivityPub bridged content from the default feed.
        const filteredEvents = domainFilteredEvents.filter((ev) => !isMastodonBridgeEvent(ev));

        const items = await buildFeedItems(filteredEvents, nostr, signal);
        let dedupedItems = dedupeFeedItems(items);

        if (!showReplies) {
          dedupedItems = dedupedItems.filter(
            (item) => item.repostedBy || item.reactedBy || item.zappedBy || item.profileZapRecipient || !isReplyEvent(item.event),
          );
        }

        // Sort newest-first in case the relay returned interleaved filter results.
        dedupedItems.sort((a, b) => b.event.created_at - a.event.created_at);
        if (!user) dedupedItems = interleaveFeedAuthors(dedupedItems);

        cacheEvents(dedupedItems);
        return { items: dedupedItems, oldestQueryTimestamp, rawCount: validEvents.length };
      } else if (tab === 'communities' && communityPubkeys.length > 0) {
        // Communities feed — posts from community members with NIP-05 verification
        const fetchLimit = !feedSettings.followsFeedShowReplies ? PAGE_SIZE * OVER_FETCH_MULTIPLIER : PAGE_SIZE;
        const filter: Record<string, unknown> = { kinds: allKinds, authors: communityPubkeys, limit: fetchLimit, ...tagFilters };
        if (pageParam) {
          filter.until = pageParam;
        }

        const rawEvents = await nostr.query(
          [filter as { kinds: number[]; authors: string[]; limit: number; until?: number }],
          { signal },
        );

        const events = rawEvents;

        // Get the community domain for verification
        let communityDomain = '';
        try {
          const communityStr = localStorage.getItem(getStorageKey(config.appId, 'community'));
          if (communityStr) {
            const community = JSON.parse(communityStr);
            communityDomain = community.domain;
          }
        } catch {
          // Fall through - no domain verification
        }

        // Fetch kind 0 metadata for all authors to verify NIP-05
        const authorPubkeys = [...new Set(events.map(e => e.pubkey))];
        const metadataEvents = authorPubkeys.length > 0
          ? await nostr.query(
              [{ kinds: [0], authors: authorPubkeys }],
              { signal },
            )
          : [];

        // Seed the author query cache from the metadata we already fetched
        // for NIP-05 verification, so downstream useAuthor() calls are instant.
        for (const meta of metadataEvents) {
          if (!queryClient.getQueryData(['author', meta.pubkey])) {
            const parsed = parseAuthorEvent(meta);
            queryClient.setQueryData(['author', meta.pubkey], parsed);
            // Persist to IndexedDB (fire-and-forget)
            void store.event(meta);
          }
        }

        // Build map of pubkey -> NIP-05 identifier
        const nip05Map = new Map<string, string>();
        for (const meta of metadataEvents) {
          try {
            const content = JSON.parse(meta.content);
            if (content.nip05) {
              nip05Map.set(meta.pubkey, content.nip05.toLowerCase());
            }
          } catch {
            // Skip invalid metadata
          }
        }

        // Filter events to only show users with matching NIP-05 domain
        const filteredEvents = communityDomain 
          ? events.filter((ev) => {
              const nip05 = nip05Map.get(ev.pubkey);
              if (!nip05) return false;
              // Check if NIP-05 ends with @domain
              const expectedSuffix = `@${communityDomain}`;
              return nip05.endsWith(expectedSuffix);
            })
          : events; // Fallback if no domain found

        // Track oldest timestamp from the raw query for pagination, ignoring
        // outliers from out-of-sync relays to prevent cursor jumps.
        const validFilteredEvents = filteredEvents.filter((ev) => ev.created_at <= now);
        const oldestQueryTimestamp = getPaginationCursor(validFilteredEvents);

        // Unwrap reposts / reactions / zaps so the target event renders
        // with the wrapper as an overlay header.
        const items = await buildFeedItems(validFilteredEvents, nostr, signal);

        let dedupedItems = dedupeFeedItems(items);

        // Filter replies if the user has disabled them
        if (!feedSettings.followsFeedShowReplies) {
          dedupedItems = dedupedItems.filter(
            (item) => item.repostedBy || item.reactedBy || item.zappedBy || item.profileZapRecipient || !isReplyEvent(item.event),
          );
        }

        // Seed event cache so embedded note previews resolve instantly.
        // Authors, stats, and reactions are batched automatically by AppPool
        // when NoteCard components mount.
        cacheEvents(dedupedItems);

        return { items: dedupedItems, oldestQueryTimestamp, rawCount: validFilteredEvents.length };
      } else if (tab === 'loved' && user && lovedPubkeys !== undefined) {
        // Loved feed — posts and extra kinds from people on the user's Love
        // List (kind 15683), minus anyone also muted (mute wins). Reposts and
        // reactions are excluded: the Loved tab surfaces what loved people
        // post, not what they boost or react to.
        const lovedAuthors = excludeMuted(lovedPubkeys);

        // Empty love list — never query with an empty authors array (that
        // would match everyone). Render the empty state instead.
        if (lovedAuthors.length === 0) {
          return { items: [], oldestQueryTimestamp: now, rawCount: 0 };
        }

        const lovedKinds = allKinds.filter((k) => !isRepostKind(k) && !isReactionKind(k));
        const fetchLimit = !feedSettings.followsFeedShowReplies ? PAGE_SIZE * OVER_FETCH_MULTIPLIER : PAGE_SIZE;
        const filter: Record<string, unknown> = { kinds: lovedKinds, authors: lovedAuthors, limit: fetchLimit, ...tagFilters };
        if (pageParam) {
          filter.until = pageParam;
        }

        const rawEvents = await nostr.query(
          [filter as { kinds: number[]; authors: string[]; limit: number; until?: number }],
          { signal },
        );

        const validEvents = rawEvents.filter((ev) => ev.created_at <= now);
        const domainFilteredEvents = await filterBlockedDomainAuthors(validEvents, nostr, queryClient, signal);
        const oldestQueryTimestamp = getPaginationCursor(validEvents);

        // Unwrap reposts / reactions / zaps so the target event renders
        // with the wrapper as an overlay header.
        const items = await buildFeedItems(domainFilteredEvents, nostr, signal);

        let dedupedItems = dedupeFeedItems(items);

        // Filter replies if the user has disabled them
        if (!feedSettings.followsFeedShowReplies) {
          dedupedItems = dedupedItems.filter(
            (item) => item.repostedBy || item.reactedBy || item.zappedBy || item.profileZapRecipient || !isReplyEvent(item.event),
          );
        }

        // Seed event cache so embedded note previews resolve instantly.
        cacheEvents(dedupedItems);

        return { items: dedupedItems, oldestQueryTimestamp, rawCount: validEvents.length };
      } else if (tab === 'follows' && user && followList !== undefined) {
        // Follows feed — posts, reposts, and extra kinds from people you follow,
        // minus anyone you've also muted (mute wins, no wasted bandwidth).
        const filteredFollows = excludeMuted(followList);
        // If followList is empty (or fully muted), just query own posts
        const authors = filteredFollows.length > 0 ? [...filteredFollows, user.pubkey] : [user.pubkey];
        const fetchLimit = !feedSettings.followsFeedShowReplies ? PAGE_SIZE * OVER_FETCH_MULTIPLIER : PAGE_SIZE;
        const filter: Record<string, unknown> = { kinds: allKinds, authors, limit: fetchLimit, ...tagFilters };
        if (pageParam) {
          filter.until = pageParam;
        }

        const rawEvents = await nostr.query(
          [filter as { kinds: number[]; authors: string[]; limit: number; until?: number }],
          { signal },
        );

        // Track oldest timestamp from the raw query for pagination, ignoring
        // outliers from out-of-sync relays to prevent cursor jumps.
        const validEvents = rawEvents.filter((ev) => ev.created_at <= now);
        const domainFilteredEvents = await filterBlockedDomainAuthors(validEvents, nostr, queryClient, signal);
        const oldestQueryTimestamp = getPaginationCursor(validEvents);

        // Unwrap reposts / reactions / zaps so the target event renders
        // with the wrapper as an overlay header.
        const items = await buildFeedItems(domainFilteredEvents, nostr, signal);

        let dedupedItems = dedupeFeedItems(items);

        // Filter replies if the user has disabled them
        if (!feedSettings.followsFeedShowReplies) {
          dedupedItems = dedupedItems.filter(
            (item) => item.repostedBy || item.reactedBy || item.zappedBy || item.profileZapRecipient || !isReplyEvent(item.event),
          );
        }

        // Seed event cache so embedded note previews resolve instantly.
        cacheEvents(dedupedItems);

        return { items: dedupedItems, oldestQueryTimestamp, rawCount: validEvents.length };
      } else {
        // Global feed — all enabled kinds except reposts / reactions / zaps,
        // which are too noisy without an author filter and require an extra
        // unwrap step. Users will see those overlays on the Follows tab.
        const globalKinds = allKinds.filter((k) => !isRepostKind(k) && !isReactionKind(k) && !isZapKind(k));
        const filter: Record<string, unknown> = {
          kinds: globalKinds,
          limit: user ? PAGE_SIZE : GUEST_DISCOVERY_PAGE_SIZE,
          ...tagFilters,
        };
        // Use hot sorting on the homepage Global tab for better content quality,
        // but not on kind-specific pages that pass custom kinds.
        if (tab === 'global' && !options?.kinds) {
          filter.search = user ? 'sort:hot protocol:nostr' : 'sort:hot protocol:nostr distinct:author';
        }
        if (pageParam) {
          filter.until = pageParam;
        }

        const rawEvents = await nostr.query(
          [filter as { kinds: number[]; limit: number; until?: number }],
          { signal },
        );

        const validEvents = rawEvents.filter((ev) => ev.created_at <= now);
        const domainFilteredEvents = await filterBlockedDomainAuthors(validEvents, nostr, queryClient, signal);
        const oldestQueryTimestamp = getPaginationCursor(validEvents);

        // Drop Mastodon / ActivityPub bridged content from the global feed.
        const filteredEvents = domainFilteredEvents.filter((ev) => !isMastodonBridgeEvent(ev));

        let items = filterCoordinatedDuplicateSpamEvents(filteredEvents, now)
          .sort((a, b) => b.created_at - a.created_at)
          .map((ev) => ({ event: ev, sortTimestamp: ev.created_at }));

        if (!user) items = interleaveFeedAuthors(items);

        // Seed event cache so embedded note previews resolve instantly.
        cacheEvents(items);

        return { items, oldestQueryTimestamp, rawCount: validEvents.length };
      }
    },
    getNextPageParam: (lastPage) => {
      // Use rawCount (pre-filter) to decide if there are more events on the relay.
      // Reply filtering may discard all items from a page, but that doesn't mean
      // the relay is exhausted.
      if (lastPage.rawCount === 0) return undefined;
      return lastPage.oldestQueryTimestamp - 1;
    },
    initialPageParam: undefined as number | undefined,
    enabled: followsReady,
    staleTime: 60 * 1000,
    // No refetchInterval — automatic background refetches cause the entire
    // feed to re-sort and jump.  Users can pull-to-refresh for fresh content.
    refetchOnWindowFocus: false,
    gcTime: 30 * 60 * 1000, // 30 min — don't GC feed data while the app is open
    placeholderData: (prev) => prev, // keep showing previous data during refetches
  });

  return { ...infiniteQuery, seedItems: seedQuery.data ?? [] };
}
