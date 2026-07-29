/**
 * Animated character pets — clay-render characters delivered as an animated
 * WebP (+ static first-frame PNG) instead of an SVG adult form.
 *
 * Two families exist today:
 *   - Buzz pets (bumble/fizz/honey) in the 'buzz' breed category — assets in
 *     `public/pets/buzz/`, see buzz-pets.ts.
 *   - Bleep, a one-off character in the '2140-pets' breed category — assets in
 *     `public/pets/bleep/` (`bleep.webp` animated, `bleep.png` first frame).
 *
 * The browser animates the WebP natively inside <img>, so no player code is
 * needed; babies render the static first frame.
 */

import { isBuzzPetId, getBuzzPetAnimatedUrl, getBuzzPetStaticUrl } from '@/pets/core/lib/buzz-pets';

export const BLEEP_PET_ID = 'bleep';

export function isBleepPetId(id: string | undefined): boolean {
  return id === BLEEP_PET_ID;
}

/** Animated artwork URL for Bleep (loops forever, transparent background). */
export function getBleepAnimatedUrl(): string {
  return '/pets/bleep/bleep.webp';
}

/** Static first-frame URL for Bleep — babies / reduced-motion contexts. */
export function getBleepStaticUrl(): string {
  return '/pets/bleep/bleep.png';
}

/**
 * True when the pet renders as an animated WebP character (no SVG form, no
 * eye rig): Buzz pets, or any category member whose breed_asset is Bleep.
 */
export function isAnimatedCharacterPet(
  breedCategory: string | undefined,
  breedAsset: string | undefined,
): boolean {
  return (breedCategory === 'buzz' && isBuzzPetId(breedAsset)) || isBleepPetId(breedAsset);
}

/** Animated WebP URL for an animated-character breed_asset, if any. */
export function getAnimatedCharacterUrl(breedAsset: string | undefined): string | undefined {
  if (isBleepPetId(breedAsset)) return getBleepAnimatedUrl();
  if (breedAsset && isBuzzPetId(breedAsset)) return getBuzzPetAnimatedUrl(breedAsset);
  return undefined;
}

/** Static first-frame URL for an animated-character breed_asset, if any. */
export function getAnimatedCharacterStaticUrl(breedAsset: string | undefined): string | undefined {
  if (isBleepPetId(breedAsset)) return getBleepStaticUrl();
  if (breedAsset && isBuzzPetId(breedAsset)) return getBuzzPetStaticUrl(breedAsset);
  return undefined;
}
