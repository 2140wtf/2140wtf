import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useGroupChatHasUnread } from './useGroupChatHasUnread';
import { makeNip44 } from '@/test/helpers';

const viewerPubkey = 'v'.repeat(64);
const otherPubkey = 'o'.repeat(64);

const nip44 = makeNip44();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: viewerPubkey, signer: { nip44 } } }),
}));

vi.mock('@/hooks/useGroupChatContext', () => ({
  useGroupChatContext: vi.fn(),
}));

import { useGroupChatContext } from './useGroupChatContext';

describe('useGroupChatHasUnread', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useGroupChatContext).mockReturnValue({
      groups: [],
      selectedGroup: null,
      messages: [],
      members: [],
      isLoading: false,
      isSending: false,
      error: null,
      canUseGroupChat: false,
      requiresNsec: false,
      selectGroup: vi.fn(),
      createGroup: vi.fn(),
      sendMessage: vi.fn(),
      addMember: vi.fn(),
      removeMember: vi.fn(),
      banMember: vi.fn(),
      promoteAdmin: vi.fn(),
      updateGroupMetadata: vi.fn(),
      leaveGroup: vi.fn(),
      joinFromWelcome: vi.fn(),
      getMessagesForGroup: vi.fn((groupId: string) =>
        [].filter((m: never) => (m as unknown as { nostrGroupId: string }).nostrGroupId === groupId)
      ),
      isAdmin: false,
    });
  });

  it('returns no unread when there are no groups', () => {
    const { result } = renderHook(() => useGroupChatHasUnread());
    expect(result.current.hasUnread).toBe(false);
    expect(result.current.unreadCount).toBe(0);
  });

  it('ignores messages sent by the viewer', () => {
    vi.mocked(useGroupChatContext).mockReturnValue({
      groups: [{
        nostrGroupId: 'g1',
        name: 'G1',
        adminPubkeys: [viewerPubkey],
        members: [viewerPubkey],
        relays: [],
        epoch: 0,
        createdAt: 0,
        lastActivity: 100,
      }],
      selectedGroup: null,
      messages: [{
        id: 'm1', nostrGroupId: 'g1', senderPubkey: viewerPubkey, content: 'hi', timestamp: 100, isOwn: true, epoch: 0,
      }],
      members: [],
      isLoading: false,
      isSending: false,
      error: null,
      canUseGroupChat: true,
      requiresNsec: false,
      selectGroup: vi.fn(),
      createGroup: vi.fn(),
      sendMessage: vi.fn(),
      addMember: vi.fn(),
      removeMember: vi.fn(),
      banMember: vi.fn(),
      promoteAdmin: vi.fn(),
      updateGroupMetadata: vi.fn(),
      leaveGroup: vi.fn(),
      joinFromWelcome: vi.fn(),
      getMessagesForGroup: vi.fn((groupId: string) =>
        [{
          id: 'm1', nostrGroupId: 'g1', senderPubkey: viewerPubkey, content: 'hi', timestamp: 100, isOwn: true, epoch: 0,
        }].filter((m) => m.nostrGroupId === groupId)
      ),
      isAdmin: false,
    });

    const { result } = renderHook(() => useGroupChatHasUnread());
    expect(result.current.hasUnread).toBe(false);
    expect(result.current.unreadCount).toBe(0);
  });

  it('counts messages newer than the stored cursor as unread', async () => {
    localStorage.setItem(
      `app:group-read-cursors:${viewerPubkey}`,
      JSON.stringify({ g1: 50 }),
    );

    vi.mocked(useGroupChatContext).mockReturnValue({
      groups: [{
        nostrGroupId: 'g1',
        name: 'G1',
        adminPubkeys: [viewerPubkey],
        members: [viewerPubkey, otherPubkey],
        relays: [],
        epoch: 0,
        createdAt: 0,
        lastActivity: 100,
      }],
      selectedGroup: null,
      messages: [
        { id: 'm1', nostrGroupId: 'g1', senderPubkey: otherPubkey, content: 'old', timestamp: 40, isOwn: false, epoch: 0 },
        { id: 'm2', nostrGroupId: 'g1', senderPubkey: otherPubkey, content: 'new', timestamp: 60, isOwn: false, epoch: 0 },
      ],
      members: [],
      isLoading: false,
      isSending: false,
      error: null,
      canUseGroupChat: true,
      requiresNsec: false,
      selectGroup: vi.fn(),
      createGroup: vi.fn(),
      sendMessage: vi.fn(),
      addMember: vi.fn(),
      removeMember: vi.fn(),
      banMember: vi.fn(),
      promoteAdmin: vi.fn(),
      updateGroupMetadata: vi.fn(),
      leaveGroup: vi.fn(),
      joinFromWelcome: vi.fn(),
      getMessagesForGroup: vi.fn((groupId: string) =>
        [
          { id: 'm1', nostrGroupId: 'g1', senderPubkey: otherPubkey, content: 'old', timestamp: 40, isOwn: false, epoch: 0 },
          { id: 'm2', nostrGroupId: 'g1', senderPubkey: otherPubkey, content: 'new', timestamp: 60, isOwn: false, epoch: 0 },
        ].filter((m) => m.nostrGroupId === groupId)
      ),
      isAdmin: false,
    });

    const { result } = renderHook(() => useGroupChatHasUnread());
    await waitFor(() => {
      expect(result.current.unreadCount).toBe(1);
    });
    expect(result.current.hasUnread).toBe(true);
  });
});
