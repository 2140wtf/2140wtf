import { useCallback, useMemo } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { useCashuWallet } from '@/hooks/useCashuWallet';
import { syncCashuState, restoreCashuState, type CashuBackupPayload } from '@/lib/cashu/cashuBackup';
import {
  derivePetCashuMnemonic,
  petCashuStorageNamespace,
  petCashuBackupDTag,
} from '@/pets/core/lib/petCashuSeed';

/**
 * Cashu wallet scoped to one 2140.wtf Pet.
 *
 * - Seed is derived deterministically from the user's main Cashu seed +
 *   the pet's canonical d-tag.
 * - localStorage uses an isolated `pets:cashu:{petD}` namespace.
 * - Encrypted backups are published with d-tag `freedomid:cashu:pet:{petD}`
 *   so each pet has its own relay backup.
 */
export function usePetsCashuWallet(petD?: string) {
  const { user } = useCurrentUser();
  const { seedPhrase: userSeedPhrase } = useCashuSeed();
  const { config } = useAppContext();

  const relayUrls = useMemo(
    () => config.relayMetadata.relays.filter((r) => r.read).map((r) => r.url),
    [config.relayMetadata.relays],
  );

  const petSeed = useMemo(() => {
    if (!userSeedPhrase || !petD) return undefined;
    return derivePetCashuMnemonic(userSeedPhrase, petD);
  }, [userSeedPhrase, petD]);

  const namespace = useMemo(() => (petD ? petCashuStorageNamespace(petD) : undefined), [petD]);
  const dTag = useMemo(() => (petD ? petCashuBackupDTag(petD) : undefined), [petD]);

  const backupCashuState = useCallback(
    async (payload: CashuBackupPayload): Promise<string | null> => {
      if (!user || !dTag) return null;
      return syncCashuState(payload, { pubkey: user.pubkey, signer: user.signer }, relayUrls, dTag);
    },
    [user, relayUrls, dTag],
  );

  const restoreCashuStateFn = useCallback(
    async (): Promise<CashuBackupPayload | null> => {
      if (!user || !dTag) return null;
      return restoreCashuState({ pubkey: user.pubkey, signer: user.signer }, relayUrls, dTag);
    },
    [user, relayUrls, dTag],
  );

  return useCashuWallet(petSeed, backupCashuState, restoreCashuStateFn, namespace);
}
