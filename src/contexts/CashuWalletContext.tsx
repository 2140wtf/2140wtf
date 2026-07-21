import { createContext, useMemo, useCallback } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { useNip60Sync } from '@/hooks/useNip60Sync';
import { useNutzapReceiver } from '@/hooks/useNutzapReceiver';
import {
  useCashuWallet,
  type CashuWalletState,
  type CashuWalletActions,
} from '@/hooks/useCashuWallet';
import {
  syncCashuState,
  restoreCashuState as fetchCashuBackup,
  type CashuBackupPayload,
} from '@/lib/cashu/cashuBackup';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { useToast } from '@/hooks/useToast';
import { devLog } from '@/lib/cashu/devLog';

export interface CashuWalletContextValue extends CashuWalletState, CashuWalletActions {
  /** True while the encrypted BIP39 seed is being loaded or generated. */
  seedLoading: boolean;
  /** Error loading the seed, if any. */
  seedError: string | null;
  /** True when a seed phrase is available and the wallet can initialize. */
  seedAvailable: boolean;
  /** Retry loading/creating the seed (e.g. after signer unlock). */
  retrySeed: () => void;
  /** Wipe the stored seed and generate a new one. Destructive. */
  regenerateSeed: () => void;
  /** Fetch the NIP-60 encrypted backup payload from relays, if one exists. */
  fetchBackup: () => Promise<CashuBackupPayload | null>;
}

const CashuWalletContext = createContext<CashuWalletContextValue | null>(null);

/**
 * Global Cashu wallet provider.
 *
 * - Loads or creates the per-account encrypted BIP39 seed once per login.
 * - Initializes `useCashuWallet` once so the wallet is ready from any screen.
 * - Subscribes to incoming NIP-61 Nutzaps (kind 9321) in the background.
 * - Publishes/restores NIP-60 wallet state via the user's relays.
 *
 * Place this provider inside `NostrProvider`, `AppProvider`, and
 * `DmInboxProvider` so it can use Nostr, config, and NIP-17 DM context.
 */
export function CashuWalletProvider({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { toast } = useToast();
  const { isEnabled } = usePublishPreferences();
  const nip60Sync = useNip60Sync();

  const {
    seedPhrase,
    loading: seedLoading,
    error: seedError,
    available: seedAvailable,
    retry,
    regenerate,
  } = useCashuSeed();

  const relayUrls = useMemo(
    () =>
      (config.relayMetadata?.relays ?? [])
        .filter((r) => r.read !== false || r.write !== false)
        .map((r) => r.url)
        .filter((url): url is string => typeof url === 'string' && url.length > 0),
    [config.relayMetadata?.relays],
  );

  const backupCashuState = useCallback(
    (payload: CashuBackupPayload) => {
      if (!isEnabled('encryptedSettings')) {
        toast({
          title: 'Encrypted backups disabled',
          description:
            'Turn on “Encrypted settings” in Settings → Privacy & Publishing to back up your Cashu wallet.',
        });
        return Promise.resolve<string | null>(null);
      }
      if (!user) return Promise.resolve<string | null>(null);
      return syncCashuState(payload, user, relayUrls);
    },
    [user, relayUrls, isEnabled, toast],
  );

  const restoreCashuState = useCallback(
    () => (user ? fetchCashuBackup(user, relayUrls) : Promise.resolve(null)),
    [user, relayUrls],
  );

  const walletEnabled = !!user && !!seedPhrase && !!user.signer?.nip44;

  const wallet = useCashuWallet(seedPhrase, {
    backupCashuState,
    restoreCashuState,
    nip60Sync,
    enabled: walletEnabled,
  });

  useNutzapReceiver(seedPhrase ?? '', wallet.allMints, wallet.receiveNutzap);

  const value = useMemo<CashuWalletContextValue>(
    () => ({
      ...wallet,
      seedLoading,
      seedError,
      seedAvailable,
      retrySeed: retry,
      regenerateSeed: regenerate,
      fetchBackup: restoreCashuState,
    }),
    [wallet, seedLoading, seedError, seedAvailable, retry, regenerate, restoreCashuState],
  );

  if (user && !user.signer?.nip44) {
    // Render children without a wallet when the signer lacks NIP-44. The
    // context consumer will see seedAvailable=false and can show a helpful
    // message rather than crashing.
    devLog.warn('Current signer does not support NIP-44; Cashu wallet disabled.');
  }

  return <CashuWalletContext.Provider value={value}>{children}</CashuWalletContext.Provider>;
}

export { CashuWalletContext };


