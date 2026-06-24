import { useCallback, useState } from 'react';

import { useInteractionReaction, type InteractionReactionState } from './useInteractionReaction';

export type PetsFacing = 'left' | 'right';

export interface UsePetsDirectInteractionOptions {
  /** When true, hover/click reactions are disabled (e.g. sleeping or egg). */
  disabled?: boolean;
}

export interface UsePetsDirectInteractionReturn {
  /** Current horizontal facing direction. */
  facing: PetsFacing;
  /** Whether the pointer is currently over the pet. */
  isHovered: boolean;
  /** Current ephemeral reaction state from hover or poke. */
  interactionReaction: InteractionReactionState;
  /** Toggle facing left/right. */
  turn: () => void;
  /** Trigger the happy poke reaction (hearts + wiggle). */
  triggerPoke: () => void;
  /** Trigger the curious hover reaction (lean + curious face). */
  triggerHover: () => void;
  /** Pointer handlers to attach to the interactive pet wrapper. */
  interactionProps: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onClick: () => void;
  };
}

/**
 * Manages direct hover and click interactions with a pet visual.
 *
 * - Hover triggers a short curious expression + lean.
 * - Click toggles the pet's facing direction and triggers a happy poke
 *   reaction (wiggle + hearts).
 *
 * The reaction state has the same shape as `useInteractionReaction` so it
 * can be merged into the room-stage overlay system or fed into the
 * companion's recipe priority chain.
 */
export function usePetsDirectInteraction(
  options: UsePetsDirectInteractionOptions = {},
): UsePetsDirectInteractionReturn {
  const { disabled = false } = options;
  const { state: interactionReaction, trigger } = useInteractionReaction();

  const [facing, setFacing] = useState<PetsFacing>('right');
  const [isHovered, setIsHovered] = useState(false);

  const turn = useCallback(() => {
    setFacing((prev) => (prev === 'right' ? 'left' : 'right'));
  }, []);

  const triggerPoke = useCallback(() => {
    if (disabled) return;
    trigger('poke');
  }, [disabled, trigger]);

  const triggerHover = useCallback(() => {
    if (disabled) return;
    trigger('hover');
  }, [disabled, trigger]);

  const onPointerEnter = useCallback(() => {
    if (disabled) return;
    setIsHovered(true);
    triggerHover();
  }, [disabled, triggerHover]);

  const onPointerLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const onClick = useCallback(() => {
    if (disabled) return;
    turn();
    triggerPoke();
  }, [disabled, turn, triggerPoke]);

  return {
    facing,
    isHovered,
    interactionReaction,
    turn,
    triggerPoke,
    triggerHover,
    interactionProps: {
      onPointerEnter,
      onPointerLeave,
      onClick,
    },
  };
}
