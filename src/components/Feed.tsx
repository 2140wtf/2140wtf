import { useState, useEffect, useMemo } from 'react';
import { useInView } from 'react-intersection-observer';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { usePageRefresh } from '@/hooks/usePageRefresh';
import { ComposeBox } from '@/components/ComposeBox';
import { LandingHero } from '@/components/LandingHero';
import { NoteCard } from '@/components/NoteCard';
import { PullToRefresh } from '@/components/PullToRefresh';
import { FeedEmptyState } from '@/components/FeedEmptyState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Heart, Loader2, MapPin } from 'lucide-react';
import LoginDialog from '@/components/auth/LoginDialog';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useAppContext } from '@/hooks/useAppContext';
import { useFeed } from '@/hooks/useFeed';
import { useFeedStream } from '@/hooks/useFeedStream';
import { useFollowList } from '@/hooks/useFollowActions';
import { useMutedAuthorFilter } from '@/hooks/useMutedAuthorFilter';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useFeedSettings } from '@/hooks/useFeedSettings';
import { DITTO_RELAYS } from '@/lib/appRelays';
import { getStorageKey } from '@/lib/storageKey';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFeedTab } from '@/hooks/useFeedTab';
import { useInterests } from '@/hooks/useInterests';
import { useMuteList } from '@/hooks/useMuteList';
import { useLoveList } from '@/hooks/useLoveList';
import { useTabFeed } from '@/hooks/useProfileFeed';
import { useTopicAuthors } from '@/hooks/useTopicAuthors';
import { useSavedFeeds } from '@/hooks/useSavedFeeds';
import { useResolveTabFilter } from '@/hooks/useResolveTabFilter';
import { useCuratorFollowList } from '@/hooks/useCuratorFollowList';
import { useCuratedDittoFeed } from '@/hooks/useCuratedDittoFeed';
import { useStickyFeedItems } from '@/hooks/useStickyFeedItems';
import { getEnabledFeedKinds } from '@/lib/extraKinds';
import { diversifyFeedPages } from '@/lib/feedDiversity';
import { isRepostKind, shouldHideFeedEvent, feedItemKey } from '@/lib/feedUtils';
import { FEED_TOPICS, getFeedTopic, getTopicTagFilter } from '@/lib/feedTopics';
import { isEventMuted } from '@/lib/muteHelpers';
import { cn } from '@/lib/utils';
import { NewPostsPill } from '@/components/NewPostsPill';
import { SubHeaderBar } from '@/components/SubHeaderBar';
import { ARC_OVERHANG_PX } from '@/components/ArcBackground';
import { TabButton } from '@/components/TabButton';
import type { FeedItem } from '@/lib/feedUtils';
import type { NostrEvent } from '@nostrify/nostrify';
import type { SavedFeed } from '@/contexts/AppContext';

type CoreFeedTab = 'all' | 'follows' | 'loved' | 'global' | 'communities' | 'ditto';
type FeedTab = CoreFeedTab | string; // string = saved feed id

interface FeedProps {
  /** Override the kinds list instead of using feed settings. */
  kinds?: number[];
  /** Additional tag filters to apply (e.g. `{ '#t': ['art'] }`). */
  tagFilters?: Record<string, string[]>;
  /** Header element rendered above the tabs (e.g. back-arrow + title). */
  header?: React.ReactNode;
  /** Hide the compose box (used on kind-specific pages). */
  hideCompose?: boolean;
  /** Message shown when the feed is empty. */
  emptyMessage?: string;
  /** Unique identifier for this feed page, used to persist the active tab in sessionStorage. Defaults to 'home'. */
  feedId?: string;
  /**
   * On kind/tag-specific pages, default to the Global tab (labeled "All") and
   * render it before Follows. Used by the client feed page.
   */
  globalFirst?: boolean;
  /** Render items in a two-column grid (used for visual feeds like Art). */
  grid?: boolean;
  /** Optional keyword filter applied client-side to the rendered items. */
  searchQuery?: string;
  /** Poll-type filter: all, zap-only (kind 6969), or regular (kind 1068). */
  pollFilter?: 'all' | 'zap' | 'regular';
  /** Render an explicit "Load more" button instead of infinite scroll. */
  showLoadMoreButton?: boolean;
}

