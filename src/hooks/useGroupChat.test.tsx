import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';

import { useGroupChat } from '@/hooks/useGroupChat';

const mocks = vi.hoisted(() => ({
  currentUser: undefined as { pubkey: string; signer: unknown } | undefined,
  // Must be referentially stable across renders — useGroupChat memoizes on
  // config fields and rebuilds the service when their identity changes.
  config: {
    relayMetadata: { relays: [{ url: 'wss://relay.test', read: true, write: true }], updatedAt: 0 },
    useAppRelays: false,
    useUserRelays: false,
    groupChatRelays: [] as string[],
  },
  nostr: {
    event: vi.fn(),
    group: () => ({
      query: async () => [],
      req: async function* () {},
      event: vi.fn(),
    }),
  },
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.currentUser }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: mocks.config }),
}));

vi.mock('@/hooks/usePublishPreferences', () => ({
  usePublishPreferences: () => ({ isEnabled: () => true }),
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: mocks.nostr }),
}));

function createNip44User() {
  const privkey = generateSecretKey();
  const pubkey = getPublicKey(privkey).toLowerCase();
  return { pubkey, signer: new NSecSigner(privkey) };
}

describe('useGroupChat signer support', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.currentUser = undefined;
  });

  it('does not require nsec when logged out', () => {
    const { result } = renderHook(() => useGroupChat());
    expect(result.current.requiresNsec).toBe(false);
    expect(result.current.canUseGroupChat).toBe(false);
  });

  it('works with any signer that supports NIP-44', async () => {
    mocks.currentUser = createNip44User();
    const { result } = renderHook(() => useGroupChat());

    expect(result.current.requiresNsec).toBe(false);
    await waitFor(() => expect(result.current.canUseGroupChat).toBe(true));
  });

  it('requires nsec only when the signer lacks NIP-44', () => {
    const privkey = generateSecretKey();
    const pubkey = getPublicKey(privkey).toLowerCase();
    mocks.currentUser = { pubkey, signer: { signEvent: vi.fn() } };

    const { result } = renderHook(() => useGroupChat());
    expect(result.current.requiresNsec).toBe(true);
    expect(result.current.canUseGroupChat).toBe(false);
  });
});
