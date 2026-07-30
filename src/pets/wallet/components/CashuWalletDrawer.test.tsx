import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CashuWalletDrawer } from './CashuWalletDrawer';

const mocks = vi.hoisted(() => ({
  sendTokenMock: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'sender-pubkey' } }),
}));

const OUTBOX_KEY = 'bao_cashu_drawer_send_sender-pubkey_https://mint.example';

function makeWallet() {
  return {
    wallet: null,
    mintUrl: 'https://mint.example',
    allMints: [{ name: 'Test Mint', url: 'https://mint.example' }],
    mintInfo: null,
    balances: { 'https://mint.example': 10_000 },
    totalBalance: 10_000,
    transactions: [],
    seedPhrase: 'test seed phrase',
    isNewWallet: false,
    showSeedBackup: false,
    loading: false,
    error: '',
    success: '',
    backupStatus: 'idle' as const,
    lastBackupAt: null,
    nutzaps: [],
    setMintUrl: vi.fn(),
    calculateAllBalances: vi.fn(),
    receiveToken: vi.fn(),
    sendToken: mocks.sendTokenMock,
    requestInvoice: vi.fn(),
    mintFromQuote: vi.fn(),
  };
}

describe('CashuWalletDrawer send token persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.sendTokenMock.mockResolvedValue('cashuBtesttoken');
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the generated token when the drawer closes — closing cannot burn the sats', async () => {
    // Regression: the token lived only in component state (with no copy
    // button), so closing the drawer destroyed the only copy of the money
    // while the wallet stayed debited.
    const wallet = makeWallet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { unmount } = render(<CashuWalletDrawer wallet={wallet as any} title="Mainnet Cashu balance" />);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Send' }));
    fireEvent.change(screen.getByPlaceholderText('Amount in sats'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /generate token/i }));

    await screen.findByText('cashuBtesttoken');
    expect(localStorage.getItem(OUTBOX_KEY)).toBe(JSON.stringify('cashuBtesttoken'));
    // A copy button now exists — the token used to be select-only.
    expect(screen.getByRole('button', { name: /copy token/i })).toBeInTheDocument();

    // Closing the drawer (unmount) must not lose the token.
    unmount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<CashuWalletDrawer wallet={wallet as any} title="Mainnet Cashu balance" />);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Send' }));
    await screen.findByText('cashuBtesttoken');
  });

  it('dismiss clears the persisted token only on explicit user action', async () => {
    const wallet = makeWallet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<CashuWalletDrawer wallet={wallet as any} title="Mainnet Cashu balance" />);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Send' }));
    fireEvent.change(screen.getByPlaceholderText('Amount in sats'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /generate token/i }));

    await screen.findByText('cashuBtesttoken');
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByText('cashuBtesttoken')).not.toBeInTheDocument();
    expect(localStorage.getItem(OUTBOX_KEY)).toBe(JSON.stringify(''));
  });
});
