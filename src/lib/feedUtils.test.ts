import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { getPaginationCursor } from './feedUtils';

function ev(created_at: number): NostrEvent {
  return {
    id: 'x'.repeat(64),
    pubkey: 'y'.repeat(64),
    created_at,
    kind: 1,
    tags: [],
    content: '',
    sig: 'z'.repeat(128),
  };
}

const DAY = 86_400;

describe('getPaginationCursor', () => {
  it('returns now for an empty page', () => {
    const before = Math.floor(Date.now() / 1000);
    expect(getPaginationCursor([])).toBeGreaterThanOrEqual(before);
  });

  it('returns the single event timestamp for a one-event page', () => {
    expect(getPaginationCursor([ev(123)])).toBe(123);
  });

  it('returns the oldest timestamp for a dense page', () => {
    // 10 events, 1 minute apart — no stragglers possible.
    const base = 1_800_000_000;
    const events = Array.from({ length: 10 }, (_, i) => ev(base - i * 60));
    expect(getPaginationCursor(events)).toBe(base - 9 * 60);
  });

  it('advances at least half the page on a sparse feed (daily posters)', () => {
    // Regression: the old 6h-gap rule cut at the first gap below the NEWEST
    // event, collapsing the cursor to the top of the page — each subsequent
    // page re-fetched the same events and the feed stalled after ~2 pages.
    const base = 1_800_000_000;
    const events = Array.from({ length: 45 }, (_, i) => ev(base - i * DAY));
    const cursor = getPaginationCursor(events);
    // Every consecutive pair is ≥6h apart; the first gap with ≥half the page
    // above it is at index 22 → cursor 22 days back.
    expect(cursor).toBe(base - 22 * DAY);
    // The next page (until = cursor - 1) re-fetches the 22 older events as
    // duplicates and continues further back — progress, not a stall.
    const nextPageOverlap = events.filter((e) => e.created_at <= cursor - 1).length;
    expect(nextPageOverlap).toBe(22);
  });

  it('ignores a small straggler tail instead of jumping to it', () => {
    // 27 recent events plus 3 ancient events from an out-of-sync relay.
    const base = 1_800_000_000;
    const recent = Array.from({ length: 27 }, (_, i) => ev(base - i * 60));
    const ancient = [ev(base - 400 * DAY), ev(base - 401 * DAY), ev(base - 402 * DAY)];
    const cursor = getPaginationCursor([...recent, ...ancient]);
    // 30 events → index 27 → the first ancient event, not the oldest one.
    expect(cursor).toBeGreaterThan(base - 2 * DAY);
  });
});
