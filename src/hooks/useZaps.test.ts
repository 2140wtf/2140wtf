import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Event } from 'nostr-tools';

import { useZaps } from './useZaps';

const mocks = vi.hoisted(() => ({
  toastMock: vi.fn(),
  makeZapRequestMock: vi.fn(),
  getZapEndpointMock: vi.fn(),
  signEventMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  sendPaymentMock: vi.fn(),
  getActiveConnectionMock: vi.fn(() => null),
  fetchMock: vi.fn(),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toastMock }),
}));

vi.mock('@/hooks/usePublishPreferences', () => ({
  usePublishPreferences: () => ({
    isEnabled: () => true,
    prefs: {},
    setEnabled: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: {
      pubkey: 'sender-pubkey',
      signer: { signEvent: mocks.signEventMock },
    },
  }),
}));

vi.mock('@/hooks/useAuthor', () => ({
  useAuthor: () => ({
    data: {
      metadata: { lud16: 'author@example.com' },
      event: {
        kind: 0,
        pubkey: 'author-pubkey',
        content: JSON.stringify({ lud16: 'author@example.com' }),
        tags: [],
        created_at: 0,
        id: 'author-metadata-id',
        sig: 'sig',
      },
    },
  }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: {
      relayMetadata: {
        relays: [{ url: 'wss://relay.example.com' }],
      },
    },
  }),
}));

vi.mock('@/hooks/useNWCContext', () => ({
  useNWC: () => ({
    sendPayment: mocks.sendPaymentMock,
    getActiveConnection: mocks.getActiveConnectionMock,
  }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueriesMock }),
  };
});

vi.mock('@/lib/haptics', () => ({
  notificationSuccess: vi.fn(),
}));

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>();
  return {
    ...actual,
    nip57: {
      getZapEndpoint: mocks.getZapEndpointMock,
      makeZapRequest: mocks.makeZapRequestMock,
    },
  };
});

function makeTarget(kind = 1): Event {
  return {
    kind,
    pubkey: 'target-pubkey',
    content: 'hello',
    tags: [],
    created_at: 0,
    id: 'target-id',
    sig: 'sig',
  };
}

describe('useZaps guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signEventMock.mockImplementation(async (event: Event) => ({ ...event, sig: 'sig' }));
    globalThis.fetch = mocks.fetchMock;
  });

  it('does not call makeZapRequest for non-positive amounts', async () => {
    const { result } = renderHook(() => useZaps(makeTarget(), null, null));
    await act(async () => { await result.current.zap(-1, 'comment'); });
    await act(async () => { await result.current.zap(0, 'comment'); });
    expect(mocks.makeZapRequestMock).not.toHaveBeenCalled();
  });

  it('rejects amounts above the safety cap', async () => {
    const { result } = renderHook(() => useZaps(makeTarget(), null, null));
    await act(async () => { await result.current.zap(Math.floor(Number.MAX_SAFE_INTEGER / 1000) + 1, 'comment'); });
    expect(mocks.toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Amount too large' }));
    expect(mocks.makeZapRequestMock).not.toHaveBeenCalled();
  });

  it('rejects comments exceeding the max length', async () => {
    const { result } = renderHook(() => useZaps(makeTarget(), null, null));
    await act(async () => { await result.current.zap(100, 'x'.repeat(1001)); });
    expect(mocks.toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Comment too long' }));
    expect(mocks.makeZapRequestMock).not.toHaveBeenCalled();
  });

  it('blocks concurrent zap attempts with the in-flight guard', async () => {
    mocks.getZapEndpointMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useZaps(makeTarget(), null, null));

    const first = result.current.zap(100, '');
    const second = result.current.zap(100, '');

    await act(async () => {
      await Promise.race([first, second, new Promise((resolve) => setTimeout(resolve, 50))]);
    });

    expect(mocks.getZapEndpointMock).toHaveBeenCalledTimes(1);
    expect(mocks.makeZapRequestMock).not.toHaveBeenCalled();
  });
});

describe('useZaps zap request construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signEventMock.mockImplementation(async (event: Event) => ({ ...event, sig: 'sig' }));
    globalThis.fetch = mocks.fetchMock;
    mocks.getZapEndpointMock.mockResolvedValue('https://zap.example.com/callback');
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ pr: 'lnbc1invoice' }),
    });
  });

  it('calls makeZapRequest with the target pubkey and no event for regular events', async () => {
    const target = makeTarget(1);
    const { result } = renderHook(() => useZaps(target, null, null));
    await act(async () => { await result.current.zap(21, 'great post'); });

    await waitFor(() => expect(mocks.makeZapRequestMock).toHaveBeenCalled());

    const args = mocks.makeZapRequestMock.mock.calls[0][0];
    expect(args.pubkey).toBe(target.pubkey);
    expect(args.amount).toBe(21_000);
    expect(args.comment).toBe('great post');
    expect(args.event).toBeUndefined();
  });

  it('calls makeZapRequest with event for addressable targets (30000-39999)', async () => {
    const target = makeTarget(30001);
    const { result } = renderHook(() => useZaps(target, null, null));
    await act(async () => { await result.current.zap(21, 'great list'); });

    await waitFor(() => expect(mocks.makeZapRequestMock).toHaveBeenCalled());

    const args = mocks.makeZapRequestMock.mock.calls[0][0];
    expect(args.pubkey).toBe(target.pubkey);
    expect(args.event).toBe(target);
  });
});
