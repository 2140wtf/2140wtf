import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { usePetsPurchaseItem, splitSatsPayment, splitFiatPayment, PET_FIAT_RESERVE_SATS } from './usePetsPurchaseItem';
import { parseNostrPetProfileEvent, KIND_NOSTR_PET_PROFILE } from '@/pets/core/lib/pets';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';

const PUBKEY = '0000000000000000000000000000000000000000000000000000000000000001';
const TREASURY_NPUB = 'npub1ahqqyfxyrxn3cg7cdkh9nv6ghn07sqnc4yycwq8wlyjd3dr8wt9qjhuesp';

const mocks = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  fetchFreshPetsEvent: vi.fn(),
  toast: vi.fn(),
  petsEnabled: { value: true },
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
  usePetsNostrPublish: () => ({ mutateAsync: mocks.publishEvent, petsEnabled: mocks.petsEnabled.value }),
}));

vi.mock('@/pets/core/lib/fetchFreshPetsEvent', () => ({
  fetchFreshPetsEvent: mocks.fetchFreshPetsEvent,
}));

vi.mock('@/hooks/useToast', () => ({
  toast: mocks.toast,
}));

function createProfileEvent(walletMode: 'bao' | 'cashu', sats = 20_000, coins?: number): NostrEvent {
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
      ...(coins !== undefined ? [['coins', coins.toString()]] : []),
    ],
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.petsEnabled.value = true;
  localStorage.clear();
});

describe('usePetsPurchaseItem cashu mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishEvent.mockResolvedValue(createProfileEvent('cashu', 20_000));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('cashu', 20_000));
  });

  it('pays the treasury via nutzap and does not deduct profile sats', async () => {
    const sendNutzap = vi.fn().mockResolvedValue({ status: 'sent', eventId: 'nutzap-event-id' });
    const externalWallet = {
      totalBalance: 5_000,
      loading: false,
      mintUrl: 'https://mock.mint',
      balances: { 'https://mock.mint': 5_000 },
      sendNutzap,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('cashu', 20_000))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet, undefined, 'cashu'), { wrapper });

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
    const sendNutzap = vi.fn().mockResolvedValue({ status: 'failed' });
    const externalWallet = {
      totalBalance: 5_000,
      loading: false,
      mintUrl: 'https://mock.mint',
      balances: { 'https://mock.mint': 5_000 },
      sendNutzap,
      error: 'mint unreachable',
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('cashu', 20_000))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet, undefined, 'cashu'), { wrapper });

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
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet, undefined, 'cashu'), { wrapper });

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
    const sendNutzap = vi.fn().mockResolvedValue({ status: 'sent', eventId: 'nutzap-event-id' });
    const externalWallet = {
      totalBalance: 500,
      loading: false,
      mintUrl: 'https://relay.bao.network/cashu',
      balances: { 'https://relay.bao.network/cashu': 500 },
      sendNutzap,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('bao', 20_000))!;
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet, undefined, 'bao'), { wrapper });

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
    const { result } = renderHook(() => usePetsPurchaseItem(profile, null, externalWallet, undefined, 'bao'), { wrapper });

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Insufficient balance on the selected mint');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});

