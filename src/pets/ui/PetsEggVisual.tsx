/**
 * PetsEggVisual - Reusable component for rendering Pets eggs
 * 
 * This component is the UI integration point between the Pets domain model
 * and the EggGraphic visual module.
 * 
 * Rendering flow:
 *   PetsCompanion → toEggGraphicVisualPets() → EggGraphic
 * 
 * The adapter is the ONLY translation boundary - this component should not
 * contain any domain-to-visual mapping logic.
 */

import { useMemo } from 'react';

import { EggGraphic, type EggReactionState, type EggStatusEffects, type EggTourVisualState } from '@/pets/egg';
import { toEggGraphicVisualPets } from '@/pets/core/lib/pets-egg-adapter';
import { cn } from '@/lib/utils';
import type { PetsCompanion } from '@/pets/core/lib/pets';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PetsEggSize = 'sm' | 'md' | 'lg';

// Re-export for convenience
export type { EggReactionState, EggStatusEffects, EggTourVisualState } from '@/pets/egg';

export interface PetsEggVisualProps {
  /** The Pets companion data from parsePetsEvent */
  companion: PetsCompanion;
  /** Size variant: sm (48px), md (96px), lg (160px) */
  size?: PetsEggSize;
  /** Enable ambient animations (glow, particles) */
  animated?: boolean;
  /** Reaction state for music/sing animations */
  reaction?: EggReactionState;
  /** Status effects for egg visual feedback (dirty, sick, happy) */
  statusEffects?: EggStatusEffects;
  /** Tour visual state - driven externally by the tour orchestration layer */
  tourVisualState?: EggTourVisualState;
  /** Callback when the egg is clicked during an interactive tour step */
  onTourEggClick?: () => void;
  /** Generic click callback for any egg tap (non-tour consumers) */
  onClick?: () => void;
  /** Additional CSS classes for the container */
  className?: string;
}

// ─── Size Configuration ───────────────────────────────────────────────────────

/**
 * Maps external size API to container dimensions and EggGraphic sizeVariant.
 * 
 * Container sizes are chosen to work well in common UI contexts:
 * - sm: Compact cards, lists, thumbnails
 * - md: Standard display, selector cards
 * - lg: Hero/main display, prominent visuals
 */
const SIZE_CONFIG: Record<PetsEggSize, { container: string; sizeVariant: 'tiny' | 'small' | 'medium' | 'large' }> = {
  sm: { container: 'size-14', sizeVariant: 'small' },
  md: { container: 'size-24', sizeVariant: 'medium' },
  lg: { container: 'size-40', sizeVariant: 'large' },
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders a Pets egg using the EggGraphic visual module.
 * 
 * Uses the adapter as the ONLY translation boundary between
 * Pets domain data and EggGraphic rendering.
 */
export function PetsEggVisual({
  companion,
  size = 'md',
  animated = false,
  reaction = 'idle',
  statusEffects,
  tourVisualState,
  onTourEggClick,
  onClick,
  className,
}: PetsEggVisualProps) {
  // Memoize adapter output to avoid unnecessary re-renders
  // Use companion.d and visual traits as dependencies to ensure re-render on preview change
  const eggVisual = useMemo(
    () => toEggGraphicVisualPets(companion),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- d and visual traits are the stable identity
    [companion.d, companion.visualTraits.baseColor, companion.visualTraits.secondaryColor]
  );
  
  const config = SIZE_CONFIG[size];
  const isSleeping = companion.state === 'sleeping';
  
  // Disable reactions when sleeping
  const effectiveReaction = isSleeping ? 'idle' : reaction;
  
  return (
    <div
      className={cn(
        // Use passed className if provided (e.g., "size-full" from parent),
        // otherwise use default container size
        className ?? config.container,
        'relative flex items-center justify-center',
        // Reduced opacity when sleeping
        isSleeping && 'opacity-70',
      )}
    >
      <EggGraphic
        pets={eggVisual}
        sizeVariant={config.sizeVariant}
        animated={animated && !isSleeping}
        reaction={effectiveReaction}
        statusEffects={isSleeping ? undefined : statusEffects}
        tourVisualState={tourVisualState}
        onTourEggClick={onTourEggClick}
        onClick={onClick}
      />
    </div>
  );
}
