import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { NostrSigner } from '@nostrify/types';
import { nip19 } from 'nostr-tools';
import { useAppContext } from '@/hooks/useAppContext';
import { useBaoCashuSeed } from '@/hooks/useBaoCashuSeed';
import { useCashuWallet } from '@/hooks/useCashuWallet';
import { useNip60Sync } from '@/hooks/useNip60Sync';
import { useNutzapReceiver } from '@/hooks/useNutzapReceiver';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { deriveBaoWalletKey } from '@/lib/cashu/cashu';
import { claimBaoSignetFaucet, clampBaoFaucetAmount, isBaoFaucetDailyExhausted } from '@/lib/cashu/baoFaucet';
import { devLog } from '@/lib/cashu/devLog';
import { syncCashuState, restoreCashuState as fetchCashuBackup } from '@/lib/cashu/cashuBackup';
import type { CashuBackupPayload } from '@/lib/cashu/cashuBackup';
import { computeContentHash, resolveMintAlias } from '@/lib/cashu/cashuNip60';
import { BAO_MARKETS_RELAY } from '@/lib/baoRelayMarkets';
import {
  checkBaoCashuClaimStatus,
  claimBaoCashu,
  clearPendingBaoCashuTokens,
  fetchPendingBaoCashuTokens,
  type BaoCashuClaimResult,
} from '@/lib/baoWalletApi';

