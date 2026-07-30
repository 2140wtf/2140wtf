import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { usePetssCollection } from './usePetssCollection';

const PUBKEY = 'a'.repeat(64);

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  groupEvent: vi.fn(),
  group: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({
    nostr: {
      query: mocks.query,
      group: mocks.group,
    },
  }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY } }),
}));

vi.mock('@/hooks/usePublishPreferences', () => ({
  usePublishPreferences: () => ({ isEnabled: mocks.isEnabled }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: {
      relayMetadata: { relays: [], updatedAt: 0 },
      useAppRelays: true,
      useUserRelays: false,
    },
  }),
}));

function petsEvent(id: string, d: string, createdAt = 1000): NostrEvent {
  return {
    id,
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: 31124,
    tags: [
      ['d', d],
      ['b', 'pets:ecosystem:v1'],
      ['name', 'Test Pet'],
      ['stage', 'baby'],
      ['state', 'active'],
      ['last_interaction', String(createdAt)],
    ],
    content: '',
    sig: 'fakesig',
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('usePetssCollection repatriation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.group.mockReturnValue({ event: mocks.groupEvent });
    mocks.groupEvent.mockResolvedValue(undefined);
    mocks.isEnabled.mockReturnValue(true);
  });

  it('re-broadcasts fetched pet events to the effective relay set, once per event id', async () => {
    mocks.query.mockResolvedValue([
      petsEvent('repat-id-1', '2140pets-aaaaaaaaaaaa-1111111111'),
      petsEvent('repat-id-2', '2140pets-aaaaaaaaaaaa-2222222222'),
    ]);

    const { rerender } = renderHook(() => usePetssCollection(), { wrapper });

    await waitFor(() => expect(mocks.groupEvent).toHaveBeenCalledTimes(2));

    // Both events went to the effective relay group (not the bare pool).
    expect(mocks.group).toHaveBeenCalled();
    const relayUrls = mocks.group.mock.calls[0][0] as string[];
    expect(relayUrls.length).toBeGreaterThan(0);
    const sentIds = mocks.groupEvent.mock.calls.map(([ev]) => (ev as NostrEvent).id);
    expect(sentIds.sort()).toEqual(['repat-id-1', 'repat-id-2']);

    // A rerender with the same data must not re-broadcast (once per session).
    rerender();
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.groupEvent).toHaveBeenCalledTimes(2);
  });

  it('does not re-broadcast when pets publishing is disabled in preferences', async () => {
    mocks.isEnabled.mockReturnValue(false);
    mocks.query.mockResolvedValue([
      petsEvent('repat-id-3', '2140pets-aaaaaaaaaaaa-3333333333'),
    ]);

    renderHook(() => usePetssCollection(), { wrapper });

    await waitFor(() => expect(mocks.query).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.groupEvent).not.toHaveBeenCalled();
  });

  it('retries the re-broadcast after a failed publish', async () => {
    mocks.groupEvent.mockRejectedValueOnce(new Error('relay down'));
    mocks.query.mockResolvedValue([
      petsEvent('repat-id-4', '2140pets-aaaaaaaaaaaa-4444444444'),
    ]);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const retryWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    renderHook(() => usePetssCollection(), { wrapper: retryWrapper });

    // First attempt fails — the id is released for retry.
    await waitFor(() => expect(mocks.groupEvent).toHaveBeenCalledTimes(1));

    // A refetch (same event data) triggers the retry, which now succeeds.
    await client.invalidateQueries({ queryKey: ['pets-collection', PUBKEY] });
    await waitFor(() => expect(mocks.groupEvent).toHaveBeenCalledTimes(2));
  });
});
