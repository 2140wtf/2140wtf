import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useBaoPayment, payBaoSatsWithWallet } from './useBaoPayment';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';

type MockBaoWallet = Partial<CashuWalletState & CashuWalletActions>;

function mockWallet(overrides: MockBaoWallet = {}): CashuWalletState & CashuWalletActions {
  return {
    totalBalance: 0,
    loading: false,
    sendToken: vi.fn(),
    ...overrides,
  } as unknown as CashuWalletState & CashuWalletActions;
}

describe('useBaoPayment', () => {
  it('returns the token when the wallet has enough balance', async () => {
    const wallet = mockWallet({ totalBalance: 500, sendToken: vi.fn().mockResolvedValue('token123') });
    const { result } = renderHook(() => useBaoPayment(wallet));

    const token = await result.current.payBaoSats(100, 'test payment');

    expect(token).toBe('token123');
    expect(wallet.sendToken).toHaveBeenCalledWith(100, 'test payment');
  });

  it('throws when the wallet balance is too low', async () => {
    const wallet = mockWallet({ totalBalance: 50 });
    const { result } = renderHook(() => useBaoPayment(wallet));

    await expect(result.current.payBaoSats(100)).rejects.toThrow('Insufficient BAO balance');
  });

  it('throws when sendToken returns null', async () => {
    const wallet = mockWallet({ totalBalance: 500, sendToken: vi.fn().mockResolvedValue(null) });
    const { result } = renderHook(() => useBaoPayment(wallet));

    await expect(result.current.payBaoSats(100)).rejects.toThrow('BAO payment failed');
  });

  it('throws when no wallet is provided', async () => {
    const { result } = renderHook(() => useBaoPayment(null));

    await expect(result.current.payBaoSats(100)).rejects.toThrow('BAO wallet is not available');
  });
});

describe('payBaoSatsWithWallet', () => {
  it('returns the token on success', async () => {
    const wallet = mockWallet({ totalBalance: 200, sendToken: vi.fn().mockResolvedValue('abc') });
    const token = await payBaoSatsWithWallet(wallet, 100);
    expect(token).toBe('abc');
  });

  it('throws on insufficient balance', async () => {
    const wallet = mockWallet({ totalBalance: 10 });
    await expect(payBaoSatsWithWallet(wallet, 100)).rejects.toThrow('Insufficient BAO balance');
  });
});
