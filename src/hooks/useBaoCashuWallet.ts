import { useCallback, useMemo } from 'react';

import type { NostrSigner } from '@nostrify/types';
import { useAppContext } from '@/hooks/useAppContext';
import { useBaoCashuSeed } from '@/hooks/useBaoCashuSeed';
import { useCashuWallet } from '@/hooks/useCashuWallet';
import { useNip60Sync } from '@/hooks/useNip60Sync';
import { deriveBaoWalletKey } from '@/lib/cashu/cashu';
import { syncCashuState, restoreCashuState as fetchCashuBackup } from '@/lib/cashu/cashuBackup';
import type { CashuBackupPayload } from '@/lib/cashu/cashuBackup';

/** DPCS d-tag used for the BAO demo Cashu wallet fallback backup. */
export const BAO_BACKUP_D_TAG = 'freedomid:cashu:bao';

export interface BaoCashuWalletUser {
  pubkey: string;
  signer: NostrSigner;
}

/**
 * Hook for the BAO signet/demo Cashu wallet.
 *
 * The wallet is derived deterministically from the user's main Cashu seed,
 * uses the configurable BAO signet mint, and publishes its own NIP-60 token
 * events signed by a dedicated BAO wallet key.
 */
export function useBaoCashuWallet(
  userSeedPhrase: string,
  user: BaoCashuWalletUser,
  relayUrls: string[],
) {
  const { config } = useAppContext();
  const nip60Sync = useNip60Sync();
  const { seedPhrase: baoSeedPhrase } = useBaoCashuSeed(userSeedPhrase);

  const defaultMints = useMemo(() => {
    const url = config.baoSignetMintUrl?.trim();
    if (!url) return [];
    return [{ name: 'BAO Signet Mint', url }];
  }, [config.baoSignetMintUrl]);

  const backupCashuState = useCallback(
    async (payload: CashuBackupPayload): Promise<string | null> => {
      return syncCashuState(payload, user, relayUrls, BAO_BACKUP_D_TAG);
    },
    [user, relayUrls],
  );

  const restoreCashuState = useCallback(
    async (): Promise<CashuBackupPayload | null> => {
      return fetchCashuBackup(user, relayUrls, BAO_BACKUP_D_TAG);
    },
    [user, relayUrls],
  );

  return useCashuWallet(baoSeedPhrase, {
    backupCashuState,
    restoreCashuState,
    nip60Sync,
    defaultMints,
    deriveWalletKey: deriveBaoWalletKey,
    walletLabel: 'BAO Demo',
    publishWalletConfig: false,
  });
}
