import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { NostrSigner } from '@nostrify/types';
import { nip19 } from 'nostr-tools';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBaoCashuSeed } from '@/hooks/useBaoCashuSeed';
import { useCashuWallet } from '@/hooks/useCashuWallet';
import { useNip60Sync } from '@/hooks/useNip60Sync';
import { deriveBaoWalletKey } from '@/lib/cashu/cashu';
import { claimBaoSignetFaucet, clampBaoFaucetAmount, isBaoFaucetDailyExhausted } from '@/lib/cashu/baoFaucet';
import { devLog } from '@/lib/cashu/devLog';
import { syncCashuState, restoreCashuState as fetchCashuBackup } from '@/lib/cashu/cashuBackup';
import type { CashuBackupPayload } from '@/lib/cashu/cashuBackup';

/** DPCS d-tag used for the BAO demo Cashu wallet fallback backup. */
export const BAO_BACKUP_D_TAG = 'freedomid:cashu:bao';

export interface BaoCashuWalletUser {
  pubkey: string;
  signer: NostrSigner;
}

export interface UseBaoCashuWalletOptions {
  /** Whether to auto-claim the one-time BAO demo faucet grant for new seeds. Default true. */
  enableAutoClaim?: boolean;
  /** When false the BAO wallet stays idle. Defaults to true. */
  enabled?: boolean;
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
  options: UseBaoCashuWalletOptions = {},
) {
  const { enableAutoClaim = true, enabled } = options;
  const { config } = useAppContext();
  const currentUser = useCurrentUser().user;
  const nip60Sync = useNip60Sync();
  const { seedPhrase: baoSeedPhrase } = useBaoCashuSeed(userSeedPhrase);

  const defaultMints = useMemo(() => {
    const url = config.baoSignetMintUrl?.trim();
    if (!url) return [];
    return [{ name: '₿AO Signet Mint', url }];
  }, [config.baoSignetMintUrl]);

  // Use a per-pubkey DPCS backup d-tag so different identities never share BAO backup state.
  const backupDTag = useMemo(() => {
    if (user?.pubkey) return `freedomid:cashu:bao:${user.pubkey}`;
    return BAO_BACKUP_D_TAG;
  }, [user?.pubkey]);

  const backupCashuState = useCallback(
    async (payload: CashuBackupPayload): Promise<string | null> => {
      return syncCashuState(payload, user, relayUrls, backupDTag);
    },
    [user, relayUrls, backupDTag],
  );

  const restoreCashuState = useCallback(
    async (): Promise<CashuBackupPayload | null> => {
      return fetchCashuBackup(user, relayUrls, backupDTag);
    },
    [user, relayUrls, backupDTag],
  );

  const wallet = useCashuWallet(baoSeedPhrase, {
    backupCashuState,
    restoreCashuState,
    nip60Sync,
    defaultMints,
    deriveWalletKey: deriveBaoWalletKey,
    walletLabel: '₿AO MARKETS',
    publishWalletConfig: false,
    storageNamespace: 'freedomid_bao_',
    enabled,
  });

  // Auto-claim a small daily BAO demo faucet grant. The faucet enforces its own
  // 24h rolling cap; we throttle clients locally using the same window so we do
  // not hammer the endpoint. Existing BAO tokens are fetched from relays via the
  // DPCS restore path in useCashuWallet.
  const walletRef = useRef(wallet);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);
  useEffect(() => {
    if (!enabled || !enableAutoClaim) return;
    const pubkey = currentUser?.pubkey;
    const faucetUrl = config.baoSignetFaucetUrl?.trim();
    if (!pubkey || !faucetUrl || !baoSeedPhrase) return;

    const guardKey = `bao_faucet_last_claim_${pubkey}`;
    let lastClaim: { claimedAt: number; resetsAt?: number } | null = null;
    try {
      const raw = localStorage.getItem(guardKey);
      lastClaim = raw ? (JSON.parse(raw) as { claimedAt: number; resetsAt?: number }) : null;
    } catch {
      lastClaim = null;
    }

    const now = Date.now();
    const canClaim =
      !lastClaim ||
      now >=
        (lastClaim.resetsAt && lastClaim.resetsAt > 0
          ? lastClaim.resetsAt * 1000
          : lastClaim.claimedAt + 24 * 60 * 60 * 1000);
    if (!canClaim) return;

    const npub = nip19.npubEncode(pubkey);
    const amount = clampBaoFaucetAmount(2_140);
    claimBaoSignetFaucet(faucetUrl, { npub, amount })
      .then(async (res) => {
        if (isBaoFaucetDailyExhausted(res)) return;
        if (res?.token) {
          await walletRef.current.receiveToken(res.token.trim());
          try {
            localStorage.setItem(
              guardKey,
              JSON.stringify({ claimedAt: Date.now(), resetsAt: res.resetsAt }),
            );
          } catch {
            // ignore storage errors
          }
        }
      })
      .catch((e) => {
        devLog.error('BAO auto-faucet failed:', e);
      });
  }, [enabled, enableAutoClaim, currentUser?.pubkey, config.baoSignetFaucetUrl, baoSeedPhrase]);

  return wallet;
}
