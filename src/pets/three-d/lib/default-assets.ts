/**
 * Defaults for the 3D pets world.
 *
 * There is deliberately no default PET model: when a pet has no GLB
 * configured, the 3D world renders the pet's own 2D visual as a sprite
 * so the companion never turns into a stand-in demo model.
 */

/** Default floor/room color used when no room GLB is configured. */
export const DEFAULT_ROOM_GROUND_COLOR = '#5c7c4a';
export const DEFAULT_ROOM_SKY_AZIMUTH = 0.25;
export const DEFAULT_ROOM_SKY_INCLINATION = 0.49;