describe('usePetsPurchaseItem rail resolution (desync safety)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('charges REAL sats when the charged wallet is mainnet even if the profile tag says bao', async () => {
    // Profile tag desynced (stale 'bao') but the caller handed us the real
    // Cashu wallet with walletMode 'cashu' — the purchase must be labeled and
    // treated as real sats, and pet fiat must NOT offset the cost.
    mocks.publishEvent.mockResolvedValue(createProfileEvent('cashu', 20_000));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('bao', 20_000));
    const sendNutzap = vi.fn().mockResolvedValue({ status: 'sent', eventId: 'nutzap-event-id' });
    const externalWallet = {
      totalBalance: 5_000,
      loading: false,
      mintUrl: 'https://mock.mint',
      balances: { 'https://mock.mint': 5_000 },
      sendNutzap,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('bao', 20_000))!;
    const companion = {
      fiatBalance: 2_140,
      event: { kind: 31124, tags: [['fiat_balance', '2140']], content: '' },
    } as never;
    const { result } = renderHook(
      () => usePetsPurchaseItem(profile, companion, externalWallet, undefined, 'cashu'),
      { wrapper },
    );

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Full cost charged to the real wallet — no pet-fiat offset.
    expect(sendNutzap).toHaveBeenCalledWith(25, TREASURY_NPUB, 'https://mock.mint', {
      memo: 'Pets shop: Apple',
    });
    // No companion fiat deduction event was published (only the profile update).
    for (const call of mocks.publishEvent.mock.calls) {
      const ev = call[0] as NostrEvent;
      expect(ev.tags.some((t) => t[0] === 'fiat_balance')).toBe(false);
    }
    expect(result.current.data?.currency).toBe('sats');
  });

  it('treats the purchase as DEMO when the charged wallet is the BAO wallet even if the profile tag says cashu', async () => {
    // Profile tag desynced (stale 'cashu') but the charged wallet is the BAO
    // signet wallet — the receipt must say "demo sats", never "sats".
    mocks.publishEvent.mockResolvedValue(createProfileEvent('bao', 20_000));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('cashu', 20_000));
    const sendNutzap = vi.fn().mockResolvedValue({ status: 'sent', eventId: 'nutzap-event-id' });
    const externalWallet = {
      totalBalance: 500,
      loading: false,
      mintUrl: 'https://relay.bao.network/cashu',
      balances: { 'https://relay.bao.network/cashu': 500 },
      sendNutzap,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('cashu', 20_000))!;
    const { result } = renderHook(
      () => usePetsPurchaseItem(profile, null, externalWallet, undefined, 'bao'),
      { wrapper },
    );

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.currency).toBe('demo sats');
  });

  it('falls back to the profile tag only when no wallet mode is provided', async () => {
    mocks.publishEvent.mockResolvedValue(createProfileEvent('bao', 20_000));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('bao', 20_000));
    const sendNutzap = vi.fn().mockResolvedValue({ status: 'sent', eventId: 'nutzap-event-id' });
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
    expect(result.current.data?.currency).toBe('demo sats');
  });

  it('lets pet fiat offset the cost in DEMO mode only', async () => {
    mocks.publishEvent.mockImplementation(async (event: NostrEvent) => event);
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('bao', 20_000));
    const sendNutzap = vi.fn().mockResolvedValue({ status: 'sent', eventId: 'nutzap-event-id' });
    const externalWallet = {
      totalBalance: 500,
      loading: false,
      mintUrl: 'https://relay.bao.network/cashu',
      balances: { 'https://relay.bao.network/cashu': 500 },
      sendNutzap,
    } as unknown as CashuWalletState & CashuWalletActions;

    const profile = parseNostrPetProfileEvent(createProfileEvent('bao', 20_000))!;
    // Pet can cover the whole 25-sat apple and keep the 100-sat reserve.
    const companion = {
      fiatBalance: 2_140,
      event: { kind: 31124, tags: [['fiat_balance', '2140']], content: '' },
    } as never;
    const { result } = renderHook(
      () => usePetsPurchaseItem(profile, companion, externalWallet, undefined, 'bao'),
      { wrapper },
    );

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Fully covered by pet fiat — the wallet is never charged in demo mode.
    expect(sendNutzap).not.toHaveBeenCalled();
    expect(result.current.data?.petFiatSpend).toBe(25);
  });
});

