import { createContext } from 'react';

import { useNip17Inbox, type Nip17Conversation } from '@/hooks/useNip17Inbox';
import { useDmReadCursorsSync } from '@/hooks/useDmReadCursorsSync';

interface DmInboxContextValue {
  conversations: Nip17Conversation[];
  isLoading: boolean;
}

const DmInboxContext = createContext<DmInboxContextValue>({
  conversations: [],
  isLoading: false,
});

/**
 * Provides a single shared NIP-17 DM inbox subscription for the whole app.
 *
 * Without this provider, every component that needs the inbox would open its
 * own `kinds: [1059]` REQ, multiplying relay traffic. Wrapping the app allows
 * all consumers to read the same live state.
 */
export function DmInboxProvider({ children }: { children: React.ReactNode }) {
  const { conversations, isLoading } = useNip17Inbox();
  useDmReadCursorsSync();

  return (
    <DmInboxContext.Provider value={{ conversations, isLoading }}>
      {children}
    </DmInboxContext.Provider>
  );
}

export { DmInboxContext };
