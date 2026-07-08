import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useGroupChatReadCursors } from './useGroupChatReadCursors';
import { makeNip44 } from '@/test/helpers';

const viewerPubkey = 'v'.repeat(64);

const nip44 = makeNip44();

const group = {
  nostrGroupId: 'g1',
  name: 'Test Group',
  adminPubkeys: [viewerPubkey],
  members: [viewerPubkey],
  relays: [],
  epoch: 0,
  createdAt: 0,
  lastActivity: 100,
};

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: viewerPubkey, signer: { nip44 } } }),
}));

describe('useGroupChatReadCursors', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('starts with empty cursors', () => {
    const { result } = renderHook(() => useGroupChatReadCursors());
    expect(result.current.getCursor(group.nostrGroupId)).toBe(0);
  });

  it('sets a cursor for a group', () => {
    const { result } = renderHook(() => useGroupChatReadCursors());

    act(() => {
      result.current.setCursor(group.nostrGroupId, 123);
    });

    expect(result.current.getCursor(group.nostrGroupId)).toBe(123);
  });

  it('marks a group read at the newest message timestamp', () => {
    const { result } = renderHook(() => useGroupChatReadCursors());

    act(() => {
      result.current.markGroupRead(group, [
        { id: 'm1', nostrGroupId: 'g1', senderPubkey: 'o'.repeat(64), content: 'hi', timestamp: 150, isOwn: false, epoch: 0 },
        { id: 'm2', nostrGroupId: 'g1', senderPubkey: 'o'.repeat(64), content: 'bye', timestamp: 200, isOwn: false, epoch: 0 },
      ]);
    });

    expect(result.current.getCursor(group.nostrGroupId)).toBe(200);
  });

  it('marks all groups read', () => {
    const { result } = renderHook(() => useGroupChatReadCursors());

    act(() => {
      result.current.markAllGroupsRead(
        [
          { ...group, nostrGroupId: 'a', lastActivity: 0 },
          { ...group, nostrGroupId: 'b', lastActivity: 0 },
        ],
        (groupId) => groupId === 'a'
          ? [{ id: 'm1', nostrGroupId: 'a', senderPubkey: 'o'.repeat(64), content: 'hi', timestamp: 10, isOwn: false, epoch: 0 }]
          : [],
      );
    });

    expect(result.current.getCursor('a')).toBe(10);
    expect(result.current.getCursor('b')).toBe(0);
  });

  it('persists cursors to localStorage', async () => {
    const { result } = renderHook(() => useGroupChatReadCursors());

    act(() => {
      result.current.setCursor(group.nostrGroupId, 42);
    });

    await waitFor(() => {
      expect(localStorage.getItem(`app:group-read-cursors:${viewerPubkey}`)).toContain('42');
    });
  });
});
