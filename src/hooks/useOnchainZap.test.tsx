import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useOnchainZap } from './useOnchainZap';

const mocks = vi.hoisted(() => ({
  toastMock: vi.fn(),
  isEnabledMock: vi.fn<(key: string) => boolean>(),
  publishEventMock: vi.fn(),
  signPsbtMock: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'sender-pubkey' } }),
}));

vi.mock('@/hooks/useBitcoinSigner', () => ({
  useBitcoinSigner: () => ({ canSignPsbt: true, signPsbt: mocks.signPsbtMock }),
  isSignerCapabilityError: () => false,
  reportSignerUnsupported: vi.fn(),
}));

vi.mock('@/hooks/useBitcoinWallet', () => ({
  useBitcoinWallet: () => ({ hd: null }),
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: mocks.publishEventMock }),
}));

vi.mock('@/hooks/usePublishPreferences', () => ({
  usePublishPreferences: () => ({ isEnabled: mocks.isEnabledMock }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toastMock }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { esploraApis: ['https://esplora.example'] } }),
}));

vi.mock('@/lib/haptics', () => ({
  notificationSuccess: vi.fn(),
}));

vi.mock('@/lib/bitcoin', () => ({
  nostrPubkeyToBitcoinAddress: () => 'bc1qexampleaddress',
  fetchUTXOs: vi.fn(async () => [{ txid: 'utxo-txid', vout: 0, value: 100_000 }]),
  getFeeRates: vi.fn(async () => ({
    fastestFee: 10,
    halfHourFee: 5,
    hourFee: 3,
    economyFee: 2,
    minimumFee: 1,
  })),
  buildUnsignedPsbt: vi.fn(() => ({ psbtHex: 'unsigned-psbt', fee: 500 })),
  buildUnsignedPsbtHd: vi.fn(),
  buildUnsignedSilentPaymentPsbt: vi.fn(),
  finalizePsbt: vi.fn(() => 'final-tx-hex'),
  broadcastTransaction: vi.fn(async () => 'broadcast-txid'),
  estimateFeeWithDustChange: vi.fn(() => ({ fee: 500 })),
  validateBitcoinAddress: () => true,
}));

vi.mock('@/lib/hdWallet', () => ({
  selectUtxos: vi.fn(),
}));

vi.mock('@/lib/psbtV2', () => ({
  extractTxFromSignedPsbtV2: vi.fn(() => 'final-tx-hex'),
}));

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>();
  return { ...actual, verifyEvent: () => true };
});

function makeTarget(): NostrEvent {
  return {
    id: 'target-id',
    kind: 1,
    pubkey: 'target-pubkey',
    content: 'hello',
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
    sig: 'sig',
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function destructiveReceiptToasts() {
  return mocks.toastMock.mock.calls.filter(
    ([arg]) => arg?.variant === 'destructive' && arg?.title === 'Zap receipt not published',
  );
}

describe('useOnchainZap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signPsbtMock.mockResolvedValue('signed-psbt');
    mocks.publishEventMock.mockResolvedValue({ id: 'receipt-event-id' });
  });

  afterEach(() => {
    cleanup();
  });

  it('does NOT show the destructive "receipt not published" toast when the user disabled zap receipts', async () => {
    // Regression: a successful on-chain zap with receipts intentionally
    // disabled in publish preferences was reported as a failed receipt
    // publish — a false error on every successful zap.
    mocks.isEnabledMock.mockReturnValue(false);

    const { result } = renderHook(() => useOnchainZap(makeTarget()), { wrapper });
    await act(async () => {
      await result.current.zapAsync({ amountSats: 1000 });
    });

    // The receipt publish must not even be attempted…
    expect(mocks.publishEventMock).not.toHaveBeenCalled();
    // …and no false failure toast may fire.
    expect(destructiveReceiptToasts()).toHaveLength(0);
    // The ordinary success toast still fires.
    await waitFor(() =>
      expect(mocks.toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Bitcoin zap sent!' }),
      ),
    );
  });

  it('DOES show the "receipt not published" toast when receipts are enabled and the publish fails', async () => {
    mocks.isEnabledMock.mockReturnValue(true);
    mocks.publishEventMock.mockRejectedValue(new Error('all relays down'));

    const { result } = renderHook(() => useOnchainZap(makeTarget()), { wrapper });
    await act(async () => {
      await result.current.zapAsync({ amountSats: 1000 });
    });

    await waitFor(() => expect(destructiveReceiptToasts()).toHaveLength(1));
  });

  it('does not show the receipt toast when receipts are enabled and the publish succeeds', async () => {
    mocks.isEnabledMock.mockReturnValue(true);

    const { result } = renderHook(() => useOnchainZap(makeTarget()), { wrapper });
    await act(async () => {
      await result.current.zapAsync({ amountSats: 1000 });
    });

    await waitFor(() =>
      expect(mocks.toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Bitcoin zap sent!' }),
      ),
    );
    expect(destructiveReceiptToasts()).toHaveLength(0);
  });
});
