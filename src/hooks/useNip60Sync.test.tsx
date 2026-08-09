import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { useNip60Sync } from './useNip60Sync';

const mocks = vi.hoisted(() => ({
  group: vi.fn(),
  groupQuery: vi.fn(),
  groupEvent: vi.fn(),
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { group: mocks.group } }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: {
      pubkey: '1'.repeat(64),
      signer: {
        nip44: {
          encrypt: vi.fn().mockResolvedValue('encrypted'),
          decrypt: vi.fn().mockResolvedValue('decrypted'),
        },
        signEvent: vi.fn(),
      },
    },
  }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: {
      relayMetadata: {
        relays: [
          { url: 'wss://relay.bao.network', read: true, write: true },
          { url: 'wss://relay.ditto.pub', read: true, write: true },
        ],
      },
    },
  }),
}));

const event: NostrEvent = {
  id: '2'.repeat(64),
  pubkey: '1'.repeat(64),
  kind: 7375,
  content: '',
  tags: [],
  created_at: 1,
  sig: '3'.repeat(128),
};

describe('useNip60Sync relay isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.groupQuery.mockResolvedValue([]);
    mocks.groupEvent.mockResolvedValue(undefined);
    mocks.group.mockReturnValue({ query: mocks.groupQuery, event: mocks.groupEvent });
  });

  it('keeps the main NIP-60 wallet off the BAO demo relay', async () => {
    const { result } = renderHook(() => useNip60Sync());
    expect(result.current?.relays).toEqual(['wss://relay.ditto.pub']);

    await act(async () => {
      await result.current?.query({ kinds: [7375] });
      await result.current?.publish(event);
    });

    expect(mocks.group).toHaveBeenCalledWith(['wss://relay.ditto.pub']);
    expect(mocks.group).not.toHaveBeenCalledWith(['wss://relay.bao.network']);
  });

  it('still permits an explicitly targeted BAO wallet operation', async () => {
    const { result } = renderHook(() => useNip60Sync());
    await act(async () => {
      await result.current?.queryRelays?.(['wss://relay.bao.network'], { kinds: [17375] });
      await result.current?.publishToRelays?.(['wss://relay.bao.network'], event);
    });

    expect(mocks.group).toHaveBeenCalledWith(['wss://relay.bao.network']);
  });
});
