import { useEffect, useMemo, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useSearchParams } from 'react-router-dom';
import { NoteCard } from '@/components/NoteCard';
import { Button } from '@/components/ui/button';
import LoginDialog from '@/components/auth/LoginDialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFeed } from '@/hooks/useFeed';
import { useOnboarding } from '@/hooks/useOnboarding';
import { cn } from '@/lib/utils';
import type { FeedItem } from '@/lib/feedUtils';

/** Feed scopes modelled after the BAO global-chat tab pattern. */
type FeedMode = 'follows' | 'global' | 'bitcoin' | 'nostr' | 'art' | 'events' | 'articles';

interface FeedTabConfig {
  mode: FeedMode;
  label: string;
  icon: string;
}

const FEED_TABS: FeedTabConfig[] = [
  { mode: 'follows', label: 'Follows', icon: '👥' },
  { mode: 'global', label: 'Global', icon: '🌐' },
  { mode: 'bitcoin', label: 'Bitcoin', icon: '₿' },
  { mode: 'nostr', label: 'Nostr', icon: '🟣' },
  { mode: 'art', label: 'Art', icon: '🎨' },
  { mode: 'events', label: 'Events', icon: '📅' },
  { mode: 'articles', label: 'Articles', icon: '📝' },
];

const VALID_MODES = new Set(FEED_TABS.map((t) => t.mode));

function isValidMode(value: string | null): value is FeedMode {
  return !!value && VALID_MODES.has(value as FeedMode);
}

function useLandingFeedMode(): [FeedMode, (mode: FeedMode) => void] {
  const { user } = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const defaultMode: FeedMode = user ? 'follows' : 'global';

  const mode: FeedMode = useMemo(() => {
    const param = searchParams.get('feedTab');
    return isValidMode(param) ? param : defaultMode;
  }, [searchParams, defaultMode]);

  const setMode = (next: FeedMode) => {
    const params = new URLSearchParams(searchParams);
    if (next === defaultMode) {
      params.delete('feedTab');
    } else {
      params.set('feedTab', next);
    }
    setSearchParams(params, { replace: true });
  };

  return [mode, setMode];
}

function getFeedArgs(mode: FeedMode): { tab: 'follows' | 'global'; options?: { kinds?: number[]; tagFilters?: Record<string, string[]> } } {
  switch (mode) {
    case 'follows':
      return { tab: 'follows' };
    case 'bitcoin':
      return { tab: 'global', options: { tagFilters: { '#t': ['bitcoin'] } } };
    case 'nostr':
      return { tab: 'global', options: { tagFilters: { '#t': ['nostr'] } } };
    case 'art':
      return { tab: 'global', options: { kinds: [30402] } };
    case 'events':
      return { tab: 'global', options: { kinds: [31922, 31923] } };
    case 'articles':
      return { tab: 'global', options: { kinds: [30023] } };
    case 'global':
    default:
      return { tab: 'global' };
  }
}

/** A real Nostr feed preview for the landing page, with BAO-style topic tabs. */
export function LandingFeedSection() {
  const { user } = useCurrentUser();
  const [mode, setMode] = useLandingFeedMode();
  const { startSignup } = useOnboarding();
  const [loginOpen, setLoginOpen] = useState(false);

  const { tab, options } = getFeedArgs(mode);
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeed(tab, options);

  const { ref: sentinelRef, inView } = useInView({ threshold: 0, rootMargin: '200px' });

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = useMemo(() => {
    const seen = new Set<string>();
    return (data?.pages ?? [])
      .flatMap((page) => page.items)
      .filter((item: FeedItem) => {
        const key = item.event.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [data]);

  const handleTabChange = (next: FeedMode) => {
    if (next === 'follows' && !user) {
      setLoginOpen(true);
      return;
    }
    setMode(next);
  };

  return (
    <section className="border-b border-[var(--2140-border)] px-4 py-16" id="feed">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 font-[family-name:var(--font-mono)] text-[0.75rem] uppercase tracking-[0.08em] text-[var(--2140-muted)]">
              Live Nostr feed
            </p>
            <h2 className="flex items-center gap-2 text-2xl font-bold">
              <span role="img" aria-label="feed">
                ⚡
              </span>{' '}
              Feed
            </h2>
          </div>
        </div>

        {/* BAO-style sticky tab bar */}
        <div className="sticky top-0 z-30 -mx-4 mb-6 border-b border-[var(--2140-border)] bg-[var(--2140-bg)] px-4 py-2 sm:-mx-0 sm:px-0">
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide" role="tablist">
            {FEED_TABS.map((tabConfig) => {
              const active = mode === tabConfig.mode;
              return (
                <button
                  key={tabConfig.mode}
                  onClick={() => handleTabChange(tabConfig.mode)}
                  role="tab"
                  aria-selected={active}
                  disabled={tabConfig.mode === 'follows' && !user}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--2140-bitcoin)]',
                    active
                      ? 'bg-[var(--2140-bitcoin)] text-black'
                      : 'text-[var(--2140-muted)] hover:bg-[var(--2140-surface)] hover:text-[var(--2140-fg)]',
                    tabConfig.mode === 'follows' && !user && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span aria-hidden="true">{tabConfig.icon}</span>
                  {tabConfig.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Feed content */}
        <div className="flex flex-col gap-4">
          {isPending && (
            <div className="space-y-4">
              <FeedSkeleton />
              <FeedSkeleton />
              <FeedSkeleton />
            </div>
          )}

          {!isPending && isError && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--2140-border)] bg-[var(--2140-surface)] p-6 text-center text-[var(--2140-muted)]">
              Couldn’t load the feed. Check your relays and try again.
            </div>
          )}

          {!isPending && !isError && items.length === 0 && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--2140-border)] bg-[var(--2140-surface)] p-6 text-center text-[var(--2140-muted)]">
              {mode === 'follows'
                ? 'Follow some people to see their notes here.'
                : 'No notes found for this feed yet.'}
            </div>
          )}

          {items.map((item) => (
            <NoteCard
              key={item.event.id}
              event={item.event}
              repostedBy={item.repostedBy}
              repostEvent={item.repostEvent}
              reactedBy={item.reactedBy}
              zappedBy={item.zappedBy}
              profileZapRecipient={item.profileZapRecipient}
            />
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />

          {hasNextPage && (
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="mx-auto w-full max-w-xs border-[var(--2140-border)] bg-transparent text-[var(--2140-fg)] hover:bg-[var(--2140-surface)]"
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      </div>

      <LoginDialog
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onLogin={() => setLoginOpen(false)}
        onSignupClick={startSignup}
      />
    </section>
  );
}

function FeedSkeleton() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--2140-border)] bg-[var(--2140-surface)] p-5">
      <div className="mb-3.5 flex items-center gap-3">
        <div className="size-10 animate-pulse rounded-full bg-[var(--2140-raised)]" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--2140-raised)]" />
          <div className="h-2 w-1/4 animate-pulse rounded bg-[var(--2140-raised)]" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-[var(--2140-raised)]" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-[var(--2140-raised)]" />
      </div>
    </div>
  );
}
