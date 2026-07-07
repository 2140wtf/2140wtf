import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { usePetsPurchaseItem } from './usePetsPurchaseItem';
import { parseBlobbonautEvent, KIND_BLOBBONAUT_PROFILE, setPetsRealSatsEnabled } from '@/pets/core/lib/pets';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';

const PUBKEY = '0000000000000000000000000000000000000000000000000000000000000001';

const mocks = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  fetchFreshPetsEvent: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY } }),
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: {} }),
}));

vi.mock('@/pets/core/hooks/usePetsNostrPublish', () => ({
  usePetsNostrPublish: () => ({ mutateAsync: mocks.publishEvent }),
}));

vi.mock('@/pets/core/lib/fetchFreshPetsEvent', () => ({
  fetchFreshPetsEvent: mocks.fetchFreshPetsEvent,
}));

vi.mock('@/hooks/useToast', () => ({
  toast: mocks.toast,
}));

function createProfileEvent(walletMode: 'demo-sats' | 'btc-sats', sats = 20_000): NostrEvent {
  return {
    kind: KIND_BLOBBONAUT_PROFILE,
    pubkey: PUBKEY,
    created_at: 1000,
    id: 'profile-id',
    sig: 'sig',
    content: '',
    tags: [
      ['d', 'profile-d'],
      ['b', 'pets:ecosystem:v1'],
      ['wallet_mode', walletMode],
      ['sats', sats.toString()],
    ],
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('usePetsPurchaseItem btc-sats mode', () => {
  beforeEach(() => {
    setPetsRealSatsEnabled(true);
    vi.clearAllMocks();
    mocks.publishEvent.mockResolvedValue(createProfileEvent('btc-sats', 20_000));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('btc-sats', 20_000));
  });

  afterEach(() => {
    setPetsRealSatsEnabled(false);
  });

  it('pays with real sats and does not deduct profile sats', async () => {
    const sendToken = vi.fn().mockResolvedValue('token123');
    const externalWallet = {
      totalBalance: 5_000,
      loading: false,
      mintUrl: 'https://mock.mint',
      balances: { 'https://mock.mint': 5_000 },
      sendToken,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseBlobbonautEvent(createProfileEvent('btc-sats', 20_000))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(sendToken).toHaveBeenCalledWith(25, 'Pets shop: Apple');

    const published = mocks.publishEvent.mock.calls[0]?.[0] as NostrEvent | undefined;
    expect(published).toBeDefined();
    expect(published?.tags.some((t) => t[0] === 'storage' && t[1] === 'food_apple:1')).toBe(true);
    expect(published?.tags.find((t) => t[0] === 'sats')?.[1]).toBe('20000');
  });

  it('throws when the selected mint balance is insufficient', async () => {
    const externalWallet = {
      totalBalance: 5_000,
      loading: false,
      mintUrl: 'https://mock.mint',
      balances: { 'https://mock.mint': 0 },
      sendToken: vi.fn(),
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseBlobbonautEvent(createProfileEvent('btc-sats', 20_000))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Insufficient balance on the selected mint');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});

describe('usePetsPurchaseItem demo-sats mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishEvent.mockResolvedValue(createProfileEvent('demo-sats', 19_800));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('demo-sats', 20_000));
  });

  it('deducts demo sats and does not call the external wallet', async () => {
    const sendToken = vi.fn();
    const externalWallet = {
      totalBalance: 500,
      loading: false,
      sendToken,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseBlobbonautEvent(createProfileEvent('demo-sats', 20_000))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(sendToken).not.toHaveBeenCalled();
    const published = mocks.publishEvent.mock.calls[0]?.[0] as NostrEvent | undefined;
    expect(published?.tags.find((t) => t[0] === 'sats')?.[1]).toBe('19975');
  });

  it('validates that the demo-sats cost is affordable', async () => {
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('demo-sats', 10));
    const profile = parseBlobbonautEvent(createProfileEvent('demo-sats', 10))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Insufficient demo sats');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});
