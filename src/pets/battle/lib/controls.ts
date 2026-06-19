import { useEffect, useRef } from 'react';
import { KEYBOARD_CONTROLS } from './constants';
import type { BattleInputState, PlayerInput } from '../types/battle.types';

const DEFAULT_PLAYER_INPUT: PlayerInput = {
  left: false,
  right: false,
  jump: false,
  block: false,
  sword: false,
  fireball: false,
};

const DEFAULT_INPUT: BattleInputState = {
  p1: { ...DEFAULT_PLAYER_INPUT },
  p2: { ...DEFAULT_PLAYER_INPUT },
};

const P1_LEFT = KEYBOARD_CONTROLS.p1.left as readonly string[];
const P1_RIGHT = KEYBOARD_CONTROLS.p1.right as readonly string[];
const P1_JUMP = KEYBOARD_CONTROLS.p1.jump as readonly string[];
const P1_BLOCK = KEYBOARD_CONTROLS.p1.block as readonly string[];
const P1_SWORD = KEYBOARD_CONTROLS.p1.sword as readonly string[];
const P1_FIREBALL = KEYBOARD_CONTROLS.p1.fireball as readonly string[];
const P2_LEFT = KEYBOARD_CONTROLS.p2.left as readonly string[];
const P2_RIGHT = KEYBOARD_CONTROLS.p2.right as readonly string[];
const P2_JUMP = KEYBOARD_CONTROLS.p2.jump as readonly string[];
const P2_BLOCK = KEYBOARD_CONTROLS.p2.block as readonly string[];
const P2_SWORD = KEYBOARD_CONTROLS.p2.sword as readonly string[];
const P2_FIREBALL = KEYBOARD_CONTROLS.p2.fireball as readonly string[];

const ALL_GAME_KEYS = new Set<string>([
  ...P1_LEFT,
  ...P1_RIGHT,
  ...P1_JUMP,
  ...P1_BLOCK,
  ...P1_SWORD,
  ...P1_FIREBALL,
  ...P2_LEFT,
  ...P2_RIGHT,
  ...P2_JUMP,
  ...P2_BLOCK,
  ...P2_SWORD,
  ...P2_FIREBALL,
]);

function isGameKey(key: string): boolean {
  return ALL_GAME_KEYS.has(key);
}

function updateInputFromKey(
  input: BattleInputState,
  key: string,
  pressed: boolean,
): void {
  if (P1_LEFT.includes(key)) input.p1.left = pressed;
  if (P1_RIGHT.includes(key)) input.p1.right = pressed;
  if (P1_JUMP.includes(key)) input.p1.jump = pressed;
  if (P1_BLOCK.includes(key)) input.p1.block = pressed;
  if (P2_LEFT.includes(key)) input.p2.left = pressed;
  if (P2_RIGHT.includes(key)) input.p2.right = pressed;
  if (P2_JUMP.includes(key)) input.p2.jump = pressed;
  if (P2_BLOCK.includes(key)) input.p2.block = pressed;

  // Attack actions are one-shot triggers set on keydown only.
  // They are reset by the game loop after consumption, so keyup is ignored
  // to prevent missed inputs between frames.
  if (pressed) {
    if (P1_SWORD.includes(key)) input.p1.sword = true;
    if (P1_FIREBALL.includes(key)) input.p1.fireball = true;
    if (P2_SWORD.includes(key)) input.p2.sword = true;
    if (P2_FIREBALL.includes(key)) input.p2.fireball = true;
  }
}

/**
 * Hook that tracks keyboard input for the battle game.
 *
 * Returns a ref that always holds the current input state. The ref is mutated
 * in place so the game loop can read it without forcing re-renders.
 * Attack buttons are one-shot triggers: they are set true on keydown and
 * should be consumed by the game loop each frame.
 */
export function useBattleControls(enabled: boolean) {
  const inputRef = useRef<BattleInputState>(DEFAULT_INPUT);

  useEffect(() => {
    if (!enabled) {
      inputRef.current = {
        p1: { ...DEFAULT_PLAYER_INPUT },
        p2: { ...DEFAULT_PLAYER_INPUT },
      };
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isGameKey(event.key)) {
        event.preventDefault();
        updateInputFromKey(inputRef.current, event.key, true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isGameKey(event.key)) {
        event.preventDefault();
        updateInputFromKey(inputRef.current, event.key, false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [enabled]);

  return inputRef;
}

export function consumeAttackTriggers(input: BattleInputState): void {
  input.p1.sword = false;
  input.p1.fireball = false;
  input.p2.sword = false;
  input.p2.fireball = false;
}
