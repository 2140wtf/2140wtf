import { useContext } from 'react';

import { DmInboxContext } from '@/contexts/DmInboxContext';

export function useDmInbox() {
  return useContext(DmInboxContext);
}
