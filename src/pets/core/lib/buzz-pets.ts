/**
 * Buzz pets — animated clay companions from https://buzz.xyz/.
 *
 * Assets live in `public/pets/buzz/`:
 *   - `<id>.webp` — animated WebP (alpha, ~240x277, loops forever)
 *   - `<id>.png`  — static first frame (reduced motion / tiny previews)
 *
 * The browser animates the WebP natively inside <img>, so no player code is
 * needed. Buzz babies render the static first frame (the animation is
 * something they grow into); the animated character appears at the adult
 * stage (and in pickers/previews).
 */

export type BuzzPetId = 'bumble' | 'fizz' | 'honey';

export interface BuzzPetMeta {
  id: BuzzPetId;
  label: string;
}

export const BUZZ_PETS: readonly BuzzPetMeta[] = [
  { id: 'bumble', label: 'Bumble' },
  { id: 'fizz', label: 'Fizz' },
  { id: 'honey', label: 'Honey' },
] as const;

export function isBuzzPetId(id: string | undefined): id is BuzzPetId {
  return BUZZ_PETS.some((p) => p.id === id);
}

/** Animated artwork URL (loops forever, transparent background). */
export function getBuzzPetAnimatedUrl(id: string): string {
  return `/pets/buzz/${id}.webp`;
}

/** Static first-frame URL — for reduced-motion or static export contexts. */
export function getBuzzPetStaticUrl(id: string): string {
  return `/pets/buzz/${id}.png`;
}