export function Feed({ kinds, tagFilters, header, hideCompose, emptyMessage, feedId = 'home', globalFirst, grid, searchQuery, pollFilter, showLoadMoreButton }: FeedProps = {}) {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { muteItems } = useMuteList();
  const { lovedPubkeys } = useLoveList();
  const { savedFeeds } = useSavedFeeds();
  const { hashtags } = useInterests();
  const { hashtags: geotags } = useInterests('g');
  const { data: curatorFollowList, isError: isCuratorError } = useCuratorFollowList();
  const { data: followData } = useFollowList();
  const { excludeMuted } = useMutedAuthorFilter();
  const isOnline = useIsOnline();

  // Tab settings from localStorage
  const showGlobalFeed = (() => {
    try {
      const stored = localStorage.getItem(getStorageKey(config.appId, 'showGlobalFeed'));
      return stored !== null ? stored === 'true' : false;
    } catch {
      return false;
    }
  })();

  const showDittoFeed = (() => {
    try {
      const stored = localStorage.getItem(getStorageKey(config.appId, 'showDittoFeed'));
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  })();

  const showCommunityFeed = (() => {
    try {
      const stored = localStorage.getItem(getStorageKey(config.appId, 'showCommunityFeed'));
      return stored !== null ? stored === 'true' : false;
    } catch {
      return false;
    }
  })();

  const communityLabel = (() => {
    try {
      const stored = localStorage.getItem(getStorageKey(config.appId, 'community'));
      if (stored) {
        const community = JSON.parse(stored);
        return community.label || 'Community';
      }
    } catch {
      // Fall through
    }
    return 'Community';
  })();

  const [rawActiveTab, handleSetActiveTab] = useFeedTab<FeedTab>(feedId, undefined, globalFirst ? 'global' : 'all');
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const { startSignup } = useOnboarding();

  // The Loved tab only exists when the user actually loves someone. Hidden
  // (and clamped back to Follows) when the Love List is empty or still loading.
  const hasLovedPeople = !!user && (lovedPubkeys?.length ?? 0) > 0;

  // Kind-specific pages only support Follows + Global. Saved feeds, hashtags,
  // and geotags are also hidden on kind-specific pages and for logged-out users.
  const isKindSpecificPage = !!kinds;
  const showSavedFeedTabs = user && !isKindSpecificPage && !tagFilters;

  // Kind-specific pages only support Follows + Global. Clamp any other
  // persisted tab (e.g. 'ditto', 'communities', 'all') back to the appropriate default.
  // Logged-out users must land on 'all' (public tab bar) since 'follows' requires a user.
  const activeTab: FeedTab = (() => {
    // 'loved' is only valid on the home feed while the Love List is non-empty.
    if (rawActiveTab === 'loved' && (kinds || !hasLovedPeople)) {
      return user ? 'all' : 'global';
    }
    // Saved feeds, hashtags, and geotags are only available on the home feed
    // and only while the extra-tabs row is shown. Clamp a persisted saved-feed
    // id back to a visible tab when the tabs are hidden.
    const isSavedFeed = savedFeeds.some((f) => f.id === rawActiveTab);
    const isHashtag = rawActiveTab.startsWith('hashtag:');
    const isGeotag = rawActiveTab.startsWith('geotag:');
    if (!showSavedFeedTabs && (isSavedFeed || isHashtag || isGeotag)) {
      return globalFirst ? 'global' : (user ? 'all' : 'global');
    }
    if (!kinds) {
      // Home feed: no clamping for logged-in users. For guests, make sure the
      // persisted tab is actually visible in the public LandingHero tab bar.
      if (!user) {
        if (rawActiveTab === 'ditto' && !showDittoFeed) return 'all';
        if (rawActiveTab === 'communities' && !showCommunityFeed) return 'all';
      }
      return rawActiveTab;
    }
    if (rawActiveTab === 'global') return 'global';
    if (rawActiveTab === 'follows' && user) return 'follows';
    // `globalFirst` pages default to Global even when logged in.
    if (globalFirst) return 'global';
    return user ? 'all' : 'global';
  })();

  // Is the active tab a saved feed?
  const activeSavedFeed = useMemo(
    () => savedFeeds.find((f) => f.id === activeTab) ?? null,
    [savedFeeds, activeTab],
  );

  // Is the active tab a hashtag interest?
  const activeHashtag = activeTab.startsWith('hashtag:') ? activeTab.slice(8) : null;

  // Is the active tab a geotag interest?
  const activeGeotag = activeTab.startsWith('geotag:') ? activeTab.slice(7) : null;

  // Is the active tab a topic feed (e.g. Bitcoin, Nostr, Tech/AI)?
  const activeTopic = useMemo(() => getFeedTopic(activeTab), [activeTab]);
  const isTopicTab = !!activeTopic;

  // Discover active authors for the current topic. While discovery is still
  // loading we fall back to the static author list so the tab renders
  // immediately and upgrades once the dynamic list resolves.
  const { data: dynamicTopicAuthors } = useTopicAuthors(activeTopic ?? null);
  const topicAuthors = activeTopic
    ? (dynamicTopicAuthors ?? activeTopic.authors)
    : undefined;
  const hasTopicAuthors = (topicAuthors?.length ?? 0) > 0;

  // When logged out and the 2140.wtf (Ditto) tab is active, show the "hot"
  // sorted curated feed instead of the noisy global feed. Guests can now switch
  // tabs, so only force the top feed while the Ditto tab is selected.
  const useTopFeedForLoggedOut = !user && !kinds && activeTab === 'ditto';

  // When the 2140.wtf tab is active (logged in), show the same hot-sorted curated feed.
  // Disabled on kind-specific pages — the 2140.wtf tab is not shown there.
  const useDittoTab = user && activeTab === 'ditto' && !kinds;

  // Standard feed query (used when logged in, or on kind-specific pages, or core tabs)
  const isCoreFeedTab =
    activeTab === 'all' || activeTab === 'follows' || activeTab === 'loved' || activeTab === 'global' || activeTab === 'communities' || activeTab === 'ditto' || isTopicTab;
  type UseFeedTab = 'all' | 'follows' | 'loved' | 'global' | 'communities';
  const feedTabForQuery: UseFeedTab =
    activeTab === 'all' || activeTab === 'follows' || activeTab === 'loved' || activeTab === 'global' || activeTab === 'communities'
      ? (activeTab as UseFeedTab)
      : 'global';
  const feedQueryOptions = useMemo(() => {
    if (activeTopic && !hasTopicAuthors) return { tagFilters: getTopicTagFilter(activeTopic) };
    if (kinds || tagFilters) return { kinds, tagFilters };
    return undefined;
  }, [activeTopic, hasTopicAuthors, kinds, tagFilters]);
  const feedQuery = useFeed(feedTabForQuery, feedQueryOptions);

  // Author-filtered topic feeds (e.g. Bitcoin, Nostr, BAO) show posts from
  // discovered authors, falling back to the static list while discovery loads.
  const authorTopicQuery = useTabFeed(
    hasTopicAuthors ? { authors: topicAuthors } : null,
    activeTopic ? `topic-${activeTopic.id}` : '',
    hasTopicAuthors,
  );

  // Curated 2140.wtf feed: latest content from the curator's follow list.
  const topQuery = useCuratedDittoFeed(
    curatorFollowList,
    useTopFeedForLoggedOut || !!useDittoTab,
  );

  // Unify the two query shapes behind a single interface
  const useDittoQuery = useTopFeedForLoggedOut || useDittoTab;
  const activeQuery = useDittoQuery
    ? topQuery
    : hasTopicAuthors
      ? authorTopicQuery
      : feedQuery;
  const queryKey = useMemo(() => {
    if (useDittoQuery) return ['ditto-curated-feed'];
    if (hasTopicAuthors) return ['tab-feed', `topic-${activeTopic!.id}`];
    return ['feed', activeTab];
  }, [useDittoQuery, hasTopicAuthors, activeTopic, activeTab]);

  const handleRefresh = usePageRefresh(queryKey);

  // Live auto-refresh: detect new posts arriving on the active feed and surface
  // a "N new posts" pill, without re-sorting the feed under the user's scroll.
  // Only the core author/global tabs stream — the curated Ditto tab, saved
  // feeds, and hashtag/geotag tabs render their own content below.
  const { feedSettings } = useFeedSettings();
  const streamAuthors = useMemo<string[] | undefined>(() => {
    if (feedTabForQuery === 'follows') {
      const follows = excludeMuted(followData?.pubkeys ?? []);
      return user ? [...follows, user.pubkey] : follows;
    }
    if (feedTabForQuery === 'loved') {
      return excludeMuted(lovedPubkeys ?? []);
    }
    // global / communities: communities derive authors internally in useFeed;
    // skip streaming there to avoid a second localStorage read. Global has no authors.
    return undefined;
  }, [feedTabForQuery, followData?.pubkeys, lovedPubkeys, user, excludeMuted]);

  // Stream only for the core feed tabs, when not the curated Ditto query or a topic tab.
  const streamEnabled =
    isCoreFeedTab &&
    !useDittoQuery &&
    !isTopicTab &&
    (feedTabForQuery === 'follows' || feedTabForQuery === 'loved' || feedTabForQuery === 'global');

  const { newPostCount, reset: resetNewPosts } = useFeedStream({
    tab: feedTabForQuery,
    authors: streamAuthors,
    kinds,
    showReplies: feedSettings.followsFeedShowReplies,
    enabled: streamEnabled,
  });

  const handleShowNewPosts = () => {
    resetNewPosts();
    handleRefresh();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const {
    data: rawData,
    isPending,
    isLoading,
    isFetching,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = activeQuery;

  // Auto-fetch page 2 as soon as page 1 arrives for smoother scrolling
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && rawData?.pages?.length === 1) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, rawData?.pages?.length, fetchNextPage]);

  // Intersection observer for infinite scroll
  const { ref: scrollRef, inView } = useInView({
    threshold: 0,
    rootMargin: '400px',
  });

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Flatten, deduplicate, and filter muted content.
  const derivedItems = useMemo(() => {
    if (!rawData?.pages) return [];
    const seen = new Set<string>();

    if (useDittoQuery) {
      // Deduplicate and filter each page independently, then diversify
      // page-by-page so earlier pages never change when new pages arrive.
      const dedupedPages = (rawData.pages as unknown as import('@nostrify/nostrify').NostrEvent[][])
        .map((page) =>
          page
            .filter((event) => {
              if (seen.has(event.id)) return false;
              seen.add(event.id);
              if (shouldHideFeedEvent(event)) return false;
              if (muteItems.length > 0 && isEventMuted(event, muteItems)) return false;
              return true;
            })
            .map((event): FeedItem => ({ event, sortTimestamp: event.created_at })),
        );

      // Reorder for content-type diversity: cap any single type at 20%
      // per page and enforce a minimum gap of 4 positions between same-type
      // items, with gap state carrying across page boundaries.
      return diversifyFeedPages(dedupedPages);
    }

    return (rawData.pages as unknown as { items: FeedItem[] }[])
      .flatMap((page) => page.items)
      .filter((item) => {
        const key = feedItemKey(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        if (shouldHideFeedEvent(item.event)) return false;
        if (muteItems.length > 0 && isEventMuted(item.event, muteItems)) return false;
        return true;
      });
  }, [rawData?.pages, muteItems, useDittoQuery]);

  // Retain the last non-empty list so a key change / background refetch /
  // settled-empty relay miss never flashes the empty state over a feed the
  // user is actively reading. Retention resets when the viewed feed identity
  // (account or tab) changes.
  const feedItems = useStickyFeedItems(
    derivedItems,
    `${user?.pubkey ?? ''}:${useDittoQuery ? 'ditto' : activeTab}`,
  );

  // Apply optional client-side keyword search and poll-type filter.
  const visibleItems = useMemo(() => {
    let items = feedItems;
    if (pollFilter && pollFilter !== 'all') {
      items = items.filter((item) => {
        const kind = item.event.kind;
        if (pollFilter === 'zap') return kind === 6969;
        if (pollFilter === 'regular') return kind === 1068;
        return true;
      });
    }
    if (!searchQuery?.trim()) return items;
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const event = item.event;
      if (event.content?.toLowerCase().includes(q)) return true;
      for (const tag of event.tags) {
        const tagName = tag[0];
        if ((tagName === 'option' || tagName === 'poll_option') && tag[2]?.toLowerCase().includes(q)) {
          return true;
        }
      }
      return false;
    });
  }, [feedItems, searchQuery, pollFilter]);

  // Show skeletons while loading, but not if the curator list query errored
  // (that would leave logged-out users staring at infinite skeletons).
  const showSkeleton = (isPending || (isLoading && !rawData)) && !(useDittoQuery && isCuratorError);

  // Distinguish the empty-state cases so the message + CTAs match the cause:
  //   - Follows tab with zero follows → "follow some people" (no retry).
  //   - Otherwise (follows-but-empty, global miss, or query error) → "couldn't
  //     find posts" with a Try again button, plus an offline hint when the
  //     device reports it's offline.
  const followsEmpty = activeTab === 'follows' && followData?.pubkeys.length === 0;
  const emptyProps = (() => {
    // Caller-provided message (kind-specific pages) wins; keep it verbatim but
    // still offer a retry so a transient miss is recoverable.
    if (emptyMessage) {
      return {
        message: emptyMessage,
        onRetry: handleRefresh,
        isRetrying: isFetching,
        isOffline: !isOnline,
      };
    }

    if (followsEmpty) {
      return {
        message: 'Your feed is empty. Follow some people to see their posts here.',
        showDiscover: true,
        onSwitchToGlobal: showGlobalFeed ? () => handleSetActiveTab('global') : undefined,
      };
    }

    const isFollows = activeTab === 'follows';
    const isLoved = activeTab === 'loved';
    const baseMessage = !isOnline
      ? isFollows
        ? "We couldn't load posts from people you follow."
        : isLoved
          ? "We couldn't load posts from the people you love."
          : "We couldn't load the feed."
      : isError
        ? isFollows
          ? "Something went wrong loading posts from people you follow."
          : isLoved
            ? 'Something went wrong loading posts from the people you love.'
            : 'Something went wrong loading the feed.'
        : isFollows
          ? "We couldn't find any recent posts from people you follow."
          : isLoved
            ? "No recent posts from the people you love. Add more people from their profile's ⋯ menu."
            : activeTopic
              ? `No posts found in ${activeTopic.label}. Check your relay connections or come back soon.`
              : 'No posts found. Check your relay connections or come back soon.';

    return {
      message: baseMessage,
      onRetry: handleRefresh,
      isRetrying: isFetching,
      isOffline: !isOnline,
      onSwitchToGlobal: isFollows && showGlobalFeed ? () => handleSetActiveTab('global') : undefined,
    };
  })();

  return (
    <main className="flex-1 min-w-0 min-h-dvh">
      {/* CTA (logged out, main feed only) */}
      {!user && !kinds && (
        <LandingHero
          onLoginClick={() => setLoginDialogOpen(true)}
          onSignupClick={startSignup}
          activeTab={activeTab}
          onTabChange={handleSetActiveTab}
        />
      )}

      {!hideCompose && <ComposeBox compact hideBorder />}

      {header}

      {/* Tabs — shown for logged-in users. Guests switch feeds via the tab bar
          rendered inside LandingHero. */}
      {user && !kinds && (
        <SubHeaderBar>
          <TabButton label="All" active={activeTab === 'all'} onClick={() => handleSetActiveTab('all')} />
          {!isKindSpecificPage && user && hasLovedPeople && (
            <TabButton label="Loved" active={activeTab === 'loved'} onClick={() => handleSetActiveTab('loved')}>
              <span className="flex items-center justify-center gap-1">
                <Heart className={cn('size-3.5', activeTab === 'loved' && 'fill-red-500 text-red-500')} />
                Loved
              </span>
            </TabButton>
          )}
          {user && (
            <TabButton label="Follows" active={activeTab === 'follows'} onClick={() => handleSetActiveTab('follows')} />
          )}
          {!isKindSpecificPage && showDittoFeed && (
            <TabButton label={config.appName} active={activeTab === 'ditto'} onClick={() => handleSetActiveTab('ditto')} />
          )}
          {!isKindSpecificPage && showCommunityFeed && (
            <TabButton label={communityLabel} active={activeTab === 'communities'} onClick={() => handleSetActiveTab('communities')} />
          )}
          <TabButton label="Global" active={activeTab === 'global'} onClick={() => handleSetActiveTab('global')} />
          {!isKindSpecificPage && !tagFilters && FEED_TOPICS.map((topic) => (
            <TabButton
              key={`topic:${topic.id}`}
              label={topic.label}
              active={activeTab === topic.id}
              onClick={() => handleSetActiveTab(topic.id)}
            >
              <span className="flex items-center justify-center gap-1">
                {topic.iconSrc ? (
                  <img src={topic.iconSrc} alt="" className="size-3.5 object-contain rounded-sm" />
                ) : (
                  <span>{topic.icon}</span>
                )}
                {topic.label}
              </span>
            </TabButton>
          ))}
          {showSavedFeedTabs && savedFeeds.map((feed) => (
            <TabButton
              key={feed.id}
              label={feed.label}
              active={activeTab === feed.id}
              onClick={() => handleSetActiveTab(feed.id)}
            />
          ))}
          {showSavedFeedTabs && hashtags.map((tag) => (
            <TabButton
              key={`hashtag:${tag}`}
              label={`#${tag}`}
              active={activeTab === `hashtag:${tag}`}
              onClick={() => handleSetActiveTab(`hashtag:${tag}`)}
            />
          ))}
          {showSavedFeedTabs && geotags.map((tag) => (
            <TabButton
              key={`geotag:${tag}`}
              label={tag}
              active={activeTab === `geotag:${tag}`}
              onClick={() => handleSetActiveTab(`geotag:${tag}`)}
            >
              <span className="flex items-center justify-center gap-1">
                <MapPin className="size-3.5" />
                {tag}
              </span>
            </TabButton>
          ))}
        </SubHeaderBar>
      )}

      {/* Feed content — saved feed tab gets its own stream */}
      {user && <div style={{ height: ARC_OVERHANG_PX }} />}
      {activeHashtag ? (
        <HashtagFeedContent tag={activeHashtag} />
      ) : activeGeotag ? (
        <GeotagFeedContent tag={activeGeotag} />
      ) : activeSavedFeed ? (
        <SavedFeedContent feed={activeSavedFeed} />
      ) : (
        <PullToRefresh onRefresh={handleRefresh}>
          {/* New posts pill — live auto-refresh. Never re-sorts the feed:
              tapping it refreshes and scrolls to top. */}
          <NewPostsPill count={newPostCount} onClick={handleShowNewPosts} />
          {visibleItems.length > 0 ? (
            grid ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                {visibleItems.map((item: FeedItem) => (
                  <NoteCard
                    key={feedItemKey(item)}
                    event={item.event}
                    repostedBy={item.repostedBy}
                    repostEvent={item.repostEvent}
                    reactedBy={item.reactedBy}
                    zappedBy={item.zappedBy}
                    profileZapRecipient={item.profileZapRecipient}
                    className="border rounded-lg"
                  />
                ))}
                {hasNextPage && (
                  <div ref={scrollRef} className={cn("col-span-full py-4", showLoadMoreButton && "flex justify-center")}>
                    {showLoadMoreButton ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                      >
                        {isFetchingNextPage ? (
                          <>
                            <Loader2 className="size-4 animate-spin mr-1.5" />
                            Loading…
                          </>
                        ) : (
                          'Load more'
                        )}
                      </Button>
                    ) : (
                      isFetchingNextPage && (
                        <div className="flex justify-center">
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div>
                {visibleItems.map((item: FeedItem) => (
                  <NoteCard
                    key={feedItemKey(item)}
                    event={item.event}
                    repostedBy={item.repostedBy}
                    repostEvent={item.repostEvent}
                    reactedBy={item.reactedBy}
                    zappedBy={item.zappedBy}
                    profileZapRecipient={item.profileZapRecipient}
                  />
                ))}
                {hasNextPage && (
                  <div ref={scrollRef} className={cn("py-4", showLoadMoreButton && "flex justify-center")}>
                    {showLoadMoreButton ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                      >
                        {isFetchingNextPage ? (
                          <>
                            <Loader2 className="size-4 animate-spin mr-1.5" />
                            Loading…
                          </>
                        ) : (
                          'Load more'
                        )}
                      </Button>
                    ) : (
                      isFetchingNextPage && (
                        <div className="flex justify-center">
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )
          ) : showSkeleton ? (
            grid ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <NoteCardSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {Array.from({ length: 5 }).map((_, i) => (
                  <NoteCardSkeleton key={i} />
                ))}
              </div>
            )
          ) : (
            <FeedEmptyState {...emptyProps} />
          )}
        </PullToRefresh>
      )}

      {/* Login/Signup dialogs (only needed on main feed) */}
      {!kinds && (
        <LoginDialog
          isOpen={loginDialogOpen}
          onClose={() => setLoginDialogOpen(false)}
          onLogin={() => setLoginDialogOpen(false)}
          onSignupClick={startSignup}
        />
      )}
    </main>
  );
}

/** Renders a saved search feed using useTabFeed (TanStack Query cached, infinite scroll). */
function SavedFeedContent({ feed }: { feed: SavedFeed }) {
  const { ref: scrollRef, inView } = useInView({ threshold: 0, rootMargin: '400px' });
  const { user } = useCurrentUser();
  const { muteItems } = useMuteList();

  // Resolve variable placeholders ($follows etc.) the same way profile tabs do
  const { filter: resolvedFilter, isLoading: isResolving } = useResolveTabFilter(
    feed.filter,
    feed.vars ?? [],
    user?.pubkey ?? '',
  );

  // Augment the resolved filter with protocol:nostr (NIP-50 2140.wtf extension)
  // to match the behavior of the core feeds and ensure latest native Nostr
  // posts are returned.
  const augmentedFilter = useMemo(() => {
    if (!resolvedFilter) return null;
    const existing = resolvedFilter.search ?? '';
    const search = existing.includes('protocol:nostr')
      ? existing
      : existing
        ? `${existing} protocol:nostr`
        : 'protocol:nostr';
    return { ...resolvedFilter, search };
  }, [resolvedFilter]);

  const {
    data: rawData,
    isLoading: isFeedLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTabFeed(augmentedFilter, `saved-${feed.id}`, !isResolving);

  const isLoading = isResolving || isFeedLoading;

  // Prefix key -- usePageRefresh does prefix matching, so this invalidates
  // the full ['tab-feed', tabKey, kindsKey, authorsKey, searchKey] used by useTabFeed.
  const queryKey = useMemo(
    () => ['tab-feed', `saved-${feed.id}`],
    [feed.id],
  );
  const handleRefresh = usePageRefresh(queryKey);

  // Infinite scroll: fetch next page when sentinel is in view
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Flatten pages, deduplicate, and filter muted content
  const derivedItems = useMemo(() => {
    if (!rawData?.pages) return [];
    const seen = new Set<string>();
    return rawData.pages
      .flatMap((page) => page.items)
      .filter((item) => {
        const key = feedItemKey(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        if (shouldHideFeedEvent(item.event)) return false;
        if (muteItems.length > 0 && isEventMuted(item.event, muteItems)) return false;
        return true;
      });
  }, [rawData?.pages, muteItems]);

  // Retain the last non-empty list so a key change / refetch never flashes the
  // empty state over content the user is reading. Resets when the saved feed
  // (or account) changes — this component is reused across saved feed tabs.
  const feedItems = useStickyFeedItems(derivedItems, `${user?.pubkey ?? ''}:${feed.id}`);

  if (isLoading && feedItems.length === 0) {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <NoteCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (feedItems.length === 0) {
    return (
      <PullToRefresh onRefresh={handleRefresh}>
        <FeedEmptyState message={`No posts found for "${feed.label}". Try adjusting your relay connections or check back later.`} />
      </PullToRefresh>
    );
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div>
        {feedItems.map((item) => (
          <NoteCard
            key={feedItemKey(item)}
            event={item.event}
            repostedBy={item.repostedBy}
            repostEvent={item.repostEvent}
            reactedBy={item.reactedBy}
            zappedBy={item.zappedBy}
            profileZapRecipient={item.profileZapRecipient}
          />
        ))}
        {hasNextPage && (
          <div ref={scrollRef} className="py-4">
            {isFetchingNextPage && (
              <div className="flex justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
        {!hasNextPage && <div ref={scrollRef} className="py-2" />}
      </div>
    </PullToRefresh>
  );
}

/** Renders a feed of posts tagged with a specific hashtag. */
function HashtagFeedContent({ tag }: { tag: string }) {
  const { nostr } = useNostr();
  const { muteItems } = useMuteList();
  const { feedSettings } = useFeedSettings();
  const kinds = getEnabledFeedKinds(feedSettings).filter((k) => !isRepostKind(k));
  const kindsKey = [...kinds].sort().join(',');

  const queryKey = useMemo(() => ['hashtag-feed', tag, kindsKey], [tag, kindsKey]);
  const handleRefresh = usePageRefresh(queryKey);

  const { data: events, isLoading } = useQuery<NostrEvent[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const ditto = nostr.group(DITTO_RELAYS);
      return ditto.query(
        [{ kinds, '#t': [tag.toLowerCase()], limit: 40 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) },
      );
    },
  });

  const derivedEvents = useMemo((): NostrEvent[] => {
    if (!events) return [];
    if (muteItems.length === 0) return events;
    return events.filter((e) => !isEventMuted(e, muteItems));
  }, [events, muteItems]);

  // Retain the last non-empty list across key changes / refetches; resets when
  // the viewed hashtag changes (this component is reused across hashtag tabs).
  const filteredEvents = useStickyFeedItems(derivedEvents, tag);

  if (isLoading && filteredEvents.length === 0) {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <NoteCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (filteredEvents.length === 0) {
    return (
      <PullToRefresh onRefresh={handleRefresh}>
        <FeedEmptyState message={`No posts found with #${tag}.`} />
      </PullToRefresh>
    );
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div>
        {filteredEvents.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </PullToRefresh>
  );
}

/** Renders a feed of posts tagged with a specific geohash. */
function GeotagFeedContent({ tag }: { tag: string }) {
  const { nostr } = useNostr();
  const { muteItems } = useMuteList();
  const { feedSettings } = useFeedSettings();
  const kinds = getEnabledFeedKinds(feedSettings).filter((k) => !isRepostKind(k));
  const kindsKey = [...kinds].sort().join(',');

  const queryKey = useMemo(() => ['geotag-feed', tag, kindsKey], [tag, kindsKey]);
  const handleRefresh = usePageRefresh(queryKey);

  const { data: events, isLoading } = useQuery<NostrEvent[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const ditto = nostr.group(DITTO_RELAYS);
      const filter = { kinds, limit: 40 } as Record<string, unknown>;
      filter['#g'] = [tag];
      return ditto.query([filter as Parameters<typeof ditto.query>[0][number]], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
    },
  });

  const derivedEvents = useMemo((): NostrEvent[] => {
    if (!events) return [];
    if (muteItems.length === 0) return events;
    return events.filter((e) => !isEventMuted(e, muteItems));
  }, [events, muteItems]);

  // Retain the last non-empty list across key changes / refetches; resets when
  // the viewed geotag changes (this component is reused across geotag tabs).
  const filteredEvents = useStickyFeedItems(derivedEvents, tag);

  if (isLoading && filteredEvents.length === 0) {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <NoteCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (filteredEvents.length === 0) {
    return (
      <PullToRefresh onRefresh={handleRefresh}>
        <FeedEmptyState message={`No posts found near ${tag}.`} />
      </PullToRefresh>
    );
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div>
        {filteredEvents.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </PullToRefresh>
  );
}

function NoteCardSkeleton() {
  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full shrink-0" />
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="flex items-center gap-6 mt-3 -ml-2">
        <Skeleton className="h-4 w-8" />
        <Skeleton className="h-4 w-8" />
        <Skeleton className="h-4 w-8" />
        <Skeleton className="h-4 w-8" />
      </div>
    </div>
  );
}
