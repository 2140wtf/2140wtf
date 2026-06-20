import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { usePetsPurchaseItem } from './usePetsPurchaseItem';
import { parseBlobbonautEvent, KIND_BLOBBONAUT_PROFILE } from '@/pets/core/lib/pets';
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

function createProfileEvent(walletMode: 'demo' | 'real' | 'bao', coins = 200): NostrEvent {
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
      ['coins', coins.toString()],
    ],
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('usePetsPurchaseItem BAO mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishEvent.mockResolvedValue(createProfileEvent('bao', 200));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('bao', 200));
  });

  it('pays with BAO sats and does not deduct coins', async () => {
    const sendToken = vi.fn().mockResolvedValue('token123');
    const baoWallet = {
      totalBalance: 500,
      loading: false,
      sendToken,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseBlobbonautEvent(createProfileEvent('bao', 200))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, baoWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 10, quantity: 2 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(sendToken).toHaveBeenCalledWith(20, 'Pets shop: Apple');

    const published = mocks.publishEvent.mock.calls[0]?.[0] as NostrEvent | undefined;
    expect(published).toBeDefined();
    expect(published?.tags.some((t) => t[0] === 'storage' && t[1] === 'food_apple:2')).toBe(true);
    expect(published?.tags.find((t) => t[0] === 'coins')?.[1]).toBe('200');
  });

  it('throws when BAO balance is insufficient', async () => {
    const baoWallet = {
      totalBalance: 5,
      loading: false,
      sendToken: vi.fn(),
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseBlobbonautEvent(createProfileEvent('bao', 200))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, baoWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 10, quantity: 1 });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Insufficient BAO balance');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});

describe('usePetsPurchaseItem demo mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishEvent.mockResolvedValue(createProfileEvent('demo', 190));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('demo', 200));
  });

  it('deducts coins and does not call the BAO wallet', async () => {
    const sendToken = vi.fn();
    const baoWallet = {
      totalBalance: 500,
      loading: false,
      sendToken,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseBlobbonautEvent(createProfileEvent('demo', 200))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, baoWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 10, quantity: 1 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(sendToken).not.toHaveBeenCalled();
    const published = mocks.publishEvent.mock.calls[0]?.[0] as NostrEvent | undefined;
    expect(published?.tags.find((t) => t[0] === 'coins')?.[1]).toBe('190');
  });
});
