import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';

import { useNostrLogin } from '@nostrify/react/login';
import { useAppContext } from '@/hooks/useAppContext';
import {
  bitcoinWalletNodeFromNsec,
  DEFAULT_GAP_LIMIT,
  deriveChangeAddress,
  deriveReceiveAddress,
  fetchLegacyUtxos,
  legacyAddressFromNsec,
  scanHdWallet,
  aggregateUtxos,
  type HdWalletScan,
  type HdUtxo,
} from '@/lib/hdWallet';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

/**
 * Hook that exposes the HD wallet for nsec logins.
 *
 * For other login types (extension, bunker) the hook returns `isHd: false` and
 * the legacy single-address path should be used instead.
 *
 * The scan discovers used receive/change addresses up to the BIP-44 gap limit
 * and fetches UTXOs for every used address. Balances and sends can then use
 * the full UTXO set without reusing addresses.
 */
export function useHdWallet() {
  const { logins } = useNostrLogin();
  const { config } = useAppContext();
  const { esploraApis } = config;

  const nsecLogin = logins[0]?.type === 'nsec' ? logins[0] : undefined;

  const accountNode = useMemo(() => {
    if (!nsecLogin) return null;
    try {
      const decoded = nip19.decode(nsecLogin.data.nsec);
      if (decoded.type !== 'nsec') return null;
      return bitcoinWalletNodeFromNsec(decoded.data);
    } catch {
      return null;
    }
  }, [nsecLogin]);

  const legacyAddress = useMemo(() => {
    if (!nsecLogin) return '';
    try {
      const decoded = nip19.decode(nsecLogin.data.nsec);
      if (decoded.type !== 'nsec') return '';
      return legacyAddressFromNsec(decoded.data);
    } catch {
      return '';
    }
  }, [nsecLogin]);

  const legacyPubkeyHex = useMemo(() => {
    if (!nsecLogin) return '';
    try {
      const decoded = nip19.decode(nsecLogin.data.nsec);
      if (decoded.type !== 'nsec') return '';
      return hex.encode(btc.utils.pubSchnorr(decoded.data));
    } catch {
      return '';
    }
  }, [nsecLogin]);

  const scanQuery = useQuery<HdWalletScan, Error>({
    queryKey: ['hd-wallet-scan', esploraApis, nsecLogin?.pubkey],
    queryFn: async ({ signal }) => {
      if (!accountNode) throw new Error('No HD wallet available.');
      return scanHdWallet(accountNode, esploraApis, DEFAULT_GAP_LIMIT, signal);
    },
    enabled: !!accountNode,
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const legacyUtxosQuery = useQuery<HdUtxo[], Error>({
    queryKey: ['bitcoin-utxos', 'legacy', esploraApis, legacyAddress],
    queryFn: async ({ signal }) => {
      if (!legacyAddress || !legacyPubkeyHex) throw new Error('No legacy address available.');
      return fetchLegacyUtxos(legacyAddress, legacyPubkeyHex, esploraApis, signal);
    },
    enabled: !!legacyAddress,
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const hdUtxos = useMemo(() => scanQuery.data?.utxos ?? [], [scanQuery.data?.utxos]);
  const legacyUtxos = useMemo(() => legacyUtxosQuery.data ?? [], [legacyUtxosQuery.data]);

  const utxos = useMemo(
    () => aggregateUtxos(hdUtxos, legacyUtxos),
    [hdUtxos, legacyUtxos],
  );

  const receiveAddress = useMemo(() => {
    if (!accountNode || scanQuery.data === undefined) return '';
    return deriveReceiveAddress(accountNode, scanQuery.data.nextReceiveIndex).address;
  }, [accountNode, scanQuery.data]);

  const changeAddress = useMemo(() => {
    if (!accountNode || scanQuery.data === undefined) return null;
    return deriveChangeAddress(accountNode, scanQuery.data.nextChangeIndex);
  }, [accountNode, scanQuery.data]);

  return {
    /** True when the current login is an nsec and we have an HD account node. */
    isHd: !!accountNode,
    /** The HD account node (m/86'/0'/0'), when available. */
    accountNode,
    /** Full scan result: used addresses and UTXOs. */
    scan: scanQuery.data,
    /** All spendable UTXOs across used HD addresses plus any legacy address UTXOs. */
    utxos,
    /** UTXOs from the HD wallet scan only. */
    hdUtxos,
    /** UTXOs from the legacy single-address only. */
    legacyUtxos,
    /** Next unused receive address to show in the wallet. */
    receiveAddress,
    /** Next unused change address for building transactions. */
    changeAddress,
    /** Whether the initial scan is in progress. */
    isLoading: scanQuery.isLoading || legacyUtxosQuery.isLoading,
    /** Error from the scan query, if any. */
    error: scanQuery.error ?? legacyUtxosQuery.error,
    /** Manually trigger a wallet rescan. */
    refetch: () => {
      scanQuery.refetch();
      legacyUtxosQuery.refetch();
    },
  };
}
