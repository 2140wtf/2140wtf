// src/pets/core/hooks/usePetsWallet.ts
//
// Wallet selector for the NOSTR PETS economy.
//
// - "cashu" mode wires Pets to the user's main Cashu wallet (NIP-60). Shop
//   purchases and top-ups move real Bitcoin sats as ecash.
// - "bao" mode keeps the BAO signet/demo wallet for free faucet claims and
//   BAO signet play. No real money is involved.
//
// The choice is persisted per-user in localStorage (keyed by pubkey) and
// defaults to cashu mode. Per-user scoping matters: a shared browser must
// never let account B inherit account A's rail, because the rail decides
// whether shop purchases move real sats or valueless demo sats.

import { useCallback, useEffect, useMemo, useState } from 'react';

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

const STORAGE_KEY_PREFIX = 'pets:walletMode';

function storageKeyFor(pubkey: string | undefined): string {
  return pubkey ? `${STORAGE_KEY_PREFIX}:${pubkey}` : STORAGE_KEY_PREFIX;
}

/**
 * Load the stored wallet mode for a specific user. The key is scoped by
 * pubkey so that switching accounts on a shared browser never leaks the
 * previous account's rail choice (a real-sats vs demo-sats confusion risk).
 * A legacy unscoped value is migrated into the scoped key on first read.
 */
export function loadStoredPetsWalletMode(pubkey: string | undefined): PetsWalletMode | null {
  try {
    const scoped = localStorage.getItem(storageKeyFor(pubkey));
    const legacy = pubkey ? localStorage.getItem(STORAGE_KEY_PREFIX) : null;
    const raw = scoped ?? legacy;
    let mode: PetsWalletMode | null = null;
    if (raw === 'bao' || raw === 'testnet') mode = 'bao';
    // Legacy 'real'/'bitcoin' or 'cashu'.
    else if (raw === 'real' || raw === 'bitcoin' || raw === 'cashu') mode = 'cashu';
    // Migrate the legacy unscoped value into the scoped key, then drop it so
    // the next account on this browser cannot inherit it.
    if (mode && pubkey && !scoped && legacy) {
      localStorage.setItem(storageKeyFor(pubkey), mode);
      localStorage.removeItem(STORAGE_KEY_PREFIX);
    }
    return mode;
  } catch {
    // localStorage may be unavailable in private mode / SSR.
    return null;
  }
}

function saveStoredMode(pubkey: string | undefined, mode: PetsWalletMode): void {
  try {
    localStorage.setItem(storageKeyFor(pubkey), mode);
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
  const [mode, setModeState] = useState<PetsWalletMode>(
    () => loadStoredPetsWalletMode(user?.pubkey) ?? 'cashu',
  );

  // Re-load the stored mode whenever the account changes (login/logout/switch)
  // so one user's rail choice never leaks into another user's session.
  useEffect(() => {
    setModeState(loadStoredPetsWalletMode(user?.pubkey) ?? 'cashu');
  }, [user?.pubkey]);

  const setMode = useCallback(
    (next: PetsWalletMode) => {
      saveStoredMode(user?.pubkey, next);
      setModeState(next);
    },
    [user?.pubkey],
  );

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
