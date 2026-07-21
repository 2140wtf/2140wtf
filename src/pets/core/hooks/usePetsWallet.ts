// src/pets/core/hooks/usePetsWallet.ts
//
// Wallet selector for the NOSTR PETS economy.
//
// - "cashu" mode wires Pets to the user's main Cashu wallet (NIP-60). Shop
//   purchases and top-ups move real Bitcoin sats as ecash.
// - "bao" mode keeps the BAO signet/demo wallet for free faucet claims and
//   BAO signet play. No real money is involved.
//
// The choice is persisted per-browser in localStorage and defaults to cashu mode.

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

export type PetsWalletMode = 'cashu' | 'bao';

const STORAGE_KEY = 'pets:walletMode';

function loadStoredMode(): PetsWalletMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'bao' || raw === 'testnet') return 'bao';
    // Legacy 'real'/'bitcoin' or any unknown value defaults to cashu.
    if (raw === 'real' || raw === 'bitcoin' || raw === 'cashu') return 'cashu';
  } catch {
    // localStorage may be unavailable in private mode / SSR.
  }
  return 'cashu';
}

function saveStoredMode(mode: PetsWalletMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export interface UsePetsWalletResult {
  /** Currently active wallet (real Cashu sats or BAO signet demo). */
  wallet: (CashuWalletState & CashuWalletActions) | null;
  /** The main Cashu wallet, regardless of active mode. */
  realWallet: (CashuWalletState & CashuWalletActions) | null;
  /** The BAO signet/demo wallet, regardless of active mode. */
  baoWallet: (CashuWalletState & CashuWalletActions) | null;
  /** Current mode. */
  mode: PetsWalletMode;
  /** Switch between cashu (real sats) and bao (signet demo) mode. */
  setMode: (mode: PetsWalletMode) => void;
  /** True when the active wallet is the main Cashu wallet (real sats). */
  isCashu: boolean;
  /** True when the active wallet is the BAO signet/demo wallet. */
  isBao: boolean;
}

/**
 * Returns the wallets that power the Pets economy.
 *
 * Cashu mode uses the same NIP-60 Cashu wallet as the Wallet tab, so users
 * can top it up from there. BAO mode uses the isolated BAO signet wallet
 * and keeps the BAO faucet available.
 *
 * Both wallets are kept available so the Shop can show balances for each rail
 * even when the user is not actively using that mode.
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

  // BAO signet/demo wallet. Auto-claim is only enabled in bao mode so that
  // simply opening Pets in cashu mode does not pull BAO demo sats. The wallet
  // itself stays enabled so the Shop can display the BAO balance at all times.
  const baoWallet = useBaoCashuWallet(
    seedPhrase ?? '',
    walletUser ?? fallbackUser,
    relayUrls,
    { enableAutoClaim: mode === 'bao', enabled: true },
  );

  const activeWallet = mode === 'bao' ? baoWallet : realWallet;

  // If the Cashu seed is not available, surface a null wallet so callers can
  // show a clear "wallet unavailable" state instead of a broken wallet object.
  const safeActiveWallet = seedAvailable && user ? activeWallet : null;
  const safeRealWallet = seedAvailable && user ? realWallet : null;
  const safeBaoWallet = seedAvailable && user ? baoWallet : null;

  return useMemo(
    () => ({
      wallet: safeActiveWallet,
      realWallet: safeRealWallet,
      baoWallet: safeBaoWallet,
      mode,
      setMode,
      isCashu: mode === 'cashu',
      isBao: mode === 'bao',
    }),
    [safeActiveWallet, safeRealWallet, safeBaoWallet, mode, setMode],
  );
}
