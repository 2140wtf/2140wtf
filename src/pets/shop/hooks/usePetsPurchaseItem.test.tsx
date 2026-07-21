import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { usePetsPurchaseItem } from './usePetsPurchaseItem';
import { parseNostrPetProfileEvent, KIND_NOSTR_PET_PROFILE } from '@/pets/core/lib/pets';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';

const PUBKEY = '0000000000000000000000000000000000000000000000000000000000000001';
const TREASURY_NPUB = 'npub1ahqqyfxyrxn3cg7cdkh9nv6ghn07sqnc4yycwq8wlyjd3dr8wt9qjhuesp';

const mocks = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  fetchFreshPetsEvent: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY } }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { petsTreasuryNpub: TREASURY_NPUB } }),
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

function createProfileEvent(walletMode: 'bao' | 'cashu', sats = 20_000): NostrEvent {
  return {
    kind: KIND_NOSTR_PET_PROFILE,
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

describe('usePetsPurchaseItem cashu mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishEvent.mockResolvedValue(createProfileEvent('cashu', 20_000));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('cashu', 20_000));
  });

  it('pays the treasury via nutzap and does not deduct profile sats', async () => {
    const sendNutzap = vi.fn().mockResolvedValue(true);
    const externalWallet = {
      totalBalance: 5_000,
      loading: false,
      mintUrl: 'https://mock.mint',
      balances: { 'https://mock.mint': 5_000 },
      sendNutzap,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('cashu', 20_000))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(sendNutzap).toHaveBeenCalledWith(25, TREASURY_NPUB, 'https://mock.mint', {
      memo: 'Pets shop: Apple',
    });

    const published = mocks.publishEvent.mock.calls[0]?.[0] as NostrEvent | undefined;
    expect(published).toBeDefined();
    expect(published?.tags.some((t) => t[0] === 'storage' && t[1] === 'food_apple:1')).toBe(true);
    expect(published?.tags.find((t) => t[0] === 'sats')?.[1]).toBe('20000');
  });

  it('fails the purchase when the treasury payment fails', async () => {
    const sendNutzap = vi.fn().mockResolvedValue(false);
    const externalWallet = {
      totalBalance: 5_000,
      loading: false,
      mintUrl: 'https://mock.mint',
      balances: { 'https://mock.mint': 5_000 },
      sendNutzap,
      error: 'mint unreachable',
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('cashu', 20_000))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('mint unreachable');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('throws when the selected mint balance is insufficient', async () => {
    const externalWallet = {
      totalBalance: 5_000,
      loading: false,
      mintUrl: 'https://mock.mint',
      balances: { 'https://mock.mint': 0 },
      sendNutzap: vi.fn(),
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('cashu', 20_000))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Insufficient balance on the selected mint');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});

describe('usePetsPurchaseItem bao mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishEvent.mockResolvedValue(createProfileEvent('bao', 19_800));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('bao', 20_000));
  });

  it('pays the treasury from the BAO wallet and never touches profile sats', async () => {
    const sendNutzap = vi.fn().mockResolvedValue(true);
    const externalWallet = {
      totalBalance: 500,
      loading: false,
      mintUrl: 'https://relay.bao.network/cashu',
      balances: { 'https://relay.bao.network/cashu': 500 },
      sendNutzap,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('bao', 20_000))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(sendNutzap).toHaveBeenCalledWith(25, TREASURY_NPUB, 'https://relay.bao.network/cashu', {
      memo: 'Pets shop: Apple',
    });
    // The profile `sats` tag is in-game earnings only — the shop never spends it.
    const published = mocks.publishEvent.mock.calls[0]?.[0] as NostrEvent | undefined;
    expect(published?.tags.find((t) => t[0] === 'sats')?.[1]).toBe('20000');
  });

  it('fails when the BAO wallet cannot cover the cost', async () => {
    const externalWallet = {
      totalBalance: 10,
      loading: false,
      mintUrl: 'https://relay.bao.network/cashu',
      balances: { 'https://relay.bao.network/cashu': 10 },
      sendNutzap: vi.fn(),
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('bao', 10))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Insufficient balance on the selected mint');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});
