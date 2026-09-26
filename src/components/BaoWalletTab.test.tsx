import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The wallet tab pulls in relay/API hooks and the custodial panels; stub them
// so the test exercises the Demo ↔ Testnet switch in isolation.
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useBaoWalletBalances', () => ({
  useBaoWalletBalances: () => ({ data: null, refetch: vi.fn(), isPending: false, isError: false, error: null }),
}));
vi.mock('@/hooks/useWallet', () => ({ useWallet: () => ({}) }));
vi.mock('@/hooks/useNWCContext', () => ({ useNWC: () => ({}) }));
vi.mock('@/hooks/useSearchProfiles', () => ({ useSearchProfiles: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/usePublishPreferences', () => ({
  usePublishPreferences: () => ({ prefs: {}, isEnabled: () => false, setEnabled: vi.fn(), setEnabledMany: vi.fn(), isLoading: false }),
}));
vi.mock('@/hooks/useUserSeckey', () => ({ useUserSeckey: () => undefined }));
vi.mock('@/baofund/wallet/rails/Testnet4WalletCard', () => ({
  Testnet4WalletCard: () => <div data-testid="testnet4-card" />,
}));
vi.mock('@/baofund/wallet/rails/LiquidTestnetWalletCard', () => ({
  LiquidTestnetWalletCard: () => <div data-testid="liquid-card" />,
}));
vi.mock('@/hooks/useBaoCashuWallet', () => ({
  useBaoCashuWallet: () => ({
    loading: false,
    totalBalance: 0,
    calculateAllBalances: vi.fn(),
    error: null,
    success: null,
    clearError: vi.fn(),
    clearSuccess: vi.fn(),
    allMints: [],
    transactions: [],
    mintUrl: null,
    setMintUrl: vi.fn(),
    claimApiCashu: vi.fn(),
    collectPendingApiCashu: vi.fn(),
    mintFromQuote: vi.fn(),
    receiveToken: vi.fn(),
    requestInvoice: vi.fn(),
    sendNutzap: vi.fn(),
    sendToken: vi.fn(),
    watchMintQuote: vi.fn(),
  }),
}));

import { BaoWalletTab } from './BaoWalletTab';

const user = { pubkey: 'a'.repeat(64), signer: {} as never };

describe('BaoWalletTab network toggle', () => {
  it('starts in the demo ledger and switches to the Testnet rails', async () => {
    render(<BaoWalletTab seedPhrase="" user={user} relayUrls={[]} />);

    // Demo mode: the custodial signet ledger is shown.
    expect(screen.getByText('₿AO testnet coins')).toBeInTheDocument();
    expect(screen.queryByTestId('testnet4-card')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Testnet' }));

    expect(await screen.findByTestId('testnet4-card')).toBeInTheDocument();
    expect(await screen.findByTestId('liquid-card')).toBeInTheDocument();
    expect(screen.queryByText('₿AO testnet coins')).not.toBeInTheDocument();
  });
});