/** DPCS d-tag used for the BAO demo Cashu wallet fallback backup. */
export const BAO_BACKUP_D_TAG = 'freedomid:cashu:bao';
const BAO_NUTZAP_RELAYS = [BAO_MARKETS_RELAY];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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
  user: BaoCashuWalletUser | undefined,
  relayUrls: string[],
  options: UseBaoCashuWalletOptions = {},
) {
  const { enableAutoClaim = true, enabled } = options;
  const { config } = useAppContext();
  const nip60Sync = useNip60Sync();
  const { isEnabled: isPublishFeatureEnabled } = usePublishPreferences();
  const baoCashuSyncEnabled = isPublishFeatureEnabled('baoCashuSync');
  const { seedPhrase: baoSeedPhrase } = useBaoCashuSeed(userSeedPhrase);
  const userPubkey = user?.pubkey;
  const userSigner = user?.signer;
  const walletEnabled = enabled !== false && !!userPubkey && !!userSigner && !!baoSeedPhrase;

  const defaultMints = useMemo(() => {
    const url = config.baoSignetMintUrl?.trim();
    if (!url) return [];
    return [{ name: '₿AO Signet Mint', url: resolveMintAlias(url) }];
  }, [config.baoSignetMintUrl]);

  // Use a per-pubkey DPCS backup d-tag so different identities never share BAO backup state.
  const backupDTag = useMemo(() => {
    if (user?.pubkey) return `freedomid:cashu:bao:${user.pubkey}`;
    return BAO_BACKUP_D_TAG;
  }, [user?.pubkey]);

  const backupCashuState = useCallback(
    async (payload: CashuBackupPayload): Promise<string | null> => {
      if (!baoCashuSyncEnabled || !user) return null;
      return syncCashuState(payload, user, relayUrls, backupDTag);
    },
    [user, relayUrls, backupDTag, baoCashuSyncEnabled],
  );

  const restoreCashuState = useCallback(
    async (): Promise<CashuBackupPayload | null> => {
      if (!baoCashuSyncEnabled || !user) return null;
      return fetchCashuBackup(user, relayUrls, backupDTag);
    },
    [user, relayUrls, backupDTag, baoCashuSyncEnabled],
  );

  const wallet = useCashuWallet(baoSeedPhrase, {
    backupCashuState,
    restoreCashuState,
    nip60Sync,
    defaultMints,
    deriveWalletKey: deriveBaoWalletKey,
    walletLabel: '₿AO MARKETS',
    nip60SyncEnabled: baoCashuSyncEnabled,
    storageNamespace: 'freedomid_bao_',
    enabled: walletEnabled,
  });

  // Auto-claim a small daily BAO demo faucet grant. The faucet enforces its own
  // 24h rolling cap; we throttle clients locally using the same window so we do
  // not hammer the endpoint. Existing BAO tokens are fetched from relays via the
  // DPCS restore path in useCashuWallet.
  const walletRef = useRef(wallet);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);

  // Subscribe only after the Cashu wallet is ready. Otherwise a matching
  // kind:9321 can arrive during seed/mint initialization, be rejected as
  // "wallet not ready", and never be replayed by a live-only relay stream.
  useNutzapReceiver(walletEnabled && wallet.wallet ? (baoSeedPhrase ?? '') : '', wallet.allMints, wallet.receiveNutzap, {
    relayUrls: BAO_NUTZAP_RELAYS,
  });

  const collectPendingApiCashu = useCallback(async (): Promise<number> => {
    if (!userPubkey || !userSigner) throw new Error('Log in to collect BAO Cashu.');
    const pendingItems = await fetchPendingBaoCashuTokens(userSigner);
    if (pendingItems.length === 0) return 0;
    let imported = 0;
    for (const { token } of pendingItems) {
      const markerKey = `bao_cashu_collected_${userPubkey}_${computeContentHash(token)}`;
      let durable = false;
      try { durable = localStorage.getItem(markerKey) === '1'; } catch { durable = false; }
      if (!durable) {
        const amount = await walletRef.current.receiveToken(token.trim());
        if (amount <= 0) {
          throw new Error('BAO Cashu proofs could not be stored locally; the server copy was kept for retry');
        }
        imported += amount;
        try { localStorage.setItem(markerKey, '1'); } catch { /* marker is only crash recovery */ }
      }
    }
    await clearPendingBaoCashuTokens(userSigner, pendingItems.map((item) => item.id));
    for (const { token } of pendingItems) {
      try { localStorage.removeItem(`bao_cashu_collected_${userPubkey}_${computeContentHash(token)}`); } catch { /* ignore */ }
    }
    return imported;
  }, [userPubkey, userSigner]);

  const claimApiCashu = useCallback(async (amountSats: number): Promise<BaoCashuClaimResult & { imported_sats: number; already_imported?: boolean }> => {
    if (!userPubkey || !userSigner) throw new Error('Log in to claim BAO Cashu.');
    const intentKey = `bao_cashu_claim_intent_${userPubkey}`;
    let idempotencyKey = '';
    let proofsAlreadyImported = false;
    try {
      const raw = localStorage.getItem(intentKey);
      if (raw) {
        const stored = JSON.parse(raw) as { amount?: unknown; key?: unknown; proofsImported?: unknown };
        if (stored.amount === amountSats && typeof stored.key === 'string') {
          idempotencyKey = stored.key;
          proofsAlreadyImported = stored.proofsImported === true;
        }
      }
    } catch { idempotencyKey = ''; }
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      try { localStorage.setItem(intentKey, JSON.stringify({ amount: amountSats, key: idempotencyKey })); } catch { /* request remains server-idempotent */ }
    }
    let result = await claimBaoCashu(userSigner, amountSats, idempotencyKey);
    let imported = 0;
    // Match bao.markets' own client: async settlement can take up to three
    // minutes while the mint or treasury is busy. Cashu payout proofs may be
    // available before the generic claim-tracking row reaches `completed`, so
    // collect them during polling instead of making a usable payout wait on a
    // lagging database status update.
    for (let attempt = 0; result.status === 'pending' && attempt < 90; attempt += 1) {
      await wait(2_000);
      if (!proofsAlreadyImported && attempt % 5 === 0) {
        imported += await collectPendingApiCashu();
        if (imported > 0) {
          // Proof delivery can precede the custodial tracking update. Keep the
          // operation key until claim-status confirms completion so another
          // click cannot start a second claim while the first is still being
          // accounted for server-side.
          try {
            localStorage.setItem(intentKey, JSON.stringify({ amount: amountSats, key: idempotencyKey, proofsImported: true }));
          } catch { /* the imported proofs remain durable in wallet storage */ }
          return {
            ...result,
            status: 'completed',
            claimed_sats: result.claimed_sats ?? imported,
            imported_sats: imported,
          };
        }
      }
      result = await checkBaoCashuClaimStatus(userSigner, idempotencyKey);
    }
    if (result.status !== 'completed') {
      throw new Error('BAO Cashu is still being issued. Retry collection in a moment; the claim will not be duplicated.');
    }
    if (proofsAlreadyImported) {
      try { localStorage.removeItem(intentKey); } catch { /* ignore */ }
      return { ...result, imported_sats: 0, already_imported: true };
    }
    for (let attempt = 0; attempt < 12 && imported === 0; attempt += 1) {
      imported = await collectPendingApiCashu();
      if (imported === 0) await wait(1_500);
    }
    if ((result.claimed_sats ?? amountSats) > 0 && imported === 0) {
      throw new Error('The claim completed but its Cashu proofs are still being delivered. Use “Collect pending Cashu” in a moment.');
    }
    try { localStorage.removeItem(intentKey); } catch { /* ignore */ }
    return { ...result, imported_sats: imported };
  }, [collectPendingApiCashu, userPubkey, userSigner]);

  useEffect(() => {
    if (!walletEnabled || !wallet.wallet) return;
    void collectPendingApiCashu().catch((error) => {
      devLog.warn('Pending BAO Cashu collection deferred:', error);
    });
  }, [collectPendingApiCashu, walletEnabled, wallet.wallet]);
  useEffect(() => {
    if (!walletEnabled || !enableAutoClaim) return;
    const pubkey = userPubkey;
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
  }, [walletEnabled, enableAutoClaim, userPubkey, config.baoSignetFaucetUrl, baoSeedPhrase]);

  return { ...wallet, claimApiCashu, collectPendingApiCashu };
}
