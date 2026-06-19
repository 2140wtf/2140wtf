import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Loader2, Palette } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { LandingFeedSection } from '@/components/LandingFeedSection';
import { CalendarEventContent } from '@/components/CalendarEventContent';
import { ClassifiedListingContent } from '@/components/ClassifiedListingContent';
import { dedupeNip99Listings, isArtListing, NIP99_CLASSIFIED_KIND } from '@/lib/nip99';

/** The canonical 2140.wtf Nostr account. */
const TWO140_NPUB = 'npub1lwsmhk9t2le9see32l006khunnk6qpxxs30enke3d8lykcd6wstqegy86j';

const TWO140_PUBKEY = (() => {
  try {
    const decoded = nip19.decode(TWO140_NPUB);
    if (decoded.type === 'npub') return decoded.data as string;
  } catch {
    // ignore invalid npub
  }
  return '';
})();

const CALENDAR_KINDS = [31922, 31923];
const QUERY_TIMEOUT_MS = 15_000;

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}

function useAuthorNip99Listings(pubkey: string, limit = 3) {
  const { nostr } = useNostr();

  const { data: events = [], isLoading } = useQuery<NostrEvent[]>({
    queryKey: ['landing-nip99', pubkey],
    queryFn: async ({ signal }) => {
      if (!pubkey) return [];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
      signal?.addEventListener('abort', () => controller.abort(), { once: true });
      try {
        return await nostr.query(
          [{ kinds: [NIP99_CLASSIFIED_KIND], authors: [pubkey], limit: 12 }],
          { signal: controller.signal },
        );
      } finally {
        clearTimeout(timeoutId);
      }
    },
    enabled: !!pubkey,
    staleTime: 2 * 60 * 1000,
  });

  const listings = useMemo(
    () => dedupeNip99Listings(events).filter((l) => isArtListing(l) && l.status === 'active').slice(0, limit),
    [events, limit],
  );

  return { listings, isLoading };
}

function useAuthorCalendarEvents(pubkey: string, limit = 3) {
  const { nostr } = useNostr();

  const { data: events = [], isLoading } = useQuery<NostrEvent[]>({
    queryKey: ['landing-events', pubkey],
    queryFn: async ({ signal }) => {
      if (!pubkey) return [];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
      signal?.addEventListener('abort', () => controller.abort(), { once: true });
      try {
        return await nostr.query(
          [{ kinds: CALENDAR_KINDS, authors: [pubkey], limit: 20 }],
          { signal: controller.signal },
        );
      } finally {
        clearTimeout(timeoutId);
      }
    },
    enabled: !!pubkey,
    staleTime: 2 * 60 * 1000,
  });

  const items = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const latest = new Map<string, NostrEvent>();
    for (const event of events) {
      const dTag = getTag(event, 'd');
      if (!dTag) continue;
      const key = `${event.pubkey}:${dTag}`;
      const existing = latest.get(key);
      if (!existing) {
        latest.set(key, event);
      } else if (event.kind === 31923 && existing.kind !== 31923) {
        latest.set(key, event);
      } else if (event.kind === existing.kind && event.created_at > existing.created_at) {
        latest.set(key, event);
      }
    }

    return Array.from(latest.values())
      .sort((a, b) => {
        const aStart = parseInt(getTag(a, 'start') ?? '0', 10);
        const bStart = parseInt(getTag(b, 'start') ?? '0', 10);
        const aFuture = aStart >= now;
        const bFuture = bStart >= now;
        if (aFuture && !bFuture) return -1;
        if (!aFuture && bFuture) return 1;
        if (aFuture && bFuture) return aStart - bStart;
        return bStart - aStart;
      })
      .slice(0, limit);
  }, [events, limit]);

  return { events: items, isLoading };
}

function LandingEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--2140-border)] bg-[var(--2140-surface)] p-8 text-center">
      <p className="text-[var(--2140-muted)]">{message}</p>
    </div>
  );
}

function SectionSpinner() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="size-6 animate-spin text-[var(--2140-muted)]" />
    </div>
  );
}

