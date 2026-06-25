/**
 * PetsRoomHero — Flex spacer for the room layout.
 *
 * This component now serves two purposes:
 * 1. Provides a flex-1 spacer above the bottom bar so the room layout works.
 * 2. Shows the "out exploring" state when Pets is an active floating companion.
 *
 * The actual Pets visual, stats crown, and name are rendered by PetsRoomStage
 * (absolutely positioned against the shell). The room indicator is rendered by
 * the shell's room header overlay.
 */

import { memo } from 'react';
import { Footprints, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { PetsCompanion } from '@/pets/core/lib/pets';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PetsRoomHeroProps {
  companion: PetsCompanion;
  isActiveFloatingCompanion: boolean;
  isUpdatingCompanion: boolean;
  handleSetAsCompanion: () => Promise<void>;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Memoized so that high-frequency drag-state updates in the parent
 * (PetsDashboard) do not propagate into the Pets visual subtree.
 * All props from the parent are stable references during food drag,
 * so memo effectively short-circuits the entire subtree.
 */
export const PetsRoomHero = memo(function PetsRoomHero({
  companion,
  isActiveFloatingCompanion,
  isUpdatingCompanion,
  handleSetAsCompanion,
  className,
}: PetsRoomHeroProps) {
  if (isActiveFloatingCompanion) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-4 text-center flex-1 px-4', className)}>
        <Footprints className="size-12 text-muted-foreground/30" />
        <p className="text-muted-foreground text-sm">
          {companion.name} is out exploring right now.
        </p>
        <button
          onClick={handleSetAsCompanion}
          disabled={isUpdatingCompanion}
          className={cn(
            'flex items-center justify-center gap-2 px-6 py-3 rounded-full text-white font-semibold transition-all duration-300 ease-out text-sm',
            'hover:-translate-y-0.5 hover:scale-105 hover:brightness-110 active:scale-95',
            isUpdatingCompanion && 'opacity-50 pointer-events-none',
          )}
          style={{ background: 'linear-gradient(135deg, #8b5cf6, #ec4899, #f59e0b)' }}
        >
          {isUpdatingCompanion ? <Loader2 className="size-4 animate-spin" /> : <Footprints className="size-4" />}
          <span>Bring {companion.name} home</span>
        </button>
      </div>
    );
  }

  // Invisible flex spacer — occupies the visual area so the bottom bar
  // stays at the bottom. The actual Pets rendering happens in PetsRoomStage
  // which is absolutely positioned against the shell.
  // pointer-events-none lets taps pass through to the stage overlay (egg/pet).
  return <div className={cn('flex-1 min-h-0 pointer-events-none', className)} />;
});
