import { useContext } from 'react';

import { GroupChatContext } from '@/lib/groupChatContext';

export function useGroupChatContext() {
  const ctx = useContext(GroupChatContext);
  if (!ctx) {
    throw new Error('useGroupChatContext must be used within a GroupChatProvider');
  }
  return ctx;
}
