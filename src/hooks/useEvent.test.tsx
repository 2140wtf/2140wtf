import type { NostrEvent } from '@nostrify/nostrify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAddrEvent, useEvent } from './useEvent';

const primaryQuery = vi.fn<(...args: unknown[]) => Promise<NostrEvent[]>>();
const relayQuery = vi.fn<(url: string, filters: unknown) => Promise<NostrEvent[]>>();

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({
    nostr: {
      query: primaryQuery,
      relay: (url: string) => ({
        query: (filters: unknown) => relayQuery(url, filters),
      }),
    },
  }),
}));

const storeQuery = vi.fn<(...args: unknown[]) => Promise<NostrEvent[]>>();
const storeEvent = vi.fn<(event: NostrEvent) => Promise<void>>();

vi.mock('@/hooks/useNostrStorage', () => ({
  useNostrStorage: () => ({ store: { query: storeQuery, event: storeEvent } }),
}));

vi.mock('@/hooks/useCacheFirstSeed', () => ({
  useCacheFirstSeed: vi.fn(),
}));

// The addressable fetch reads the effective relay list so it can ask each relay
// directly (the pooled query resolves on the first EOSE and can miss a slower
// relay). Tests below replace `appConfig.value` to control that list.
type RelayEntry = { url: string; read: boolean; write: boolean };
const appConfig = vi.hoisted(() => ({
  value: {
    relayMetadata: { relays: [] as RelayEntry[], updatedAt: 0 },
    useAppRelays: false,
    useUserRelays: false,
  },
}));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: appConfig.value }),
}));

const PUBKEY = '3'.repeat(64);
const EVENT_ID = '4'.repeat(64);
const IDENTIFIER = '1703274404';

const relayList: NostrEvent = {
  id: '1'.repeat(64),
  pubkey: PUBKEY,
  kind: 10002,
  created_at: 200,
  content: '',
  tags: [['r', 'wss://author.example/']],
  sig: 'a'.repeat(128),
};

const streamEvent: NostrEvent = {
  id: EVENT_ID,
  pubkey: PUBKEY,
  kind: 30311,
  created_at: 100,
  content: '',
  tags: [['d', IDENTIFIER], ['title', 'Test stream']],
  sig: 'b'.repeat(128),
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('event outbox resolution', () => {
  beforeEach(() => {
    primaryQuery.mockReset();
    relayQuery.mockReset();
    storeQuery.mockReset();
    storeEvent.mockReset();
    storeQuery.mockResolvedValue([]);
    storeEvent.mockResolvedValue();
    appConfig.value = {
      relayMetadata: { relays: [], updatedAt: 0 },
      useAppRelays: false,
      useUserRelays: false,
    };

    primaryQuery.mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'));
    relayQuery.mockImplementation(async (url) => {
      if (url === 'wss://relay.ditto.pub/') return [relayList];
      if (url === 'wss://author.example/') return [streamEvent];
      return [];
    });
  });

  it('finds an addressable event after the configured relay query times out', async () => {
    const { result } = renderHook(
      () => useAddrEvent({ kind: 30311, pubkey: PUBKEY, identifier: IDENTIFIER }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toEqual(streamEvent));
    expect(relayQuery).toHaveBeenCalledWith(
      'wss://author.example/',
      [{ kinds: [30311], authors: [PUBKEY], '#d': [IDENTIFIER], limit: 1 }],
    );
    expect(storeEvent).toHaveBeenCalledWith(streamEvent);
  });

  it('finds an addressable event on a read relay the pooled query never returns', async () => {
    // The pooled query resolves on the first relay EOSE, so an event held only
    // by a slower relay used to end in "Event not found". No relay hints and no
    // author relay list here: the configured read relay is the only source.
    appConfig.value = {
      relayMetadata: {
        relays: [{ url: 'wss://slow.example/', read: true, write: false }],
        updatedAt: 0,
      },
      useAppRelays: false,
      useUserRelays: true,
    };
    relayQuery.mockImplementation(async (url) =>
      url === 'wss://slow.example/' ? [streamEvent] : [],
    );

    const { result } = renderHook(
      () => useAddrEvent({ kind: 30311, pubkey: PUBKEY, identifier: IDENTIFIER }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toEqual(streamEvent));
    expect(relayQuery).toHaveBeenCalledWith(
      'wss://slow.example/',
      [{ kinds: [30311], authors: [PUBKEY], '#d': [IDENTIFIER], limit: 1 }],
    );
  });

  it('finds an immutable event after the configured relay query times out', async () => {
    const { result } = renderHook(() => useEvent(EVENT_ID, undefined, PUBKEY), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(streamEvent));
    expect(relayQuery).toHaveBeenCalledWith(
      'wss://author.example/',
      [{ ids: [EVENT_ID], limit: 1 }],
    );
    expect(storeEvent).toHaveBeenCalledWith(streamEvent);
  });
});
