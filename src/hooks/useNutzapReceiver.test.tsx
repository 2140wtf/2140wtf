import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useNutzapReceiver } from './useNutzapReceiver';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import type { NostrEvent } from '@nostrify/nostrify';

const mocks = vi.hoisted(() => ({
  currentUser: null as { pubkey: string } | null,
  received: [] as NostrEvent[],
  nostrReq: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.currentUser }),
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { req: mocks.nostrReq } }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function* eventGenerator(events: NostrEvent[]) {
  for (const event of events) {
    yield ['EVENT', '', event] as ['EVENT', string, NostrEvent];
  }
}

describe('useNutzapReceiver', () => {
  const seedPhrase = generateMnemonic(wordlist);
  const mints = [
    { name: 'Mint A', url: 'https://mint-a.example.com' },
    { name: 'Mint B', url: 'https://mint-b.example.com' },
  ];
  const userPubkey = '0000000000000000000000000000000000000000000000000000000000000001';

  beforeEach(() => {
    mocks.currentUser = { pubkey: userPubkey };
    mocks.received = [];
    mocks.nostrReq.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('subscribes to kind:9321 events tagged for the user and trusted mints', async () => {
    const incoming: NostrEvent = {
      id: 'nutzap-id',
      kind: 9321,
      pubkey: 'sender-pubkey',
      content: '',
      tags: [
        ['p', userPubkey],
        ['u', 'https://mint-a.example.com'],
        ['unit', 'sat'],
      ],
      created_at: 1000,
      sig: 'sig',
    };
    mocks.nostrReq.mockImplementation(async function* () {
      yield* eventGenerator([incoming]);
    });

    renderHook(
      () => useNutzapReceiver(seedPhrase, mints, (ev) => mocks.received.push(ev)),
      { wrapper },
    );

    await waitFor(() => expect(mocks.received.length).toBe(1));
    expect(mocks.received[0]!.id).toBe('nutzap-id');
    expect(mocks.nostrReq).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          kinds: [9321],
          '#p': [userPubkey],
          '#u': expect.arrayContaining(['https://mint-a.example.com', 'https://mint-b.example.com']),
        }),
      ]),
      expect.anything(),
    );
  });

  it('does not subscribe when no user is logged in', async () => {
    mocks.currentUser = null;
    renderHook(
      () => useNutzapReceiver(seedPhrase, mints, (ev) => mocks.received.push(ev)),
      { wrapper },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.nostrReq).not.toHaveBeenCalled();
  });

  it('does not subscribe when no callback is provided', async () => {
    renderHook(() => useNutzapReceiver(seedPhrase, mints), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.nostrReq).not.toHaveBeenCalled();
  });
});
