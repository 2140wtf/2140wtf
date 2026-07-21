/**
 * NOSTR PETS 3D Asset Resolver
 *
 * Pure resolution logic for picking the right 3D model for a pet.
 *
 * Resolution order:
 *   1. A kind 31124 `asset_3d` tag on the pet itself.
 *   2. The owner's kind 11125 `assets_3d.by_form[adultType]` override.
 *   3. The owner's kind 11125 `assets_3d.pet` default.
 *   4. SVG fallback (return undefined).
 */

import type { PetsCompanion } from '@/pets/core/lib/pets';
import {
  parseAssets3DContent,
  type Asset3DEntry,
} from '@/pets/three-d/lib/three-d-schema';
import type { CustomPetForm } from '@/pets/three-d/lib/custom-forms-schema';

/**
 * Resolve a 3D asset for the given companion.
 *
 * Resolution order:
 *   1. A kind 31124 `asset_3d` tag on the pet itself.
 *   2. For custom-form pets, the owner's `custom_forms[id].asset3d`.
 *   3. The owner's kind 11125 `assets_3d.by_form[adultType]` override.
 *   4. The owner's kind 11125 `assets_3d.pet` default.
 *   5. SVG fallback (return undefined).
 *
 * @param companion - Parsed NOSTR PET (must be adult to use a 3D asset).
 * @param profileContent - Raw kind 11125 content string from the owner's Nostr pet profile.
 * @param customForms - Optional owner custom species map from profile `custom_forms`.
 * @returns The resolved asset entry, or undefined to fall back to SVG.
 */
export function resolvePets3DAsset(
  companion: PetsCompanion | undefined | null,
  profileContent: string | undefined | null,
  customForms?: Record<string, CustomPetForm>,
): Asset3DEntry | undefined {
  if (!companion || companion.stage !== 'adult') return undefined;

  // 1. Per-pet override from kind 31124 tags.
  if (companion.asset3d) {
    return companion.asset3d;
  }

  // 2. Custom-form species can define their own GLB in the owner's profile.
  if (
    companion.breedCategory === 'custom' &&
    companion.breedAsset &&
    customForms?.[companion.breedAsset]?.asset3d
  ) {
    return customForms[companion.breedAsset].asset3d;
  }

  // 3. Owner's profile-level defaults/overrides.
  const assets3d = parseAssets3DContent(profileContent);
  if (assets3d) {
    const adultType = companion.adultType;
    if (adultType && assets3d.by_form?.[adultType]) {
      return assets3d.by_form[adultType];
    }
    if (assets3d.pet) {
      return assets3d.pet;
    }
  }

  return undefined;
}
