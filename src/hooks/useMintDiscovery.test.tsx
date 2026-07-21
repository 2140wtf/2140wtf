import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useMintDiscovery, useMintInfo, useSmartMintSelection } from './useMintDiscovery';
import { CASHU_MINT_ANNOUNCEMENT_KIND, CASHU_MINT_RECOMMENDATION_KIND } from '@/lib/cashu/nip87';
import type { NostrEvent } from '@nostrify/nostrify';

const queryFn = vi.fn();

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query: queryFn } }),
}));

vi.mock('@/hooks/useFollows', () => ({
  useFollows: () => ({ data: ['follow1'], isLoading: false }),
}));

vi.mock('@/lib/cashu/cashuFetch', () => ({
  createMintFetch: vi.fn(() => vi.fn()),
}));

vi.mock('@cashu/cashu-ts', async () => {
  const actual = await vi.importActual<typeof import('@cashu/cashu-ts')>('@cashu/cashu-ts');
  return {
    ...actual,
    CashuMint: vi.fn(function () {
      return {
        getInfo: vi.fn().mockResolvedValue({ name: 'Mock Mint', nuts: { '4': { supported: true } } }),
      };
    }),
  };
});

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: Math.random().toString(36).slice(2),
    pubkey: 'pubkey',
    created_at: 1,
    sig: 'sig',
    ...overrides,
  } as NostrEvent;
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useMintDiscovery', () => {
  beforeEach(() => {
    queryFn.mockReset();
  });

  it('filters by follows when global is false', async () => {
    queryFn.mockResolvedValue([]);
    renderHook(() => useMintDiscovery(), { wrapper });
    await waitFor(() => expect(queryFn).toHaveBeenCalled());
    const filters = queryFn.mock.calls[0][0];
    expect(filters).toHaveLength(2);
    expect(filters[0]).toMatchObject({ kinds: [CASHU_MINT_ANNOUNCEMENT_KIND], authors: ['follow1'] });
    expect(filters[1]).toMatchObject({ kinds: [CASHU_MINT_RECOMMENDATION_KIND], '#k': ['38172'], authors: ['follow1'] });
  });

  it('returns parsed announcements and recommendations', async () => {
    queryFn.mockResolvedValue([
      makeEvent({
        kind: CASHU_MINT_ANNOUNCEMENT_KIND,
        pubkey: 'mintpubkey',
        tags: [
          ['d', 'mintpubkey'],
          ['u', 'https://mint.example.com'],
          ['nuts', '4,5'],
          ['n', 'mainnet'],
        ],
        content: '',
      }),
      makeEvent({
        kind: CASHU_MINT_RECOMMENDATION_KIND,
        pubkey: 'follow1',
        tags: [['k', '38172'], ['d', 'mintpubkey'], ['u', 'https://mint.example.com'], ['rating', '5']],
        content: 'great',
      }),
    ]);

    const { result } = renderHook(() => useMintDiscovery(), { wrapper });
    await waitFor(() => expect(result.current.data?.announcements).toHaveLength(1));
    expect(result.current.data?.recommendations).toHaveLength(1);
    expect(result.current.data?.announcements[0].mintUrl).toBe('https://mint.example.com');
  });

  it('ignores invalid events', async () => {
    queryFn.mockResolvedValue([
      makeEvent({ kind: CASHU_MINT_ANNOUNCEMENT_KIND, tags: [], content: '' }),
      makeEvent({ kind: CASHU_MINT_RECOMMENDATION_KIND, tags: [['k', '38173'], ['d', 'x'], ['u', 'https://mint.example.com']], content: '' }),
    ]);

    const { result } = renderHook(() => useMintDiscovery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.announcements).toHaveLength(0);
    expect(result.current.data?.recommendations).toHaveLength(0);
  });
});

describe('useMintInfo', () => {
  it('fetches mint info', async () => {
    const { result } = renderHook(() => useMintInfo('https://mint.example.com'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ name: 'Mock Mint', nuts: { '4': { supported: true } } });
  });

  it('stays disabled without URL', async () => {
    const { result } = renderHook(() => useMintInfo(undefined), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useSmartMintSelection', () => {
  it('ranks mints with balance and recommendations highest', () => {
    const discovery = {
      announcements: [
        {
          event: makeEvent({ kind: CASHU_MINT_ANNOUNCEMENT_KIND, created_at: 1 }),
          mintId: 'm1',
          mintUrl: 'https://recommended.example.com',
          network: 'mainnet' as const,
          nuts: [4, 5, 7],
          metadata: {},
        },
        {
          event: makeEvent({ kind: CASHU_MINT_ANNOUNCEMENT_KIND, created_at: 1 }),
          mintId: 'm2',
          mintUrl: 'https://mine.example.com',
          network: 'mainnet' as const,
          nuts: [4],
          metadata: {},
        },
      ],
      recommendations: [
        {
          event: makeEvent({ kind: CASHU_MINT_RECOMMENDATION_KIND, pubkey: 'follow1' }),
          author: 'follow1',
          mintId: 'm1',
          mintUrls: ['https://recommended.example.com'],
          addressPointers: [],
          rating: 5,
          content: '',
        },
      ],
    };

    const { result } = renderHook(() => useSmartMintSelection(discovery, ['https://mine.example.com']), { wrapper });
    expect(result.current[0].url).toBe('https://mine.example.com');
    expect(result.current[0].hasBalance).toBe(true);
    expect(result.current[1].url).toBe('https://recommended.example.com');
    expect(result.current[1].recommendations).toHaveLength(1);
  });
});
