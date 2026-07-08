import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useHasUnreadMessages } from './useHasUnreadMessages';
import { makeNip44 } from '@/test/helpers';

const viewerPubkey = 'v'.repeat(64);
const otherPubkey = 'o'.repeat(64);

const nip44 = makeNip44();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: viewerPubkey, signer: { nip44 } } }),
}));

vi.mock('@/hooks/useDmInbox', () => ({
  useDmInbox: vi.fn(),
}));

import { useDmInbox } from './useDmInbox';

describe('useHasUnreadMessages', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useDmInbox).mockReturnValue({ conversations: [], isLoading: false, addMessage: vi.fn() });
  });

  it('returns no unread when there are no conversations', () => {
    const { result } = renderHook(() => useHasUnreadMessages());
    expect(result.current.hasUnread).toBe(false);
    expect(result.current.unreadCount).toBe(0);
  });

  it('ignores messages sent by the viewer', () => {
    vi.mocked(useDmInbox).mockReturnValue({
      conversations: [{
        id: 'c1',
        participants: [otherPubkey],
        messages: [{ id: 'm1', wrapId: 'w1', sender: viewerPubkey, recipients: [otherPubkey], content: 'hi', createdAt: 100 }],
        lastMessageAt: 100,
      }],
      isLoading: false,
      addMessage: vi.fn(),
    });

    const { result } = renderHook(() => useHasUnreadMessages());
    expect(result.current.hasUnread).toBe(false);
    expect(result.current.unreadCount).toBe(0);
  });

  it('counts messages newer than the stored cursor as unread', async () => {
    localStorage.setItem(
      `app:dm-read-cursors:${viewerPubkey}`,
      JSON.stringify({ c1: 50 }),
    );

    vi.mocked(useDmInbox).mockReturnValue({
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
      addMessage: vi.fn(),
    });

    const { result } = renderHook(() => useHasUnreadMessages());
    await waitFor(() => {
      expect(result.current.unreadCount).toBe(1);
    });
    expect(result.current.hasUnread).toBe(true);
  });

  it('returns no unread when all messages are older than the cursor', async () => {
    localStorage.setItem(
      `app:dm-read-cursors:${viewerPubkey}`,
      JSON.stringify({ c1: 100 }),
    );

    vi.mocked(useDmInbox).mockReturnValue({
      conversations: [{
        id: 'c1',
        participants: [otherPubkey],
        messages: [{ id: 'm1', wrapId: 'w1', sender: otherPubkey, recipients: [viewerPubkey], content: 'hi', createdAt: 80 }],
        lastMessageAt: 80,
      }],
      isLoading: false,
      addMessage: vi.fn(),
    });

    const { result } = renderHook(() => useHasUnreadMessages());
    await waitFor(() => {
      expect(result.current.unreadCount).toBe(0);
    });
    expect(result.current.hasUnread).toBe(false);
  });
});
