import { describe, expect, it } from 'vitest';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import {
  BACKFILL_PAGE_SIZE,
  MAX_BACKFILL_PAGES,
  paginateBackfill,
} from './nip17Backfill';

const PUBKEY = 'a'.repeat(64);

/** A minimal valid-looking kind-1059 wrap with a controlled created_at. */
function wrap(id: string, createdAt: number): NostrEvent {
  return {
    id,
    pubkey: 'b'.repeat(64),
    kind: 1059,
    tags: [['p', PUBKEY]],
    content: 'x',
    created_at: createdAt,
    sig: '0'.repeat(128),
  } as NostrEvent;
}

/** In-memory relay store: newest-first paging over a fixed event list. */
function makeStore(events: NostrEvent[]) {
  const seenFilters: NostrFilter[] = [];
  return {
    seenFilters,
    fetchPage: async (filter: NostrFilter): Promise<NostrEvent[]> => {
      seenFilters.push({ ...filter });
      let batch = [...events].sort((a, b) => b.created_at - a.created_at);
      if (typeof filter.until === 'number') {
        batch = batch.filter((e) => e.created_at < filter.until!);
      }
      return batch.slice(0, filter.limit ?? BACKFILL_PAGE_SIZE);
    },
  };
}

async function collect(gen: AsyncGenerator<NostrEvent>): Promise<NostrEvent[]> {
  const out: NostrEvent[] = [];
  for await (const event of gen) out.push(event);
  return out;
}

describe('paginateBackfill', () => {
  it('walks the whole inbox backwards until an empty page', async () => {
    const events = Array.from({ length: BACKFILL_PAGE_SIZE + 7 }, (_, i) =>
      wrap(`id${i}`, 10_000 - i),
    );
    const store = makeStore(events);

    const collected = await collect(paginateBackfill(store.fetchPage, { pubkey: PUBKEY, kind: 1059 }));

    expect(collected.length).toBe(events.length);
    // Newest first within each page; overall every event seen exactly once.
    expect(new Set(collected.map((e) => e.id)).size).toBe(events.length);

    // Every page filter targets the right kind/#p and pages advance via until.
    for (const filter of store.seenFilters) {
      expect(filter.kinds).toEqual([1059]);
      expect(filter['#p']).toEqual([PUBKEY]);
      expect(filter.limit).toBe(BACKFILL_PAGE_SIZE);
    }
    const untils = store.seenFilters
      .map((f) => f.until)
      .filter((u): u is number => typeof u === 'number');
    expect(untils.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < untils.length; i++) {
      expect(untils[i]).toBeLessThan(untils[i - 1]);
    }
  });

  it('deduplicates events repeated across pages', async () => {
    const events = Array.from({ length: 12 }, (_, i) => wrap(`id${i}`, 5_000 - i));
    let calls = 0;
    const fetchPage = async (filter: NostrFilter) => {
      calls++;
      const base = await makeStore(events).fetchPage(filter);
      // Overlap: every page after the first also replays the newest event.
      if (calls > 1) return [events[0], ...base];
      return base;
    };

    const collected = await collect(paginateBackfill(fetchPage, { pubkey: PUBKEY, kind: 1059 }));
    const ids = collected.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stops at the page cap even with a hostile bottomless inbox', async () => {
    // Every page returns fresh older events forever.
    const fetchPage = async (filter: NostrFilter): Promise<NostrEvent[]> => {
      const until = typeof filter.until === 'number' ? filter.until : Date.now() / 1000;
      return Array.from({ length: BACKFILL_PAGE_SIZE }, (_, i) =>
        wrap(`id-${until}-${i}`, until - 1 - i),
      );
    };

    const collected = await collect(paginateBackfill(fetchPage, { pubkey: PUBKEY, kind: 1059 }));
    expect(collected.length).toBe(BACKFILL_PAGE_SIZE * MAX_BACKFILL_PAGES);
  });

  it('terminates on a same-second cluster larger than a page (no-progress guard)', async () => {
    // 150 events all at the same second: page 2's `until` cannot advance.
    const events = Array.from({ length: 150 }, (_, i) => wrap(`same${i}`, 42));
    const store = makeStore(events);

    const collected = await collect(paginateBackfill(store.fetchPage, { pubkey: PUBKEY, kind: 1059 }));
    // First page only; the loop stops instead of spinning forever.
    expect(collected.length).toBe(BACKFILL_PAGE_SIZE);
    expect(store.seenFilters.length).toBeLessThanOrEqual(2);
  });

  it('yields nothing for an empty inbox', async () => {
    const store = makeStore([]);
    const collected = await collect(paginateBackfill(store.fetchPage, { pubkey: PUBKEY, kind: 1059 }));
    expect(collected).toEqual([]);
    expect(store.seenFilters.length).toBe(1);
  });
});