/** 2140.wtf branded landing page, based on the Open Design home-page concept. */
export function LandingPage() {
  const { listings: artListings, isLoading: artLoading } = useAuthorNip99Listings(TWO140_PUBKEY, 3);
  const { events: calendarEvents, isLoading: eventsLoading } = useAuthorCalendarEvents(TWO140_PUBKEY, 3);

  return (
    <div className="min-h-full text-[var(--2140-fg)]">
      {/* Hero */}
      <section className="border-b border-[var(--2140-border)] px-4 pb-16 pt-10 sm:pt-14">
        <div className="mx-auto max-w-[1100px]">
          <img
            src="/logo.jpg"
            alt="2140.wtf"
            className="mb-6 h-32 sm:h-40 md:h-52 lg:h-64 w-auto"
          />
          <p className="mb-8 max-w-[62ch] text-[clamp(1.125rem,2.5vw,1.5rem)] text-[var(--2140-muted)]">
            The home for Bitcoin art, events, and writing on Nostr. A feed-native client based on Ditto app, made for the bitcoin culture that outlives the cycles.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to={`/${TWO140_NPUB}`}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--2140-bitcoin)] px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[var(--2140-bitcoin-hover)]"
            >
              Explore the feed <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Art */}
      <section className="border-b border-[var(--2140-border)] px-4 py-16" id="art">
        <div className="mx-auto max-w-[1100px]">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="mb-2 font-[family-name:var(--font-mono)] text-[0.75rem] uppercase tracking-[0.08em] text-[var(--2140-muted)]">NIP-99 Listings</p>
              <h2 className="flex items-center gap-2 text-2xl font-bold">
                <Palette className="size-5 text-[var(--2140-bitcoin)]" /> Art
              </h2>
            </div>
            <Link to="/art" className="whitespace-nowrap text-sm font-medium text-[var(--2140-nostr)] hover:text-[var(--2140-nostr-hover)]">
              Browse marketplace →
            </Link>
          </div>

          {artLoading ? (
            <SectionSpinner />
          ) : artListings.length === 0 ? (
            <LandingEmptyState message="Nothing is happening at the moment." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {artListings.map((listing) => (
                <Link
                  key={listing.id}
                  to={`/${nip19.naddrEncode({ kind: listing.event.kind, pubkey: listing.pubkey, identifier: listing.dTag })}`}
                  className="group block rounded-[var(--radius-lg)] border border-[var(--2140-border)] bg-[var(--2140-surface)] p-5 transition-colors hover:border-[var(--2140-border-hover)] hover:bg-[var(--2140-raised)]"
                >
                  <ClassifiedListingContent event={listing.event} compact />
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Events */}
      <section className="border-b border-[var(--2140-border)] px-4 py-16" id="events">
        <div className="mx-auto max-w-[1100px]">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="mb-2 font-[family-name:var(--font-mono)] text-[0.75rem] uppercase tracking-[0.08em] text-[var(--2140-muted)]">Calendar</p>
              <h2 className="flex items-center gap-2 text-2xl font-bold">
                <CalendarDays className="size-5 text-[var(--2140-bitcoin)]" /> Events
              </h2>
            </div>
            <Link to="/events" className="whitespace-nowrap text-sm font-medium text-[var(--2140-nostr)] hover:text-[var(--2140-nostr-hover)]">
              Full calendar →
            </Link>
          </div>

          {eventsLoading ? (
            <SectionSpinner />
          ) : calendarEvents.length === 0 ? (
            <LandingEmptyState message="Nothing is happening at the moment." />
          ) : (
            <div className="flex flex-col gap-4">
              {calendarEvents.map((event) => {
                const dTag = getTag(event, 'd') ?? '';
                return (
                  <Link
                    key={event.id}
                    to={`/${nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: dTag })}`}
                    className="block transition-opacity hover:opacity-90"
                  >
                    <CalendarEventContent event={event} compact />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Live Nostr feed preview */}
      <LandingFeedSection />

      {/* Footer */}
      <footer className="px-4 py-12 text-sm text-[var(--2140-muted)]">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-[family-name:var(--font-display)] text-xl font-bold tracking-[-0.04em]">
            <img src="/logo.jpg" alt="2140.wtf" className="h-7 w-auto" />
          </div>
          <div className="flex gap-5">
            <a href="https://2140.wtf" target="_blank" rel="noreferrer" className="hover:text-[var(--2140-fg)]">2140.wtf</a>
            <Link to="/settings/network" className="hover:text-[var(--2140-fg)]">Relays</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
