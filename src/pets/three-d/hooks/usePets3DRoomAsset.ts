import { useMemo } from 'react';

import type { PetsCompanion } from '@/pets/core/lib/pets';
import { useNostrPetProfile } from '@/hooks/useNostrPetProfile';
import { parseAssets3DContent } from '@/pets/three-d/lib/three-d-schema';
import { readCustomFormsMap } from '@/pets/three-d/lib/custom-forms-schema';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

/**
 * Resolve the 3D room/environment asset for the current user.
 *
 * Priority:
 *   1. The active custom species' `roomAsset3d` if the pet is a custom form.
 *   2. The owner's profile-level `assets_3d.room` default.
 *
 * If none is configured, the renderer falls back to a procedural 3D room.
 */
export function usePets3DRoomAsset(
  companion?: PetsCompanion | null,
): Asset3DEntry | undefined {
  const { profile } = useNostrPetProfile();

  return useMemo(() => {
    if (!profile?.content) return undefined;

    if (
      companion?.breedCategory === 'custom' &&
      companion.breedAsset
    ) {
      const customForms = readCustomFormsMap(profile.content);
      const roomAsset = customForms[companion.breedAsset]?.roomAsset3d;
      if (roomAsset) return roomAsset;
    }

    const parsed = parseAssets3DContent(profile.content);
    return parsed?.room;
  }, [profile?.content, companion?.breedCategory, companion?.breedAsset]);
}
