import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  completeLightningTopUp,
  createLightningTopUp,
  hydrateStoredWallet,
  listStoredMints,
  loadStoredWallet,
  onStoreChange,
  payLightningQuote,
  quoteLightningPayment,
  receiveIntoStoredWallet,
  removeStoredMint,
  spendFromStoredWallet,
  sumProofs,
  switchStoredMint,
  totalStoredBalance,
} from './cashuWallet';
import { clearTransactions, loadTransactions, onHistoryChange } from './walletHistory';
import type { WalletState, WalletActions } from './types';

/**
 * Thin React projection of the Stored Wallet: every read-modify-write cycle
 * lives inside cashuWallet's serialized operations; this hook mirrors
 * committed state via push notification and forwards actions.
 */
export function useWallet(): WalletState & WalletActions {
  const [stored, setStored] = useState(loadStoredWallet);
  const [mints, setMints] = useState(listStoredMints);
  const [totalBalanceSats, setTotalBalanceSats] = useState(totalStoredBalance);
  const [transactions, setTransactions] = useState(loadTransactions);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setStored(loadStoredWallet());
    setMints(listStoredMints());
    setTotalBalanceSats(totalStoredBalance());
    setTransactions(loadTransactions());
  }, []);

  // Push notification covers this tab's writes AND writes from other tabs.
  useEffect(() => onStoreChange(refresh), [refresh]);

  // History writes (incl. on-chain rail sends) notify in-tab via this channel;
  // `storage` events only fire in OTHER tabs, never the writer.
  useEffect(() => onHistoryChange(refresh), [refresh]);

  // Boot recovery (R11): resolve any mint operation interrupted by a crash
  // BEFORE the UI offers spend/receive. Fail closed with a visible error.
  useEffect(() => {
    hydrateStoredWallet()
      .then(refresh)
      .catch((e) => setError(String(e)));
  }, [refresh]);

  /** Run a wallet action with shared loading/error/refresh plumbing. */
  const run = useCallback(
    async <T,>(op: () => Promise<T>): Promise<T> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await op();
        refresh();
        return result;
      } catch (e) {
        setError(String(e));
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [refresh],
  );

  const setMintUrl = useCallback(
    (url: string) => run(() => switchStoredMint(url)),
    [run],
  );

  const removeMint = useCallback(
    (url: string) => run(() => removeStoredMint(url)),
    [run],
  );

  const refreshProofs = useCallback(async () => {
    // Placeholder: in a full wallet we would swap/split old proofs here.
    setError(null);
  }, []);

  const receiveTokenCb = useCallback(
    async (token: string) => {
      const { receivedSats } = await run(() => receiveIntoStoredWallet(token));
      return receivedSats;
    },
    [run],
  );

  const sendSatsCb = useCallback(
    async (amount: number, mintUrl?: string) => {
      const { token } = await run(() => spendFromStoredWallet(amount, mintUrl));
      return token;
    },
    [run],
  );

  const createTopUpCb = useCallback(
    (amountSats: number, mintUrl?: string) => run(() => createLightningTopUp(amountSats, mintUrl)),
    [run],
  );

  const completeTopUpCb = useCallback(
    (quoteId: string, mintUrl?: string) => run(() => completeLightningTopUp(quoteId, mintUrl)),
    [run],
  );

  const quotePaymentCb = useCallback(
    (invoice: string, mintUrl?: string) => run(() => quoteLightningPayment(invoice, mintUrl)),
    [run],
  );

  const payQuotedInvoiceCb = useCallback(
    (quote: Parameters<typeof payLightningQuote>[0], mintUrl?: string) => run(() => payLightningQuote(quote, mintUrl)),
    [run],
  );

  const balanceSats = useMemo(() => sumProofs(stored.proofs), [stored.proofs]);

  return {
    mintUrl: stored.mintUrl,
    proofs: stored.proofs,
    balanceSats,
    totalBalanceSats,
    mints,
    transactions,
    isLoading,
    error,
    setMintUrl,
    addMint: setMintUrl,
    removeMint,
    receiveToken: receiveTokenCb,
    sendSats: sendSatsCb,
    refreshProofs,
    createTopUp: createTopUpCb,
    completeTopUp: completeTopUpCb,
    quotePayment: quotePaymentCb,
    payQuotedInvoice: payQuotedInvoiceCb,
    clearHistory: useCallback(() => {
      clearTransactions();
      setTransactions([]);
    }, []),
  };
}
