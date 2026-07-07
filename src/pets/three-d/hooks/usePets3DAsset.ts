import { useMemo } from 'react';

import type { PetsCompanion } from '@/pets/core/lib/pets';
import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { resolvePets3DAsset } from '@/pets/three-d/lib/asset-resolver';
import { getDefaultPet3DAsset } from '@/pets/three-d/lib/default-assets';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

/**
 * Resolve the 3D asset for the current user's adult pet.
 *
 * Uses the pet's own `asset_3d` tag first, then falls back to the owner's
 * Blobbonaut profile `assets_3d` content, and finally to the bundled default
 * demo model so 3D pets work out of the box.
 *
 * @param companion - The currently active/selected 2140 PET.
 * @returns The resolved 3D asset entry, or undefined to fall back to SVG.
 */
export function usePets3DAsset(
  companion: PetsCompanion | undefined | null,
): Asset3DEntry | undefined {
  const { profile } = useBlobbonautProfile();

  return useMemo(() => {
    return resolvePets3DAsset(companion, profile?.content) ?? getDefaultPet3DAsset();
  }, [companion, profile?.content]);
}
