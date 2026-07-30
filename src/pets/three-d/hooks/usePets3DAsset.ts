import { useMemo } from 'react';

import type { PetsCompanion } from '@/pets/core/lib/pets';
import { useNostrPetProfile } from '@/hooks/useNostrPetProfile';
import { resolvePets3DAsset } from '@/pets/three-d/lib/asset-resolver';
import { readCustomFormsMap } from '@/pets/three-d/lib/custom-forms-schema';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

/**
 * Resolve the 3D asset for the current user's adult pet.
 *
 * Uses the pet's own `asset_3d` tag first, then the owner's custom species
 * form, then the owner's Nostr pet profile `assets_3d` content. When no GLB
 * is configured the result is undefined and the 3D world renders the pet's
 * own 2D visual as a sprite instead — the pet never turns into a stand-in
 * demo model.
 *
 * @param companion - The currently active/selected NOSTR PET.
 * @returns The resolved 3D asset entry, or undefined for sprite rendering.
 */
export function usePets3DAsset(
  companion: PetsCompanion | undefined | null,
): Asset3DEntry | undefined {
  const { profile } = useNostrPetProfile();

  const customForms = useMemo(
    () => readCustomFormsMap(profile?.content),
    [profile?.content],
  );

  return useMemo(
    () => resolvePets3DAsset(companion, profile?.content, customForms),
    [companion, profile?.content, customForms],
  );
}
