import { useCallback, useEffect, useRef, useState } from 'react';

import { useBattleControls, consumeAttackTriggers } from '../lib/controls';
import {
  createInitialState,
  createSetupState,
  stepBattleState,
} from '../lib/physics';
import { DEFAULT_ROUND_DURATION_SECONDS } from '../lib/constants';
import { createPlaceholderCompanion } from '../lib/rival';
import type {
  BattleInputState,
  BattleMatchOptions,
  BattlePlayerIndex,
  BattleState,
} from '../types/battle.types';
import type { PetsCompanion } from '@/pets/core/lib/pets';

export interface UseBattleGameReturn {
  state: BattleState;
  inputRef: React.MutableRefObject<BattleInputState>;
  startMatch: (pet1: PetsCompanion, pet2: PetsCompanion) => void;
  resetMatch: (pet1: PetsCompanion, pet2: PetsCompanion) => void;
  onFinishRef: React.MutableRefObject<
    ((winner: BattlePlayerIndex | null) => void) | null
  >;
}

export function useBattleGame(
  options: BattleMatchOptions = {
    prizeAmount: 0,
    roundDurationSeconds: DEFAULT_ROUND_DURATION_SECONDS,
  },
): UseBattleGameReturn {
  const placeholder = createPlaceholderCompanion();
  const [displayState, setDisplayState] = useState<BattleState>(() =>
    createSetupState(
      placeholder,
      placeholder,
      options.roundDurationSeconds,
    ),
  );
  const stateRef = useRef<BattleState>(displayState);
  const isActive = displayState.status === 'countdown' || displayState.status === 'fighting';
  const inputRef = useBattleControls(isActive);
  const rafRef = useRef(0);
  const onFinishRef = useRef<((winner: BattlePlayerIndex | null) => void) | null>(
    null,
  );
  const matchStartedRef = useRef(false);

  const setState = useCallback(
    (next: BattleState) => {
      stateRef.current = next;
      setDisplayState(next);
    },
    [],
  );

  const startMatch = useCallback(
    (pet1: PetsCompanion, pet2: PetsCompanion) => {
      const now = performance.now();
      matchStartedRef.current = true;
      setState(
        createInitialState(
          pet1,
          pet2,
          now,
          options.roundDurationSeconds,
        ),
      );
    },
    [options.roundDurationSeconds, setState],
  );

  const resetMatch = useCallback(
    (pet1: PetsCompanion, pet2: PetsCompanion) => {
      matchStartedRef.current = false;
      setState(
        createSetupState(
          pet1,
          pet2,
          options.roundDurationSeconds,
        ),
      );
    },
    [options.roundDurationSeconds, setState],
  );

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  useEffect(() => {
    if (!matchStartedRef.current) return;
    if (
      stateRef.current.status !== 'countdown' &&
      stateRef.current.status !== 'fighting'
    ) {
      return;
    }

    const step = (now: number) => {
      if (stateRef.current.status === 'finished') return;

      const input = inputRef.current;
      const next = stepBattleState(stateRef.current, input, now);
      consumeAttackTriggers(input);
      setState(next);

      if (next.status === 'finished') {
        onFinishRef.current?.(next.winner);
      } else {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return stopLoop;
  }, [displayState.status, inputRef, setState, stopLoop]);

  return {
    state: displayState,
    inputRef,
    startMatch,
    resetMatch,
    onFinishRef,
  };
}
