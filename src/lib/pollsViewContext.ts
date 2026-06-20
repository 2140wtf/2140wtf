import { createContext } from 'react';

export type PollsView = 'list' | 'cubes';

export const PollsViewContext = createContext<PollsView>('list');
