import { createContext } from 'react';

import type { UseGroupChatReturn } from '@/hooks/useGroupChat';

export const GroupChatContext = createContext<UseGroupChatReturn | null>(null);
