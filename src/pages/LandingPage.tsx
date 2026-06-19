import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { LandingFeedSection } from '@/components/LandingFeedSection';

/** The canonical 2140.wtf Nostr account. */
const TWO140_NPUB = 'npub1lwsmhk9t2le9see32l006khunnk6qpxxs30enke3d8lykcd6wstqegy86j';

interface EventItemProps {
  month: string;
  day: string;
  title: string;
  location: string;
}

function EventItem({ month, day, title, location }: EventItemProps) {
  return (
    <article className="grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--2140-border)] bg-[var(--2140-surface)] p-4 transition-colors hover:border-[var(--2140-border-hover)] hover:bg-[var(--2140-raised)] max-sm:grid-cols-[auto_1fr]">
      <div className="flex h-14 w-14 flex-col items-center justify-center rounded-[var(--radius-md)] border border-[var(--2140-border)] bg-[var(--2140-raised)]">
        <span className="font-[family-name:var(--font-mono)] text-[0.6875rem] uppercase text-[var(--2140-nostr)]">{month}</span>
        <span className="font-[family-name:var(--font-mono)] text-[1.25rem] font-bold">{day}</span>
      </div>
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-[0.8125rem] text-[var(--2140-muted)]">{location}</p>
      </div>
      <Link
        to="/events"
        className="whitespace-nowrap text-[0.8125rem] font-semibold text-[var(--2140-bitcoin)] hover:text-[var(--2140-bitcoin-hover)] max-sm:col-span-full max-sm:justify-self-start"
      >
        View calendar
      </Link>
    </article>
  );
}

/** 2140.wtf branded landing page, based on the Open Design home-page concept. */
export function LandingPage() {
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
          <div className="flex flex-col gap-3">
            <EventItem month="Jun" day="21" title="2140 Summer Solstice Meetup" location="Nostr Live Stage · Online" />
            <EventItem month="Jul" day="04" title="Bitcoin Independence Day Screening" location="PubKey · New York" />
            <EventItem month="Aug" day="12" title="Nostr Hack Day: Ditto Track" location="Factory Berlin · Germany" />
          </div>
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
