import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import type { NostrEvent } from '@nostrify/nostrify';

const mocks = vi.hoisted(() => ({
  currentUser: null as { pubkey: string; signer: { signEvent: (t: unknown) => Promise<NostrEvent> } } | null,
  nostrEvent: vi.fn(),
  groupEvent: vi.fn(),
  groupMock: vi.fn(() => ({ event: mocks.groupEvent })),
  sendToInboxRelays: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.currentUser }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: {
      clientName: 'DittoTest',
      appName: 'Ditto',
      client: undefined,
    },
  }),
}));

vi.mock('@/lib/inboxRelays', () => ({
  sendToInboxRelays: mocks.sendToInboxRelays,
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({
    nostr: {
      event: mocks.nostrEvent,
      group: mocks.groupMock,
    },
  }),
}));

function createSigner(pubkey: string) {
  return {
    signEvent: async (template: unknown) => {
      const t = template as Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>;
      return {
        ...t,
        id: 'signed-id',
        pubkey,
        sig: 'sig',
      } as NostrEvent;
    },
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useNostrPublish', () => {
  beforeEach(() => {
    mocks.nostrEvent.mockReset();
    mocks.groupEvent.mockReset();
    mocks.sendToInboxRelays.mockReset();
    mocks.currentUser = {
      pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
      signer: createSigner('0000000000000000000000000000000000000000000000000000000000000001'),
    };
  });

  it('publishes to the global pool by default', async () => {
    const { result } = renderHook(() => useNostrPublish(), { wrapper });
    result.current.mutate({
      kind: 1,
      content: 'hello',
      tags: [],
      created_at: 1000,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.nostrEvent).toHaveBeenCalledTimes(1);
    expect(mocks.groupEvent).not.toHaveBeenCalled();
  });

  it('publishes to a selected relay group when relays are provided', async () => {
    const { result } = renderHook(() => useNostrPublish(), { wrapper });
    result.current.mutate({
      kind: 30402,
      content: 'product',
      tags: [],
      created_at: 1000,
      relays: ['wss://relay.bao.network'],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.nostrEvent).not.toHaveBeenCalled();
    expect(mocks.groupEvent).toHaveBeenCalledTimes(1);
    expect(mocks.groupMock).toHaveBeenCalledWith(['wss://relay.bao.network']);
  });

  it('injects published_at for addressable kinds', async () => {
    const { result } = renderHook(() => useNostrPublish(), { wrapper });
    result.current.mutate({
      kind: 30402,
      content: 'product',
      tags: [],
      created_at: 1000,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const signed = mocks.nostrEvent.mock.calls[0]?.[0] as NostrEvent | undefined;
    expect(signed?.tags.some((t) => t[0] === 'published_at' && t[1] === '1000')).toBe(true);
  });
});
