import type { NostrEvent } from '@nostrify/nostrify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMusicArtists } from './useMusicArtists';

const queryMock = vi.fn<(filters: unknown) => Promise<NostrEvent[]>>();
const groupQueryMock = vi.fn<(filters: unknown) => Promise<NostrEvent[]>>();

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({
    nostr: {
      query: (filters: unknown) => queryMock(filters),
      group: () => ({ query: (filters: unknown) => groupQueryMock(filters) }),
    },
  }),
}));

const CURATED_PUBKEY = 'a'.repeat(64);
const RECENT_PUBKEY = 'b'.repeat(64);
/** Released outside the newest-200 window; only the roster query can find them. */
const OLDER_PUBKEY = 'c'.repeat(64);
const NO_AUDIO_PUBKEY = 'd'.repeat(64);

function track(pubkey: string, overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: `${pubkey.slice(0, 8)}${'0'.repeat(56)}`,
    pubkey,
    kind: 36787,
    created_at: 1_700_000_000,
    content: '',
    tags: [
      ['d', pubkey.slice(0, 8)],
      ['title', 'Track'],
      ['url', 'https://media.example/track.mp3'],
    ],
    sig: 'e'.repeat(128),
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  queryMock.mockReset();
  groupQueryMock.mockReset();

  queryMock.mockImplementation(async (filters) => {
    const [filter] = filters as { kinds: number[]; '#d'?: string[] }[];
    if (filter.kinds.includes(30000)) {
      return [
        {
          id: 'f'.repeat(64),
          pubkey: '1'.repeat(64),
          kind: 30000,
          created_at: 1_700_000_000,
          content: '',
          tags: [
            ['d', filter['#d']?.[0] ?? ''],
            ['p', CURATED_PUBKEY],
          ],
          sig: 'f'.repeat(128),
        },
      ];
    }
    // Recent-tracks window: the older artist is absent from it.
    return [track(RECENT_PUBKEY), track(RECENT_PUBKEY, { id: '9'.repeat(64) })];
  });

  groupQueryMock.mockImplementation(async () => [
    track(RECENT_PUBKEY),
    track(OLDER_PUBKEY),
    // No audio URL: must not make its author an artist.
    track(NO_AUDIO_PUBKEY, { tags: [['d', 'no-audio'], ['title', 'Broken']] }),
  ]);
});

describe('useMusicArtists', () => {
  it('lists an artist whose tracks predate the recent-track window', async () => {
    const { result } = renderHook(() => useMusicArtists(), { wrapper });

    await waitFor(() =>
      expect(result.current.artists.map((a) => a.pubkey)).toContain(OLDER_PUBKEY),
    );
  });

  it('keeps curated artists first, without duplicates, and carries track counts', async () => {
    const { result } = renderHook(() => useMusicArtists(), { wrapper });

    await waitFor(() => expect(result.current.artists[0]?.pubkey).toBe(CURATED_PUBKEY));

    const pubkeys = result.current.artists.map((a) => a.pubkey);
    expect(pubkeys[0]).toBe(CURATED_PUBKEY);
    expect(pubkeys.filter((pk) => pk === RECENT_PUBKEY)).toHaveLength(1);
    expect(result.current.artists.find((a) => a.pubkey === RECENT_PUBKEY)?.trackCount).toBe(2);
  });

  it('ignores tracks that carry no audio URL', async () => {
    const { result } = renderHook(() => useMusicArtists(), { wrapper });

    await waitFor(() =>
      expect(result.current.artists.map((a) => a.pubkey)).toContain(OLDER_PUBKEY),
    );

    expect(result.current.artists.map((a) => a.pubkey)).not.toContain(NO_AUDIO_PUBKEY);
  });
});
