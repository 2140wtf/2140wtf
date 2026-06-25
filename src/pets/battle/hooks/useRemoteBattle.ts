import { useContext } from 'react';

import {
  RemoteBattleContext,
  type RemoteBattleContextValue,
} from '../contexts/RemoteBattleContext';

export function useRemoteBattle(): RemoteBattleContextValue {
  const ctx = useContext(RemoteBattleContext);
  if (!ctx) {
    throw new Error('useRemoteBattle must be used inside a RemoteBattleProvider');
  }
  return ctx;
}

export type { RemoteBattleContextValue as UseRemoteBattleReturn } from '../contexts/RemoteBattleContext';
