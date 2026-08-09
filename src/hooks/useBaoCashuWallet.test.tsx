import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrSigner } from '@nostrify/types';

import { useBaoCashuWallet } from './useBaoCashuWallet';

const mocks = vi.hoisted(() => ({
  receiveToken: vi.fn(),
  receiveNutzap: vi.fn(),
  claim: vi.fn(),
  status: vi.fn(),
  pending: vi.fn(),
  clear: vi.fn(),
  receiver: vi.fn(),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { baoSignetMintUrl: 'https://relay.bao.network/cashu' } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: '1'.repeat(64) } }),
}));
vi.mock('@/hooks/useBaoCashuSeed', () => ({
  useBaoCashuSeed: () => ({ seedPhrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' }),
}));
vi.mock('@/hooks/useNip60Sync', () => ({ useNip60Sync: () => undefined }));
vi.mock('@/hooks/usePublishPreferences', () => ({
  usePublishPreferences: () => ({ isEnabled: () => true }),
}));
vi.mock('@/hooks/useNutzapReceiver', () => ({
  useNutzapReceiver: (...args: unknown[]) => mocks.receiver(...args),
}));
vi.mock('@/hooks/useCashuWallet', () => ({
  useCashuWallet: () => ({
    wallet: {},
    allMints: [{ name: 'BAO', url: 'https://relay.bao.network/cashu' }],
    receiveToken: mocks.receiveToken,
    receiveNutzap: mocks.receiveNutzap,
  }),
}));
vi.mock('@/lib/baoWalletApi', () => ({
  claimBaoCashu: (...args: unknown[]) => mocks.claim(...args),
  checkBaoCashuClaimStatus: (...args: unknown[]) => mocks.status(...args),
  fetchPendingBaoCashuTokens: (...args: unknown[]) => mocks.pending(...args),
  clearPendingBaoCashuTokens: (...args: unknown[]) => mocks.clear(...args),
}));

const signer = {
  signEvent: vi.fn(),
  nip44: { encrypt: vi.fn(), decrypt: vi.fn() },
} as unknown as NostrSigner;
const user = { pubkey: '1'.repeat(64), signer };

describe('useBaoCashuWallet API proof collection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.pending.mockResolvedValue([]);
    mocks.clear.mockResolvedValue(undefined);
    mocks.receiveToken.mockResolvedValue(21);
  });

  afterEach(() => vi.useRealTimers());

  it('auto-collects pending API proofs when enabled is omitted (the documented default)', async () => {
    mocks.pending.mockResolvedValueOnce(['cashuBtoken']);
    renderHook(() => useBaoCashuWallet('seed', user, []));

    await waitFor(() => expect(mocks.receiveToken).toHaveBeenCalledWith('cashuBtoken'));
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.receiver).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      mocks.receiveNutzap,
      { relayUrls: ['wss://relay.bao.network'] },
    );
  });

  it('imports pending proofs even while the generic claim status still lags', async () => {
    vi.useFakeTimers();
    mocks.claim.mockResolvedValue({ status: 'pending', idempotency_key: 'claim-key' });
    mocks.pending.mockResolvedValueOnce(['cashuBtoken']);
    const { result } = renderHook(() => useBaoCashuWallet('seed', user, [], { enabled: false }));

    const claimPromise = result.current.claimApiCashu(21);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    await expect(claimPromise).resolves.toMatchObject({
      status: 'completed',
      claimed_sats: 21,
      imported_sats: 21,
    });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  it('does not clear the server copy when local proof storage fails', async () => {
    mocks.pending.mockResolvedValue(['cashuBtoken']);
    mocks.receiveToken.mockResolvedValue(0);
    const { result } = renderHook(() => useBaoCashuWallet('seed', user, [], { enabled: false }));

    await expect(result.current.collectPendingApiCashu()).rejects.toThrow('server copy was kept for retry');
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
