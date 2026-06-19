import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useHasUnreadMessages } from './useHasUnreadMessages';

const viewerPubkey = 'v'.repeat(64);
const otherPubkey = 'o'.repeat(64);

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: viewerPubkey } }),
}));

vi.mock('@/hooks/useNip17Inbox', () => ({
  useNip17Inbox: vi.fn(),
}));

import { useNip17Inbox } from './useNip17Inbox';

describe('useHasUnreadMessages', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useNip17Inbox).mockReturnValue({ conversations: [], isLoading: false });
  });

  it('returns no unread when there are no conversations', () => {
    const { result } = renderHook(() => useHasUnreadMessages());
    expect(result.current.hasUnread).toBe(false);
    expect(result.current.unreadCount).toBe(0);
  });

  it('ignores messages sent by the viewer', () => {
    vi.mocked(useNip17Inbox).mockReturnValue({
      conversations: [{
        id: 'c1',
        participants: [otherPubkey],
        messages: [{ id: 'm1', wrapId: 'w1', sender: viewerPubkey, recipients: [otherPubkey], content: 'hi', createdAt: 100 }],
        lastMessageAt: 100,
      }],
      isLoading: false,
    });

    const { result } = renderHook(() => useHasUnreadMessages());
    expect(result.current.hasUnread).toBe(false);
    expect(result.current.unreadCount).toBe(0);
  });

  it('counts messages newer than the stored cursor as unread', () => {
    localStorage.setItem(
      `ditto:dm-read-cursors:${viewerPubkey}`,
      JSON.stringify({ c1: 50 }),
    );

    vi.mocked(useNip17Inbox).mockReturnValue({
      conversations: [{
        id: 'c1',
        participants: [otherPubkey],
        messages: [
          { id: 'm1', wrapId: 'w1', sender: otherPubkey, recipients: [viewerPubkey], content: 'old', createdAt: 40 },
          { id: 'm2', wrapId: 'w2', sender: otherPubkey, recipients: [viewerPubkey], content: 'new', createdAt: 60 },
        ],
        lastMessageAt: 60,
      }],
      isLoading: false,
    });

    const { result } = renderHook(() => useHasUnreadMessages());
    expect(result.current.hasUnread).toBe(true);
    expect(result.current.unreadCount).toBe(1);
  });

  it('returns no unread when all messages are older than the cursor', () => {
    localStorage.setItem(
      `ditto:dm-read-cursors:${viewerPubkey}`,
      JSON.stringify({ c1: 100 }),
    );

    vi.mocked(useNip17Inbox).mockReturnValue({
      conversations: [{
        id: 'c1',
        participants: [otherPubkey],
        messages: [{ id: 'm1', wrapId: 'w1', sender: otherPubkey, recipients: [viewerPubkey], content: 'hi', createdAt: 80 }],
        lastMessageAt: 80,
      }],
      isLoading: false,
    });

    const { result } = renderHook(() => useHasUnreadMessages());
    expect(result.current.hasUnread).toBe(false);
    expect(result.current.unreadCount).toBe(0);
  });
});
