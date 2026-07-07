import { useMemo } from 'react';

import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { parseAssets3DContent } from '@/pets/three-d/lib/three-d-schema';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

/**
 * Resolve the 3D room/environment asset for the current user.
 *
 * Reads `assets_3d.room` from the Blobbonaut profile content. If none is
 * configured, the renderer falls back to a procedural 3D room.
 */
export function usePets3DRoomAsset(): Asset3DEntry | undefined {
  const { profile } = useBlobbonautProfile();

  return useMemo(() => {
    if (!profile?.content) return undefined;
    const parsed = parseAssets3DContent(profile.content);
    return parsed?.room;
  }, [profile?.content]);
}
