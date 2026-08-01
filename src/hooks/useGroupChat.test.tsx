import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';
import type { NostrEvent } from '@nostrify/nostrify';

import { useGroupChat } from '@/hooks/useGroupChat';

const mocks = vi.hoisted(() => {
  // Stable spy shared by every nostr.group(...) pool so tests can assert on
  // what was actually published.
  const groupEvent = vi.fn();
  return {
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
        event: groupEvent,
      }),
      groupEvent,
    },
  };
});

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

describe('useGroupChat rotation publishing', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.currentUser = undefined;
    mocks.nostr.groupEvent.mockClear();
  });

  it('promoteAdmin publishes the rotation Welcome events', async () => {
    const admin = createNip44User();
    const member = createNip44User();
    mocks.currentUser = admin;

    const { result } = renderHook(() => useGroupChat());
    await waitFor(() => expect(result.current.canUseGroupChat).toBe(true));

    let groupId = '';
    await act(async () => {
      const created = await result.current.createGroup('Promotions', undefined, ['wss://relay.test']);
      expect(created.success).toBe(true);
      groupId = created.data!.nostrGroupId;
    });
    act(() => result.current.selectGroup(groupId));

    await act(async () => {
      const added = await result.current.addMember(member.pubkey);
      expect(added.success).toBe(true);
    });
    mocks.nostr.groupEvent.mockClear();

    await act(async () => {
      const promoted = await result.current.promoteAdmin(member.pubkey);
      expect(promoted.success).toBe(true);
      expect(promoted.events!.length).toBeGreaterThan(0);
    });

    // The rotation Welcomes reached the relay pool — otherwise other members
    // never learn of the new epoch and the group forks permanently.
    const published = mocks.nostr.groupEvent.mock.calls.map(([event]) => event as NostrEvent);
    expect(
      published.some(
        (event) =>
          event.kind === 1059 &&
          event.tags.some(([name, value]) => name === 'p' && value === member.pubkey),
      ),
    ).toBe(true);
  });
});
