import { createContext, useCallback, useContext, useMemo } from 'react';

import { DmInboxContext } from '@/contexts/DmInboxContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import {
  BATTLE_INVITE_SUBJECT,
  type BattleInvitePayload,
  type BattleMessagePayload,
} from '../lib/battleMessages';
import {
  INVITE_TIMEOUT_MS,
  useRemoteBattleState,
  type UseRemoteBattleReturn,
} from '../hooks/useRemoteBattleState';
import { validateMultisigEscrowDeposit, OPERATOR_SIGN_MIN_LOCKTIME_MARGIN_SECONDS } from '@/lib/cashu/escrowMultisig';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import type { PetsCompanion } from '@/pets/core/lib/pets';

export interface RemoteBattleContextValue extends UseRemoteBattleReturn {
  /** Incoming battle invite waiting for the user's response. */
  pendingInvite: BattleInvitePayload | null;
  /** True while the DM inbox is still loading. */
  isLoadingInbox: boolean;
  /** Accept the pending invite with the chosen local pet. */
  acceptPendingInvite: (localPet: PetsCompanion, guestEscrowPubkey?: string) => Promise<void>;
  /** Decline the pending invite. */
  declinePendingInvite: () => Promise<void>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const RemoteBattleContext = createContext<RemoteBattleContextValue | null>(null);

export function RemoteBattleProvider({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { conversations, isLoading: isLoadingInbox } = useContext(DmInboxContext);
  const { allMints } = useCashuWalletContext();

  const validateDeposit = useCallback(
    (
      token: string,
      playerIndex: 0 | 1,
      amount: number,
      expectedMint?: string,
      lockContext?: { hostEscrowPubkey?: string; guestEscrowPubkey?: string },
    ) => {
      const operatorPubkey = config.petsBattleEscrowPubkey;
      if (!operatorPubkey) return 'Battle escrow is not configured.';
      // The escrow operator rejects mixed-mint releases. When the battle
      // negotiated an agreed mint (advertised in the invite), the deposit must
      // come from EXACTLY that mint — checking against this wallet's own mint
      // list instead would both silently drop a deposit the sender was already
      // debited for (mint unknown here) and accept a mixed-mint pair the
      // operator can never release (both wallets happen to list both mints).
      // Legacy invites without an agreed mint fall back to the local list.
      const allowedMints = expectedMint ? [expectedMint] : allMints.map((m) => m.url);
      const hostKey = lockContext?.hostEscrowPubkey;
      const guestKey = lockContext?.guestEscrowPubkey;
      if (!hostKey || !guestKey) {
        return 'Battle escrow keys were not exchanged — cancel and re-invite.';
      }
      // 2-of-3 multisig escrow (₿AO escrow primitive): the deposit must lock
      // to {host, guest, operator} with n_sigs=2, the DEPOSITOR's key as sole
      // refund signer, and a locktime far enough out that the operator can
      // still co-sign (it refuses inside its sign-margin). Pre-#21 single-key
      // custodial deposits are rejected: real-sats battles ship together, so a
      // legacy deposit means the opponent's app is stale.
      const result = validateMultisigEscrowDeposit(token, {
        expectedAmount: amount,
        partyAPubkey: hostKey,
        partyBPubkey: guestKey,
        operatorPubkey,
        depositorPubkey: playerIndex === 0 ? hostKey : guestKey,
        minLocktime: Math.floor(Date.now() / 1000) + OPERATOR_SIGN_MIN_LOCKTIME_MARGIN_SECONDS,
        allowedMints,
      });
      return result.valid ? null : (result.reason ?? 'Invalid escrow deposit.');
    },
    [config.petsBattleEscrowPubkey, allMints],
  );

  const {
    acceptInvite,
    declineInvite,
    ...remote
  } = useRemoteBattleState({ validateEscrowDeposit: validateDeposit });

  const pendingInvite = useMemo<BattleInvitePayload | null>(() => {
    if (!user || remote.phase !== 'idle') return null;

    for (const conv of conversations) {
      if (conv.subject !== BATTLE_INVITE_SUBJECT) continue;
      for (const message of conv.messages) {
        if (message.sender === user.pubkey) continue;
        try {
          const payload = JSON.parse(message.content) as BattleMessagePayload;
          if (payload.type !== 'battle-invite') continue;
          // Bind the invite to the AUTHENTICATED DM sender: message.sender is
          // cryptographically verified by NIP-17 unseal, but inviterPubkey is
          // attacker-controlled JSON — without this check a throwaway key can
          // spoof a trusted contact's invite and trick the victim's client
          // into auto-locking a real-sats escrow deposit to a stranger.
          if (payload.inviterPubkey !== message.sender) continue;
          const elapsed = Date.now() - payload.sentAt;
          if (elapsed <= INVITE_TIMEOUT_MS) return payload;
        } catch {
          // Ignore malformed DM content.
        }
      }
    }

    return null;
  }, [conversations, remote.phase, user]);

  const acceptPendingInvite = useCallback(
    async (localPet: PetsCompanion, guestEscrowPubkey?: string) => {
      if (!pendingInvite) return;
      await acceptInvite(pendingInvite, localPet, guestEscrowPubkey);
    },
    [pendingInvite, acceptInvite],
  );

  const declinePendingInvite = useCallback(async () => {
    if (!pendingInvite) return;
    await declineInvite(pendingInvite);
  }, [pendingInvite, declineInvite]);

  const value = useMemo<RemoteBattleContextValue>(
    () => ({
      ...remote,
      acceptInvite,
      declineInvite,
      pendingInvite,
      isLoadingInbox,
      acceptPendingInvite,
      declinePendingInvite,
    }),
    [remote, acceptInvite, declineInvite, pendingInvite, isLoadingInbox, acceptPendingInvite, declinePendingInvite],
  );

  return (
    <RemoteBattleContext.Provider value={value}>
      {children}
    </RemoteBattleContext.Provider>
  );
}


