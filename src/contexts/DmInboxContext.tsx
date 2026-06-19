import { createContext } from 'react';

import { useNip17Inbox, type Nip17Conversation } from '@/hooks/useNip17Inbox';
import { useDmReadCursorsSync } from '@/hooks/useDmReadCursorsSync';
import type { Nip17Message } from '@/lib/nip17';

interface DmInboxContextValue {
  conversations: Nip17Conversation[];
  isLoading: boolean;
  addMessage: (message: Nip17Message) => void;
}

const DmInboxContext = createContext<DmInboxContextValue>({
  conversations: [],
  isLoading: false,
  addMessage: () => {},
});

/**
 * Provides a single shared NIP-17 DM inbox subscription for the whole app.
 *
 * Without this provider, every component that needs the inbox would open its
 * own `kinds: [1059]` REQ, multiplying relay traffic. Wrapping the app allows
 * all consumers to read the same live state.
 */
export function DmInboxProvider({ children }: { children: React.ReactNode }) {
  const { conversations, isLoading, addMessage } = useNip17Inbox();
  useDmReadCursorsSync();

  return (
    <DmInboxContext.Provider value={{ conversations, isLoading, addMessage }}>
      {children}
    </DmInboxContext.Provider>
  );
}

export { DmInboxContext };
