import { useCallback, useEffect, useRef, useState } from 'react';

import { useBattleControls, consumeAttackTriggers } from '../lib/controls';
import { computeAiInput } from '../lib/ai';
import {
  createInitialState,
  createSetupState,
  stepBattleState,
} from '../lib/physics';
import { createBattleSnapshot, applyBattleSnapshot } from '../lib/battleSync';
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
  /** Apply an authoritative host snapshot (guest remote mode only). */
  applyHostSnapshot: (snapshot: import('../lib/battleMessages').RemoteBattleStateSnapshot) => void;
}

export function useBattleGame(
  options: BattleMatchOptions = {
    prizeAmount: 0,
    roundDurationSeconds: DEFAULT_ROUND_DURATION_SECONDS,
    isAiOpponent: false,
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
  const finishHandledRef = useRef(false);
  const matchStartedRef = useRef(false);
  const petsRef = useRef<{ pet1: PetsCompanion; pet2: PetsCompanion } | null>(null);

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
      finishHandledRef.current = false;
      petsRef.current = { pet1, pet2 };
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
      finishHandledRef.current = false;
      petsRef.current = { pet1, pet2 };
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

  const applyHostSnapshot = useCallback(
    (snapshot: import('../lib/battleMessages').RemoteBattleStateSnapshot) => {
      const pets = petsRef.current;
      if (!pets) return;
      const next = applyBattleSnapshot(
        snapshot,
        pets.pet1,
        pets.pet2,
        options.roundDurationSeconds,
        performance.now(),
      );
      setState(next);

      if (next.status === 'finished' && !finishHandledRef.current) {
        finishHandledRef.current = true;
        onFinishRef.current?.(next.winner);
      }
    },
    [options.roundDurationSeconds, setState],
  );

  useEffect(() => {
    if (!matchStartedRef.current) return;
    if (
      stateRef.current.status !== 'countdown' &&
      stateRef.current.status !== 'fighting'
    ) {
      return;
    }

    const { remoteMode, onHostSnapshot, onGuestInput, remoteP2InputRef } = options;

    if (remoteMode === 'guest') {
      // Guest: send local P2 input to the host but do not simulate physics.
      const step = () => {
        if (stateRef.current.status === 'finished') return;
        const input = inputRef.current.p2;
        onGuestInput?.(input);
        consumeAttackTriggers(inputRef.current);
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
      return stopLoop;
    }

    const step = (now: number) => {
      if (stateRef.current.status === 'finished') return;

      const input = inputRef.current;
      if (options.isAiOpponent) {
        input.p2 = computeAiInput(stateRef.current, now);
      } else if (remoteMode === 'host' && remoteP2InputRef?.current) {
        input.p2 = remoteP2InputRef.current;
      }
      const next = stepBattleState(stateRef.current, input, now);
      consumeAttackTriggers(input);
      setState(next);

      if (remoteMode === 'host') {
        onHostSnapshot?.(createBattleSnapshot(next));
      }

      if (next.status === 'finished') {
        if (!finishHandledRef.current) {
          finishHandledRef.current = true;
          onFinishRef.current?.(next.winner);
        }
      } else {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return stopLoop;
  }, [displayState.status, inputRef, options, setState, stopLoop]);

  return {
    state: displayState,
    inputRef,
    startMatch,
    resetMatch,
    onFinishRef,
    applyHostSnapshot,
  };
}
