import { useMemo } from 'react';

import type { PetsCompanion } from '@/pets/core/lib/pets';
import { useNostrPetProfile } from '@/hooks/useNostrPetProfile';
import { resolvePets3DAsset } from '@/pets/three-d/lib/asset-resolver';
import { getDefaultPet3DAsset } from '@/pets/three-d/lib/default-assets';
import { readCustomFormsMap } from '@/pets/three-d/lib/custom-forms-schema';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

/**
 * Resolve the 3D asset for the current user's adult pet.
 *
 * Uses the pet's own `asset_3d` tag first, then the owner's custom species
 * form, then falls back to the owner's Nostr pet profile `assets_3d` content,
 * and finally to the bundled default demo model so 3D pets work out of the box.
 *
 * @param companion - The currently active/selected NOSTR PET.
 * @returns The resolved 3D asset entry, or undefined to fall back to SVG.
 */
export function usePets3DAsset(
  companion: PetsCompanion | undefined | null,
): Asset3DEntry | undefined {
  const { profile } = useNostrPetProfile();

  const customForms = useMemo(
    () => readCustomFormsMap(profile?.content),
    [profile?.content],
  );

  return useMemo(() => {
    return (
      resolvePets3DAsset(companion, profile?.content, customForms) ??
      getDefaultPet3DAsset()
    );
  }, [companion, profile?.content, customForms]);
}
