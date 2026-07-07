// src/pets/core/hooks/usePetsWallet.ts
//
// Wallet selector for the NOSTR PETS economy.
//
// - "real" mode wires Pets to the user's main Cashu wallet (NIP-60/NWC). Shop
//   purchases and top-ups move real sats.
// - "testnet" mode keeps the legacy BAO signet/demo wallet for free faucet
//   claims and BAO testnet play.
//
// The choice is persisted per-browser in localStorage and defaults to real mode
// so new users land on real money/real Bitcoin immediately.

import { useCallback, useMemo, useState } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { useCashuWallet, type CashuWalletActions, type CashuWalletState } from '@/hooks/useCashuWallet';
import { useBaoCashuWallet } from '@/hooks/useBaoCashuWallet';
import { useNip60Sync } from '@/hooks/useNip60Sync';
import {
  syncCashuState,
  restoreCashuState as fetchCashuBackup,
  type CashuBackupPayload,
} from '@/lib/cashu/cashuBackup';
import type { NUser } from '@nostrify/react/login';

export type PetsWalletMode = 'real' | 'testnet' | 'bitcoin';

const STORAGE_KEY = 'pets:walletMode';

function loadStoredMode(): PetsWalletMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'testnet' || raw === 'bitcoin') return raw;
  } catch {
    // localStorage may be unavailable in private mode / SSR.
  }
  return 'real';
}

function saveStoredMode(mode: PetsWalletMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export interface UsePetsWalletResult {
  /** Currently active wallet (real Cashu or BAO demo). */
  wallet: (CashuWalletState & CashuWalletActions) | null;
  /** Current mode. */
  mode: PetsWalletMode;
  /** Switch between real, bitcoin and testnet mode. */
  setMode: (mode: PetsWalletMode) => void;
  /** True when the active wallet is the main real Cashu wallet. */
  isReal: boolean;
  /** True when the active wallet is the main Cashu wallet in Bitcoin-sats mode. */
  isBitcoin: boolean;
  /** True when the active wallet is the BAO signet/demo wallet. */
  isTestnet: boolean;
}

/**
 * Returns the wallet that should power the Pets economy.
 *
 * Real mode uses the same NIP-60/NWC Cashu wallet as the Wallet tab, so users
 * can top it up from there. Testnet mode uses the isolated BAO signet wallet
 * and keeps the BAO faucet available.
 */
export function usePetsWallet(): UsePetsWalletResult {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { seedPhrase, available: seedAvailable } = useCashuSeed();
  const nip60Sync = useNip60Sync();
  const [mode, setModeState] = useState<PetsWalletMode>(loadStoredMode);

  const setMode = useCallback((next: PetsWalletMode) => {
    saveStoredMode(next);
    setModeState(next);
  }, []);

  const relayUrls = useMemo(
    () =>
      (config.relayMetadata?.relays ?? [])
        .filter((r) => r.read !== false || r.write !== false)
        .map((r) => r.url)
        .filter((url): url is string => typeof url === 'string' && url.length > 0),
    [config.relayMetadata?.relays],
  );

  const walletUser: NUser | null = useMemo(() => {
    if (!user?.pubkey || !user?.signer) return null;
    return user;
  }, [user]);

  const fallbackUser = useMemo(
    () => ({ pubkey: '', signer: undefined } as unknown as NUser),
    [],
  );

  // Real Cashu wallet: same backup/restore logic as the Wallet tab.
  const backupCashuState = useCallback(
    async (payload: CashuBackupPayload): Promise<string | null> => {
      if (!walletUser) return null;
      return syncCashuState(payload, walletUser, relayUrls);
    },
    [relayUrls, walletUser],
  );

  const restoreCashuState = useCallback(
    async (): Promise<CashuBackupPayload | null> => {
      if (!walletUser) return null;
      return fetchCashuBackup(walletUser, relayUrls);
    },
    [relayUrls, walletUser],
  );

  const realWallet = useCashuWallet(seedPhrase, {
    backupCashuState,
    restoreCashuState,
    nip60Sync,
  });

  // BAO testnet wallet. Auto-claim is only enabled in testnet mode so that
  // simply opening Pets in real mode does not pull BAO demo sats.
  const baoWallet = useBaoCashuWallet(
    seedPhrase ?? '',
    walletUser ?? fallbackUser,
    relayUrls,
    { enableAutoClaim: mode === 'testnet', enabled: mode === 'testnet' },
  );

  const wallet = mode === 'testnet' ? baoWallet : realWallet;

  // If the Cashu seed is not available, surface a null wallet so callers can
  // show a clear "wallet unavailable" state instead of a broken wallet object.
  const safeWallet = seedAvailable && user ? wallet : null;

  return useMemo(
    () => ({
      wallet: safeWallet,
      mode,
      setMode,
      isReal: mode === 'real',
      isBitcoin: mode === 'bitcoin',
      isTestnet: mode === 'testnet',
    }),
    [safeWallet, mode, setMode],
  );
}
