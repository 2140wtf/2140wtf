import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useHdWallet } from '@/hooks/useHdWallet';
import { nostrPubkeyToBitcoinAddress, fetchAddressData, fetchBtcPrice, fetchTransactions } from '@/lib/bitcoin';
import type { Transaction } from '@/lib/bitcoin';

/** Aggregate balance and transaction stats across multiple addresses. */
function aggregateAddressData(data: Awaited<ReturnType<typeof fetchAddressData>>[]) {
  return data.reduce(
    (acc, d) => ({
      balance: acc.balance + d.balance,
      pendingBalance: acc.pendingBalance + d.pendingBalance,
      totalBalance: acc.totalBalance + d.totalBalance,
      totalReceived: acc.totalReceived + d.totalReceived,
      totalSent: acc.totalSent + d.totalSent,
      txCount: acc.txCount + d.txCount,
      pendingTxCount: acc.pendingTxCount + d.pendingTxCount,
    }),
    {
      balance: 0,
      pendingBalance: 0,
      totalBalance: 0,
      totalReceived: 0,
      totalSent: 0,
      txCount: 0,
      pendingTxCount: 0,
    },
  );
}

/** Merge transaction lists from multiple addresses and deduplicate by txid. */
function aggregateTransactions(addresses: string[], txLists: Transaction[][]) {
  const seen = new Set<string>();
  const out: Transaction[] = [];
  for (let i = 0; i < addresses.length; i++) {
    for (const tx of txLists[i]) {
      if (seen.has(tx.txid)) continue;
      seen.add(tx.txid);
      // Recompute amount/type relative to this address so the merged list has
      // a consistent sign. The aggregate "amount" here is the net across the
      // watched address set; a tx that moves funds between two of our own
      // addresses will net to zero and is dropped from the simplified history.
      const net = tx.type === 'receive' ? tx.amount : -tx.amount;
      const existing = out.find((t) => t.txid === tx.txid);
      if (existing) {
        existing.amount += net;
        existing.type = existing.amount >= 0 ? 'receive' : 'send';
        existing.amount = Math.abs(existing.amount);
        existing.confirmed &&= tx.confirmed;
        existing.timestamp = Math.min(existing.timestamp ?? Infinity, tx.timestamp ?? Infinity);
      } else {
        out.push({
          ...tx,
          amount: Math.abs(net),
          type: net >= 0 ? 'receive' : 'send',
        });
      }
    }
  }
  return out
    .filter((t) => t.amount > 0)
    .sort((a, b) => (b.timestamp ?? Infinity) - (a.timestamp ?? Infinity));
}

/**
 * Hook that exposes the user's Bitcoin wallet.
 *
 * For nsec logins the wallet is a BIP-86 HD wallet derived from the nsec.
 * The hook scans used receive/change addresses and aggregates balances and
 * transactions across them. The displayed `bitcoinAddress` is the next unused
 * HD receive address, so users never reuse an old address.
 *
 * For extension/bunker logins the wallet falls back to the original single
 * Taproot address derived from the Nostr pubkey, because those signers do not
 * have access to the nsec bytes needed to derive the HD account node.
 *
 * Balance auto-refreshes every 30 seconds while the component is mounted.
 * BTC/USD price refreshes every 60 seconds.
 */
export function useBitcoinWallet() {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { esploraApis } = config;
  const hd = useHdWallet();

  const legacyAddress = useMemo(() => {
    if (!user) return '';
    return nostrPubkeyToBitcoinAddress(user.pubkey);
  }, [user]);

  const bitcoinAddress = hd.isHd ? hd.receiveAddress : legacyAddress;

  // Addresses to watch for balance/tx aggregation. For HD this is every used
  // address plus the current receive address (which may have pending txs) and
  // the legacy single-address (so funds that pre-date the HD wallet are still
  // visible).
  const watchedAddresses = useMemo(() => {
    if (!hd.isHd || !hd.scan) return legacyAddress ? [legacyAddress] : [];
    const addrs = new Set<string>();
    if (legacyAddress) addrs.add(legacyAddress);
    if (hd.receiveAddress) addrs.add(hd.receiveAddress);
    for (const a of hd.scan.usedReceiveAddresses) addrs.add(a.address);
    for (const a of hd.scan.usedChangeAddresses) addrs.add(a.address);
    return Array.from(addrs);
  }, [hd.isHd, hd.scan, hd.receiveAddress, legacyAddress]);

  const {
    data: addressDataList,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['bitcoin-balance', esploraApis, watchedAddresses],
    queryFn: async ({ signal }) =>
      Promise.all(watchedAddresses.map((addr) => fetchAddressData(addr, esploraApis, signal))),
    enabled: watchedAddresses.length > 0,
    refetchInterval: 30_000,
  });

  const addressData = useMemo(
    () => (addressDataList ? aggregateAddressData(addressDataList) : undefined),
    [addressDataList],
  );

  const { data: btcPrice } = useQuery({
    queryKey: ['btc-price', esploraApis],
    queryFn: ({ signal }) => fetchBtcPrice(esploraApis, signal),
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  const {
    data: txLists,
    isLoading: isLoadingTxs,
  } = useQuery({
    queryKey: ['bitcoin-txs', esploraApis, watchedAddresses],
    queryFn: async ({ signal }) =>
      Promise.all(watchedAddresses.map((addr) => fetchTransactions(addr, esploraApis, signal))),
    enabled: watchedAddresses.length > 0,
    refetchInterval: 30_000,
  });

  const transactions = useMemo(
    () => (txLists ? aggregateTransactions(watchedAddresses, txLists) : undefined),
    [txLists, watchedAddresses],
  );

  return {
    /** The Bitcoin address to display and receive to. */
    bitcoinAddress,
    /** Balance and transaction data (undefined while loading). */
    addressData,
    /** Current BTC price in USD. */
    btcPrice,
    /** Transaction history for the wallet. */
    transactions,
    /** Whether the initial balance fetch is in progress. */
    isLoading,
    /** Whether transactions are still loading. */
    isLoadingTxs,
    /** Error from the balance query, if any. */
    error,
    /** Manually trigger a balance refresh. */
    refetch,
    /** The current user's hex pubkey (convenience). */
    pubkey: user?.pubkey ?? '',
    /** HD-specific data (undefined for legacy/extension/bunker logins). */
    hd: hd.isHd
      ? {
          accountNode: hd.accountNode,
          changeAddress: hd.changeAddress,
          utxos: hd.utxos,
          hdUtxos: hd.hdUtxos,
          legacyUtxos: hd.legacyUtxos,
          scan: hd.scan,
          isLoading: hd.isLoading,
        }
      : undefined,
  };
}
