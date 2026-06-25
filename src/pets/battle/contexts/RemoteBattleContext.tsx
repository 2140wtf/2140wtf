import { createContext, useCallback, useContext, useMemo } from 'react';

import { DmInboxContext } from '@/contexts/DmInboxContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
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
import type { PetsCompanion } from '@/pets/core/lib/pets';

export interface RemoteBattleContextValue extends UseRemoteBattleReturn {
  /** Incoming battle invite waiting for the user's response. */
  pendingInvite: BattleInvitePayload | null;
  /** True while the DM inbox is still loading. */
  isLoadingInbox: boolean;
  /** Accept the pending invite with the chosen local pet. */
  acceptPendingInvite: (localPet: PetsCompanion) => Promise<void>;
  /** Decline the pending invite. */
  declinePendingInvite: () => Promise<void>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const RemoteBattleContext = createContext<RemoteBattleContextValue | null>(null);

export function RemoteBattleProvider({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  const { conversations, isLoading: isLoadingInbox } = useContext(DmInboxContext);
  const {
    acceptInvite,
    declineInvite,
    ...remote
  } = useRemoteBattleState();

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
    async (localPet: PetsCompanion) => {
      if (!pendingInvite) return;
      await acceptInvite(pendingInvite, localPet);
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


