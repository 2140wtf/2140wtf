/**
 * Helpers for updating the `assets_3d` object inside a kind 11125
 * Blobbonaut profile content string.
 *
 * The rest of the content JSON is preserved so unrelated fields (e.g. room
 * layouts, furniture) are not clobbered when the user uploads a GLB.
 */

import type { Asset3DEntry, Assets3DContent } from '@/pets/three-d/lib/three-d-schema';

/**
 * Update `assets_3d` inside an existing profile content string.
 *
 * @param prevContent - Raw kind 11125 content. May be empty or invalid.
 * @param patch - Pass an `Asset3DEntry` to set, or `null` to remove the slot.
 * @returns The new JSON content string to publish.
 */
export function updateAssets3DContent(
  prevContent: string | undefined | null,
  patch: { pet?: Asset3DEntry | null; room?: Asset3DEntry | null },
): string {
  let parsed: Record<string, unknown> = {};

  if (prevContent?.trim()) {
    try {
      const raw = JSON.parse(prevContent);
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        parsed = raw as Record<string, unknown>;
      }
    } catch {
      // Ignore malformed content and start from an empty object.
    }
  }

  const currentAssets: Record<string, unknown> =
    parsed.assets_3d && typeof parsed.assets_3d === 'object' && !Array.isArray(parsed.assets_3d)
      ? { ...(parsed.assets_3d as Record<string, unknown>) }
      : { v: 1 };

  if ('pet' in patch) {
    if (patch.pet) {
      currentAssets.pet = patch.pet;
    } else {
      delete currentAssets.pet;
    }
  }

  if ('room' in patch) {
    if (patch.room) {
      currentAssets.room = patch.room;
    } else {
      delete currentAssets.room;
    }
  }

  const hasAssets =
    currentAssets.pet || currentAssets.room || currentAssets.by_form;

  if (hasAssets) {
    parsed.assets_3d = { v: 1, ...currentAssets };
  } else {
    delete parsed.assets_3d;
  }

  return JSON.stringify(parsed);
}

/**
 * Read the current `assets_3d` object from a profile content string.
 * Returns undefined if missing or malformed.
 */
export function readAssets3DContent(
  content: string | undefined | null,
): Assets3DContent | undefined {
  if (!content?.trim()) return undefined;

  try {
    const raw = JSON.parse(content);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

    const assets = (raw as Record<string, unknown>).assets_3d;
    if (!assets || typeof assets !== 'object' || Array.isArray(assets) || (assets as Assets3DContent).v !== 1) {
      return undefined;
    }

    return assets as Assets3DContent;
  } catch {
    return undefined;
  }
}
