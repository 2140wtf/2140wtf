import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { CashuWalletTab } from './CashuWalletTab';

const mocks = vi.hoisted(() => ({
  sendTokenMock: vi.fn(),
}));

vi.mock('@/hooks/useCashuWalletContext', () => ({
  useCashuWalletContext: () => ({
    error: '',
    success: '',
    clearError: vi.fn(),
    clearSuccess: vi.fn(),
    allMints: [{ name: 'Test Mint', url: 'https://mint.example' }],
    mintUrl: 'https://mint.example',
    setMintUrl: vi.fn(),
    totalBalance: 10_000,
    loading: false,
    calculateAllBalances: vi.fn(),
    backupStatus: 'idle',
    receiveToken: vi.fn(),
    requestInvoice: vi.fn(),
    mintFromQuote: vi.fn(),
    sendToken: mocks.sendTokenMock,
    payInvoice: vi.fn(async () => ({ success: true })),
    sendNutzap: vi.fn(),
    nutzaps: [],
    addCustomMint: vi.fn(),
    removeCustomMint: vi.fn(),
    fetchBackup: vi.fn(),
    restoreFromBackup: vi.fn(),
    transactions: [],
    seedPhrase: 'test seed phrase',
  }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'sender-pubkey' } }),
}));

const OUTBOX_KEY = 'bao_cashu_wallet_send_sender-pubkey_https://mint.example';

describe('CashuWalletTab send token persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.sendTokenMock.mockResolvedValue('cashuBtesttoken');
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the generated token across unmount — a tab switch cannot burn the sats', async () => {
    // Regression: the token was kept only in useState while sendToken had
    // already debited the wallet, so unmounting (tab switch / navigation)
    // destroyed the only copy of the money.
    const { unmount } = render(<MemoryRouter><CashuWalletTab /></MemoryRouter>);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Send' }));
    fireEvent.change(screen.getByPlaceholderText('Amount in sats'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /generate token/i }));

    await screen.findByText('cashuBtesttoken');
    expect(localStorage.getItem(OUTBOX_KEY)).toBe(JSON.stringify('cashuBtesttoken'));

    // Simulate the tab switch / navigation that used to destroy the token.
    unmount();
    render(<MemoryRouter><CashuWalletTab /></MemoryRouter>);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Send' }));
    await screen.findByText('cashuBtesttoken');
  });

  it('dismiss clears the persisted token only on explicit user action', async () => {
    render(<MemoryRouter><CashuWalletTab /></MemoryRouter>);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Send' }));
    fireEvent.change(screen.getByPlaceholderText('Amount in sats'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /generate token/i }));

    await screen.findByText('cashuBtesttoken');
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByText('cashuBtesttoken')).not.toBeInTheDocument();
    expect(localStorage.getItem(OUTBOX_KEY)).toBe(JSON.stringify(''));
  });
});
