import React, { createContext, useContext } from 'react';
import { useAuth } from '../auth/useAuth';
import { resolveMemberIdentity } from './memberIdentity';
import { getGuestPubkeyHex } from '../relay/guestIdentity';
import { useProtocolChat, type UseProtocolChatReturn, type ChatItem } from './useProtocolChat';

// selfAuthor is part of UseProtocolChatReturn - no extra wiring needed here.

const ChatCtx = createContext<UseProtocolChatReturn | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { pubkey, seedIdentityHex } = useAuth();
  // Durable, pseudonymous per-room member identity. Key-control only: agent
  // accounts get exactly the same treatment as human-operated ones, and no
  // room can require a personhood attestation (see docs/CHAT-MEMBER-IDENTITY.md).
  const resolveIdentity = React.useCallback(
    async (roomId: string) => {
      // Signed-out visitors are first-class readers of the open rooms: the
      // relay welcomer requires a member claim even on `policy: open` rooms,
      // so fall back to the per-browser guest key as the login identity.
      // resolveMemberIdentity then mints the random per-room member key that
      // signs the admission claim (same path passkey/NIP-07 logins use).
      const loginPubkey = pubkey ?? getGuestPubkeyHex();
      if (!loginPubkey) return null;
      return resolveMemberIdentity({ roomId, loginPubkey, seedHex: seedIdentityHex() });
    },
    [pubkey, seedIdentityHex],
  );
  const chat = useProtocolChat({ resolveMemberIdentity: resolveIdentity });
  return <ChatCtx.Provider value={chat}>{children}</ChatCtx.Provider>;
}

export function useChatContext(): UseProtocolChatReturn {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error('useChatContext must be used inside ChatProvider');
  return ctx;
}

export type { ChatItem };