describe('starter currency split (one fiat rail, two pots)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spends pet fiat first down to the reserve, then coins, then the wallet', () => {
    // Pet fiat covers everything (reserve kept).
    expect(splitSatsPayment(25, 2_140, 500)).toEqual({ petFiatSpend: 25, coinsSpend: 0, walletSatsCost: 0 });
    // Pet fiat drains to the reserve; coins cover the rest; wallet untouched.
    expect(splitSatsPayment(200, 150, 500)).toEqual({
      petFiatSpend: 150 - PET_FIAT_RESERVE_SATS,
      coinsSpend: 200 - (150 - PET_FIAT_RESERVE_SATS),
      walletSatsCost: 0,
    });
    // Pet fiat below the reserve is never touched; coins then wallet.
    expect(splitSatsPayment(200, 50, 120)).toEqual({ petFiatSpend: 0, coinsSpend: 120, walletSatsCost: 80 });
    // Nothing but the wallet.
    expect(splitSatsPayment(200, 0, 0)).toEqual({ petFiatSpend: 0, coinsSpend: 0, walletSatsCost: 200 });
  });

  it('omitting coins preserves the old two-pot behavior', () => {
    expect(splitSatsPayment(25, 2_140)).toEqual({ petFiatSpend: 25, coinsSpend: 0, walletSatsCost: 0 });
    expect(splitSatsPayment(200, 150)).toEqual({
      petFiatSpend: 50,
      coinsSpend: 0,
      walletSatsCost: 150,
    });
  });

  it('splitFiatPayment drains pet fiat then coins and rejects what starter currency cannot cover', () => {
    expect(splitFiatPayment(25, 2_140, 0)).toEqual({ petFiatSpend: 25, coinsSpend: 0 });
    expect(splitFiatPayment(200, 150, 500)).toEqual({ petFiatSpend: 50, coinsSpend: 150 });
    expect(splitFiatPayment(200, 150, 100)).toBeNull();
    expect(splitFiatPayment(0, 0, 0)).toEqual({ petFiatSpend: 0, coinsSpend: 0 });
  });

  it('a fiat purchase drains pet fiat (to the reserve) then account coins', async () => {
    mocks.publishEvent.mockImplementation(async (event: NostrEvent) => event);
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('bao', 20_000, 100));

    const profile = parseNostrPetProfileEvent(createProfileEvent('bao', 20_000, 100))!;
    // 115 pet fiat → 15 spendable above the reserve; the 25-cost apple then
    // takes the remaining 10 from the 100 account coins.
    const companion = {
      fiatBalance: 115,
      event: { kind: 31124, tags: [['fiat_balance', '115']], content: '' },
    } as never;
    const { result } = renderHook(
      () => usePetsPurchaseItem(profile, companion, null, undefined, 'bao'),
      { wrapper },
    );

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'fiat' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.petFiatSpend).toBe(15);
    expect(result.current.data?.coinsSpend).toBe(10);

    const published = mocks.publishEvent.mock.calls.map(([arg]) => arg as NostrEvent);
    const companionPublish = published.find((e) => e.kind === 31124);
    expect(companionPublish?.tags.find((t) => t[0] === 'fiat_balance')?.[1]).toBe('100');
    const profilePublish = published.find((e) => e.kind === KIND_NOSTR_PET_PROFILE);
    expect(profilePublish?.tags.find((t) => t[0] === 'coins')?.[1]).toBe('90');
  });

  it('refuses a fiat purchase the combined starter currency cannot cover', async () => {
    mocks.publishEvent.mockImplementation(async (event: NostrEvent) => event);
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('bao', 20_000, 5));

    const profile = parseNostrPetProfileEvent(createProfileEvent('bao', 20_000, 5))!;
    const companion = {
      fiatBalance: 110, // only 10 spendable above the reserve → 15 total < 25
      event: { kind: 31124, tags: [['fiat_balance', '110']], content: '' },
    } as never;
    const { result } = renderHook(
      () => usePetsPurchaseItem(profile, companion, null, undefined, 'bao'),
      { wrapper },
    );

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'fiat' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Insufficient starter currency');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});

describe('usePetsPurchaseItem hunt regressions (rounds 2-3)', () => {
  function cashuWallet(sendNutzap = vi.fn().mockResolvedValue({ status: 'sent', eventId: 'nutzap-event-id' })) {
    return {
      totalBalance: 5_000,
      loading: false,
      mintUrl: 'https://mock.mint',
      balances: { 'https://mock.mint': 5_000 },
      sendNutzap,
    } as unknown as CashuWalletState & CashuWalletActions;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishEvent.mockResolvedValue(createProfileEvent('cashu', 20_000));
    mocks.fetchFreshPetsEvent.mockResolvedValue(createProfileEvent('cashu', 20_000));
  });

  it('[27] refuses BEFORE paying when pets publishing is disabled', async () => {
    // Regression: the treasury nutzap used to go out first and the publish
    // guard threw afterwards — a deterministic failure AFTER the payment.
    mocks.petsEnabled.value = false;
    const sendNutzap = vi.fn();
    const profile = parseNostrPetProfileEvent(createProfileEvent('cashu', 20_000))!;
    const { result } = renderHook(
      () => usePetsPurchaseItem(profile, null, cashuWallet(sendNutzap), undefined, 'cashu'),
      { wrapper },
    );

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Pets publishing is disabled');
    expect(sendNutzap).not.toHaveBeenCalled();
  });

  it('[19] a paid-but-incomplete retry completes delivery WITHOUT a second nutzap', async () => {
    const sendNutzap = vi.fn().mockResolvedValue({ status: 'sent', eventId: 'nutzap-event-id' });
    const profile = parseNostrPetProfileEvent(createProfileEvent('cashu', 20_000))!;
    const { result } = renderHook(
      () => usePetsPurchaseItem(profile, null, cashuWallet(sendNutzap), undefined, 'cashu'),
      { wrapper },
    );
    const journalKey = `pets-shop-paid-pending:${PUBKEY}:food_apple`;

    // Attempt 1: payment lands, profile update fails → paid-but-incomplete.
    mocks.publishEvent.mockRejectedValueOnce(new Error('relay down'));
    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });
    await waitFor(() => expect(result.current.error?.message).toContain('payment was sent to the 2140 treasury'));
    expect(sendNutzap).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(journalKey)).not.toBeNull();

    // Attempt 2: same item + quantity — completes from the journal, no re-payment.
    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(sendNutzap).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(journalKey)).toBeNull();
  });

  it('[19] a retry with a different quantity refuses instead of paying again', async () => {
    const sendNutzap = vi.fn().mockResolvedValue({ status: 'sent', eventId: 'nutzap-event-id' });
    const profile = parseNostrPetProfileEvent(createProfileEvent('cashu', 20_000))!;
    const { result } = renderHook(
      () => usePetsPurchaseItem(profile, null, cashuWallet(sendNutzap), undefined, 'cashu'),
      { wrapper },
    );

    mocks.publishEvent.mockRejectedValueOnce(new Error('relay down'));
    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 1, currency: 'sats' });
    await waitFor(() => expect(result.current.error?.message).toContain('payment was sent to the 2140 treasury'));
    expect(sendNutzap).toHaveBeenCalledTimes(1);

    result.current.mutate({ itemId: 'food_apple', price: 25, quantity: 2, currency: 'sats' });
    await waitFor(() => expect(result.current.error?.message).toContain('did not complete'));
    expect(sendNutzap).toHaveBeenCalledTimes(1);
  });
});
