import { useContext } from 'react';

import { PollsViewContext } from '@/lib/pollsViewContext';
import type { PollsView } from '@/lib/pollsViewContext';

export function usePollsView(): PollsView {
  return useContext(PollsViewContext);
}
