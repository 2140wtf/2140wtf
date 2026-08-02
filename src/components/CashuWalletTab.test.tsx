import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { CashuWalletTab } from './CashuWalletTab';

const mocks = vi.hoisted(() => ({
  sendTokenMock: vi.fn(),
  mintFromQuoteMock: vi.fn(),
  removeMintMock: vi.fn(),
  transactions: [] as Array<Record<string, unknown>>,
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
    balances: { 'https://mint.example': 0 },
    loading: false,
    calculateAllBalances: vi.fn(),
    backupStatus: 'idle',
    receiveToken: vi.fn(),
    requestInvoice: vi.fn(),
    requestBolt12Offer: vi.fn(),
    mintFromQuote: mocks.mintFromQuoteMock,
    sendToken: mocks.sendTokenMock,
    payInvoice: vi.fn(async () => ({ success: true })),
    sendNutzap: vi.fn(),
    nutzaps: [],
    addCustomMint: vi.fn(),
    removeCustomMint: mocks.removeMintMock,
    fetchBackup: vi.fn(),
    restoreFromBackup: vi.fn(),
    transactions: mocks.transactions,
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
    mocks.removeMintMock.mockResolvedValue({ status: 'removed' });
    mocks.transactions = [];
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

  it('restores a pending BOLT12 deposit offer after remount and confirms through the BOLT12 endpoint', async () => {
    mocks.transactions = [{
      id: 'pending-offer',
      type: 'mint',
      amount: 21,
      memo: 'BOLT12 deposit',
      mintUrl: 'https://mint.example',
      status: 'pending',
      createdAt: Date.now(),
      quoteId: 'bolt12-quote',
      paymentRequest: 'lno1restored-offer',
      bolt12: true,
    }];
    render(<MemoryRouter><CashuWalletTab /></MemoryRouter>);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Receive' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Lightning invoice' }));

    await screen.findByText('lno1restored-offer');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm payment' }));

    expect(mocks.mintFromQuoteMock).toHaveBeenCalledWith('bolt12-quote', 21, 'bolt12');
  });
});

describe('CashuWalletTab mint management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.transactions = [];
    mocks.removeMintMock.mockResolvedValue({ status: 'removed' });
  });

  afterEach(() => cleanup());

  it('keeps the add controls responsive and bounds the mint manager to the viewport', () => {
    render(<MemoryRouter><CashuWalletTab /></MemoryRouter>);

    const nameInput = screen.getByPlaceholderText('Mint name');
    expect(nameInput.parentElement).toHaveClass('grid', 'sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto]');
    expect(nameInput).toHaveClass('min-w-0');
    expect(screen.getByPlaceholderText('https://mint.example.com')).toHaveClass('min-w-0');

    fireEvent.click(screen.getByRole('button', { name: 'Manage mints' }));
    expect(screen.getByRole('dialog', { name: 'Manage mints' })).toHaveClass(
      'max-h-[calc(100dvh-2rem)]',
      'overflow-y-auto',
    );
  });

  it('removes a zero-balance mint directly from the manager', async () => {
    render(<MemoryRouter><CashuWalletTab /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Manage mints' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Test Mint' }));

    await waitFor(() => expect(mocks.removeMintMock).toHaveBeenCalledWith('https://mint.example', undefined));
    expect(screen.queryByText('This mint still holds ecash')).not.toBeInTheDocument();
  });

  it('warns with the authoritative balance before destructive removal', async () => {
    mocks.removeMintMock
      .mockResolvedValueOnce({ status: 'confirmation-required', balance: 42 })
      .mockResolvedValueOnce({ status: 'removed' });
    render(<MemoryRouter><CashuWalletTab /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Manage mints' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Test Mint' }));

    expect(await screen.findByText(/holds 42 sats/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove and lose 42 sats' }));
    await waitFor(() => expect(mocks.removeMintMock).toHaveBeenLastCalledWith('https://mint.example', 42));
  });
});
