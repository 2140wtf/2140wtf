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
import { validateEscrowDeposit } from '../lib/cashuEscrow';
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
    (token: string, _playerIndex: 0 | 1, amount: number) => {
      const escrowPubkey = config.petsBattleEscrowPubkey;
      if (!escrowPubkey) return 'Battle escrow is not configured.';
      // The escrow operator rejects mixed-mint releases, so the counterparty's
      // deposit must come from a mint this wallet also uses.
      const result = validateEscrowDeposit(token, amount, escrowPubkey, allMints.map((m) => m.url));
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


