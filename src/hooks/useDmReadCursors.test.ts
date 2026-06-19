import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDmReadCursors } from './useDmReadCursors';

const viewerPubkey = 'v'.repeat(64);
const otherPubkey = 'o'.repeat(64);

const conversation = {
  id: 'nip17:aaa',
  participants: [otherPubkey],
  messages: [],
  lastMessageAt: 100,
};

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: viewerPubkey } }),
}));

describe('useDmReadCursors', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty cursors', () => {
    const { result } = renderHook(() => useDmReadCursors());
    expect(result.current.getCursor(conversation.id)).toBe(0);
  });

  it('sets a cursor for a conversation', () => {
    const { result } = renderHook(() => useDmReadCursors());

    act(() => {
      result.current.setCursor(conversation.id, 123);
    });

    expect(result.current.getCursor(conversation.id)).toBe(123);
  });

  it('marks a conversation read at its last message time', () => {
    const { result } = renderHook(() => useDmReadCursors());

    act(() => {
      result.current.markConversationRead({ ...conversation, lastMessageAt: 200 });
    });

    expect(result.current.getCursor(conversation.id)).toBe(200);
  });

  it('marks all conversations read', () => {
    const { result } = renderHook(() => useDmReadCursors());

    act(() => {
      result.current.markAllConversationsRead([
        { ...conversation, id: 'a', lastMessageAt: 10 },
        { ...conversation, id: 'b', lastMessageAt: 20 },
      ]);
    });

    expect(result.current.getCursor('a')).toBe(10);
    expect(result.current.getCursor('b')).toBe(20);
  });

  it('persists cursors to localStorage', () => {
    const { result } = renderHook(() => useDmReadCursors());

    act(() => {
      result.current.setCursor(conversation.id, 42);
    });

    expect(localStorage.getItem(`ditto:dm-read-cursors:${viewerPubkey}`)).toContain('42');
  });
});
