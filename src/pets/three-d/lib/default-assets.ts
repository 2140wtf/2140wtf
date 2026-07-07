/**
 * Default 3D assets shipped with the app.
 *
 * The demo pet model is the Khronos glTF Sample "Fox" (CC0), bundled in
 * public/models so it works offline and without any user configuration.
 * It serves as the fallback when no Blossom-hosted asset is configured.
 */

import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

/** sha256 of public/models/pets-default.glb (computed at build time). */
export const DEFAULT_PET_3D_SHA256 = 'd97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7';

/** Build an absolute HTTPS URL for the bundled default pet GLB. */
export function getDefaultPet3DAsset(): Asset3DEntry {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return {
    url: `${origin}/models/pets-default.glb`,
    sha256: DEFAULT_PET_3D_SHA256,
    mime: 'model/gltf-binary',
  };
}

/** Default floor/room color used when no room GLB is configured. */
export const DEFAULT_ROOM_GROUND_COLOR = '#5c7c4a';
export const DEFAULT_ROOM_SKY_AZIMUTH = 0.25;
export const DEFAULT_ROOM_SKY_INCLINATION = 0.49;
