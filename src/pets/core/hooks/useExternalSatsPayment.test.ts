import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useExternalSatsPayment, paySatsWithWallet } from './useExternalSatsPayment';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';

type MockExternalWallet = Partial<CashuWalletState & CashuWalletActions>;

function mockWallet(overrides: MockExternalWallet = {}): CashuWalletState & CashuWalletActions {
  return {
    totalBalance: 0,
    loading: false,
    sendToken: vi.fn(),
    ...overrides,
  } as unknown as CashuWalletState & CashuWalletActions;
}

describe('useExternalSatsPayment', () => {
  it('returns the token when the wallet has enough balance', async () => {
    const wallet = mockWallet({ totalBalance: 500, sendToken: vi.fn().mockResolvedValue('token123') });
    const { result } = renderHook(() => useExternalSatsPayment(wallet));

    const token = await result.current.paySats(100, 'test payment');

    expect(token).toBe('token123');
    expect(wallet.sendToken).toHaveBeenCalledWith(100, 'test payment');
  });

  it('throws when the wallet balance is too low', async () => {
    const wallet = mockWallet({ totalBalance: 50 });
    const { result } = renderHook(() => useExternalSatsPayment(wallet));

    await expect(result.current.paySats(100)).rejects.toThrow('Insufficient external wallet balance');
  });

  it('throws when sendToken returns null', async () => {
    const wallet = mockWallet({ totalBalance: 500, sendToken: vi.fn().mockResolvedValue(null) });
    const { result } = renderHook(() => useExternalSatsPayment(wallet));

    await expect(result.current.paySats(100)).rejects.toThrow('External payment failed');
  });

  it('throws when no wallet is provided', async () => {
    const { result } = renderHook(() => useExternalSatsPayment(null));

    await expect(result.current.paySats(100)).rejects.toThrow('External wallet is not available');
  });
});

describe('paySatsWithWallet', () => {
  it('returns the token on success', async () => {
    const wallet = mockWallet({ totalBalance: 200, sendToken: vi.fn().mockResolvedValue('abc') });
    const token = await paySatsWithWallet(wallet, 100);
    expect(token).toBe('abc');
  });

  it('throws on insufficient balance', async () => {
    const wallet = mockWallet({ totalBalance: 10 });
    await expect(paySatsWithWallet(wallet, 100)).rejects.toThrow('Insufficient external wallet balance');
  });
});
