import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type { ReactNode } from 'react';

import { useWot } from './useWot';

// Control the relay response per-test.
const query = vi.fn<(filters: NostrFilter[]) => Promise<NostrEvent[]>>();
vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query } }),
}));

// No cached contact lists — relay responses drive every test.
vi.mock('@/hooks/useNostrStorage', () => ({
  useNostrStorage: () => ({
    store: { query: vi.fn().mockResolvedValue([]), event: vi.fn().mockResolvedValue(undefined) },
  }),
}));

function pk(n: number): string {
  return n.toString(16).padStart(64, '0');
}

const ANCHOR = pk(1);
const ALICE = pk(2);
const BOB = pk(3);
const CAROL = pk(4);
const EVE = pk(5);

const useCurrentUserMock = vi.fn<() => { user?: { pubkey: string } }>();
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => useCurrentUserMock(),
}));

let idCounter = 0;
function kind3(pubkey: string, follows: string[], createdAt = 1000): NostrEvent {
  return {
    id: (idCounter++).toString(16).padStart(64, '0'),
    pubkey,
    kind: 3,
    created_at: createdAt,
    tags: follows.map((f) => ['p', f]),
    content: '',
    sig: 'c'.repeat(128),
  };
}

/** Route kind-3 queries by author: the anchor gets their own list, everyone else their follow lists. */
function serveGraph(lists: Map<string, NostrEvent>) {
  query.mockImplementation((filters: NostrFilter[]) => {
    const authors = filters.flatMap((f) => f.authors ?? []);
    return Promise.resolve(
      authors.map((author) => lists.get(author)).filter((e): e is NostrEvent => !!e),
    );
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useWot', () => {
  beforeEach(() => {
    query.mockReset();
    useCurrentUserMock.mockReset();
    useCurrentUserMock.mockReturnValue({ user: { pubkey: ANCHOR } });
  });

  it('scores candidates from a depth-2 graph fetched from relays', async () => {
    // ANCHOR -> ALICE; ALICE -> BOB; BOB -> CAROL. EVE is unknown.
    serveGraph(
      new Map([
        [ANCHOR, kind3(ANCHOR, [ALICE])],
        [ALICE, kind3(ALICE, [BOB])],
        [BOB, kind3(BOB, [CAROL])],
      ]),
    );

    const { result } = renderHook(() => useWot([ALICE, BOB, CAROL, EVE]), { wrapper });

    await waitFor(() => expect(result.current.scores.get(BOB)?.distance).toBe(2));

    expect(result.current.scores.get(ALICE)).toMatchObject({ score: 1 / 2, distance: 1 });
    expect(result.current.scores.get(BOB)).toMatchObject({ score: 1 / 3, distance: 2 });
    // CAROL is at distance 3 — beyond the default depth budget.
    expect(result.current.scores.get(CAROL)).toMatchObject({ score: 0, distance: null });
    expect(result.current.scores.get(EVE)).toMatchObject({ score: 0, distance: null });
  });

  it('scores every candidate 0 when the anchor has no kind 3', async () => {
    query.mockResolvedValue([]);

    const { result } = renderHook(() => useWot([ALICE, BOB]), { wrapper });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.scores.get(ALICE)).toMatchObject({ score: 0, distance: null });
    expect(result.current.scores.get(BOB)).toMatchObject({ score: 0, distance: null });
  });

  it('does not throw when the depth-1 follow-list fetch fails', async () => {
    query.mockImplementation((filters: NostrFilter[]) => {
      const authors = filters.flatMap((f) => f.authors ?? []);
      if (authors.includes(ANCHOR) && authors.length === 1) {
        return Promise.resolve([kind3(ANCHOR, [ALICE])]);
      }
      return Promise.reject(new Error('relay down'));
    });

    const { result } = renderHook(() => useWot([ALICE, BOB]), { wrapper });

    await waitFor(() => expect(result.current.scores.get(ALICE)?.distance).toBe(1));

    // Depth-1 graph still scores direct follows; BOB is now unreachable.
    expect(result.current.scores.get(ALICE)).toMatchObject({ score: 1 / 2, distance: 1 });
    expect(result.current.scores.get(BOB)).toMatchObject({ score: 0, distance: null });
  });

  it('uses the current user as the default anchor and honors an explicit anchor', async () => {
    const communityAnchor = pk(9);
    serveGraph(
      new Map([
        [ANCHOR, kind3(ANCHOR, [ALICE])],
        [communityAnchor, kind3(communityAnchor, [BOB])],
        [ALICE, kind3(ALICE, [])],
        [BOB, kind3(BOB, [])],
      ]),
    );

    const { result } = renderHook(
      () => useWot([ALICE, BOB], { anchor: communityAnchor }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.scores.get(BOB)?.distance).toBe(1));

    expect(result.current.scores.get(BOB)).toMatchObject({ score: 1 / 2, distance: 1 });
    expect(result.current.scores.get(ALICE)).toMatchObject({ score: 0, distance: null });
  });

  it('returns zero scores while loading', () => {
    query.mockReturnValue(new Promise<NostrEvent[]>(() => {}));

    const { result } = renderHook(() => useWot([ALICE]), { wrapper });

    expect(result.current.scores.get(ALICE)).toEqual({
      score: 0,
      distance: null,
      followersWithin: 0,
    });
  });
});
