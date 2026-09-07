import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

/** Wraps requested per backfill page (relay `limit`). */
export const BACKFILL_PAGE_SIZE = 100;

/** Hard cap on backfill pages — bounds work for pathological inboxes. */
export const MAX_BACKFILL_PAGES = 10;

interface PaginateOptions {
  /** The inbox owner — gift wraps are `#p`-tagged to them. */
  pubkey: string;
  /** Outer wrap kind (1059 for NIP-17). */
  kind: number;
}

type FetchPage = (filter: NostrFilter) => Promise<NostrEvent[]>;

/**
 * Paginate a gift-wrap inbox backwards in time until exhausted.
 *
 * A single `limit: N` page is not a complete inbox: NPool resolves grouped
 * queries after the first relay EOSE (+ a ~1s grace window), so what a
 * one-page query returns depends on relay timing. Walking backwards with
 * `until` cursors until a page yields nothing new gives a deterministic,
 * complete snapshot independent of relay latency.
 *
 * Overlapping pages are deduplicated by event id, and a no-progress guard
 * plus the page cap guarantee termination even on degenerate relay stores.
 */
export async function* paginateBackfill(
  fetchPage: FetchPage,
  opts: PaginateOptions,
): AsyncGenerator<NostrEvent> {
  const seen = new Set<string>();
  let until: number | undefined;

  for (let page = 0; page < MAX_BACKFILL_PAGES; page++) {
    const filter: NostrFilter = {
      kinds: [opts.kind],
      '#p': [opts.pubkey],
      limit: BACKFILL_PAGE_SIZE,
    };
    if (until !== undefined) filter.until = until;

    const batch = await fetchPage(filter);
    const fresh = batch.filter((event) => {
      if (!event || typeof event.id !== 'string' || seen.has(event.id)) return false;
      return typeof event.created_at === 'number' && Number.isFinite(event.created_at);
    });
    // Page fully covered by earlier pages → exhausted.
    if (fresh.length === 0) return;

    let oldest = Infinity;
    for (const event of fresh) {
      seen.add(event.id);
      if (event.created_at < oldest) oldest = event.created_at;
    }

    const nextUntil = oldest;
    // Unseen events sharing the cursor's second cannot advance the cursor.
    if (until !== undefined && nextUntil >= until) return;

    until = nextUntil;
    for (const event of fresh) yield event;
  }
}
