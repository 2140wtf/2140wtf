import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import type { NostrEvent } from '@nostrify/nostrify';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';

const sk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
const pubkey = getPublicKey(sk);
const otherSk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');

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
      clientName: 'AppTest',
      appName: '2140.wtf',
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

function createSigner(expectedPubkey: string) {
  return {
    signEvent: async (template: unknown) => {
      const t = template as Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>;
      return finalizeEvent(
        { kind: t.kind, content: t.content, tags: t.tags, created_at: t.created_at },
        expectedPubkey === pubkey ? sk : otherSk,
      );
    },
  };
}

function createPrevEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  return finalizeEvent(
    {
      kind: 30078,
      content: '',
      tags: [
        ['d', '2140/metadata'],
        ['published_at', '900'],
      ],
      created_at: 900,
      ...overrides,
    },
    sk,
  );
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
      pubkey,
      signer: createSigner(pubkey),
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

  it('preserves published_at from a verified prev event of the same kind and author', async () => {
    const prev = createPrevEvent();
    const { result } = renderHook(() => useNostrPublish(), { wrapper });
    result.current.mutate({
      kind: 30078,
      content: 'updated',
      tags: [['d', '2140/metadata']],
      created_at: 1000,
      prev,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const signed = mocks.nostrEvent.mock.calls[0]?.[0] as NostrEvent | undefined;
    expect(signed?.tags.some((t) => t[0] === 'published_at' && t[1] === '900')).toBe(true);
  });

  it('rejects a prev event with an invalid signature', async () => {
    const prev = JSON.parse(JSON.stringify(createPrevEvent())) as NostrEvent;
    prev.sig = prev.sig.slice(0, -1) + (prev.sig.slice(-1) === '0' ? '1' : '0');
    const { result } = renderHook(() => useNostrPublish(), { wrapper });
    result.current.mutate({
      kind: 30078,
      content: 'updated',
      tags: [['d', '2140/metadata']],
      created_at: 1000,
      prev,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/forged or mismatched prev event/i);
  });

  it('rejects a prev event from a different author', async () => {
    const prev = finalizeEvent(
      {
        kind: 30078,
        content: '',
        tags: [['d', '2140/metadata'], ['published_at', '900']],
        created_at: 900,
      },
      otherSk,
    );
    const { result } = renderHook(() => useNostrPublish(), { wrapper });
    result.current.mutate({
      kind: 30078,
      content: 'updated',
      tags: [['d', '2140/metadata']],
      created_at: 1000,
      prev,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/forged or mismatched prev event/i);
  });

  it('rejects a prev event with a mismatched kind', async () => {
    const prev = createPrevEvent({ kind: 30063 });
    const { result } = renderHook(() => useNostrPublish(), { wrapper });
    result.current.mutate({
      kind: 30078,
      content: 'updated',
      tags: [['d', '2140/metadata']],
      created_at: 1000,
      prev,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/forged or mismatched prev event/i);
  });
});
