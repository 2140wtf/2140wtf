import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useNutzapReceiver } from './useNutzapReceiver';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { deriveNutzapKey } from '@/lib/cashu/cashu';
import type { NostrEvent } from '@nostrify/nostrify';

const mocks = vi.hoisted(() => ({
  currentUser: null as { pubkey: string } | null,
  nutzapsEnabled: true,
  published: [] as { kind: number; tags: string[][]; prev?: NostrEvent | null }[],
  freshEvent: null as NostrEvent | null,
  nostrQuery: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.currentUser }),
}));

vi.mock('@/hooks/usePublishPreferences', () => ({
  usePublishPreferences: () => ({
    isEnabled: (feature: string) => (feature === 'nutzaps' ? mocks.nutzapsEnabled : true),
  }),
}));

vi.mock('@/lib/fetchFreshEvent', () => ({
  fetchFreshEvent: async () => mocks.freshEvent,
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({
    mutateAsync: vi.fn(async (event: { kind: number; tags: string[][]; prev?: NostrEvent | null }) => {
      mocks.published.push(event);
      return { id: 'signed-id', ...event };
    }),
  }),
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query: mocks.nostrQuery } }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useNutzapReceiver', () => {
  const seedPhrase = generateMnemonic(wordlist);
  const mints = [
    { name: 'Mint A', url: 'https://mint-a.example.com' },
    { name: 'Mint B', url: 'https://mint-b.example.com' },
  ];
  const relays = ['wss://relay.example.com'];

  beforeEach(() => {
    mocks.currentUser = {
      pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
    };
    mocks.nutzapsEnabled = true;
    mocks.published = [];
    mocks.freshEvent = null;
    mocks.nostrQuery.mockReset();
  });

  it('publishes a kind:10019 ad when enabled', async () => {
    renderHook(() => useNutzapReceiver(seedPhrase, mints, relays), { wrapper });

    await waitFor(() => expect(mocks.published.length).toBe(1));
    const event = mocks.published[0]!;
    expect(event.kind).toBe(10019);
    expect(event.tags).toContainEqual(['alt', 'Nutzap receiver preferences']);
    expect(event.tags).toContainEqual(['relay', 'wss://relay.example.com']);
    expect(event.tags).toContainEqual(['mint', 'https://mint-a.example.com', 'sat']);
    expect(event.tags).toContainEqual(['mint', 'https://mint-b.example.com', 'sat']);

    const pubkeyTag = event.tags.find((t) => t[0] === 'pubkey');
    expect(pubkeyTag).toBeTruthy();
    const expectedPubkey = deriveNutzapKey(seedPhrase).pubkey;
    expect(pubkeyTag?.[1]).toBe(expectedPubkey);
  });

  it('does not publish when disabled and no previous ad exists', async () => {
    mocks.nutzapsEnabled = false;
    renderHook(() => useNutzapReceiver(seedPhrase, mints, relays), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.published.length).toBe(0);
  });

  it('overwrites the previous ad with an empty event when disabled', async () => {
    mocks.nutzapsEnabled = false;
    mocks.freshEvent = {
      id: 'prev-id',
      kind: 10019,
      pubkey: mocks.currentUser!.pubkey,
      content: '',
      tags: [['pubkey', deriveNutzapKey(seedPhrase).pubkey]],
      created_at: 1000,
      sig: 'sig',
    };

    renderHook(() => useNutzapReceiver(seedPhrase, mints, relays), { wrapper });

    await waitFor(() => expect(mocks.published.length).toBe(1));
    const event = mocks.published[0]!;
    expect(event.kind).toBe(10019);
    expect(event.tags).toContainEqual(['alt', 'Nutzap receiver preferences']);
    expect(event.tags.some((t) => t[0] === 'pubkey')).toBe(false);
    expect(event.tags.some((t) => t[0] === 'mint')).toBe(false);
    expect(event.prev).toBe(mocks.freshEvent);
  });
});
