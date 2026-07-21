/**
 * NOSTR Pets custom species schema.
 *
 * Custom species live in the owner’s kind 11125 Nostr pet profile content
 * under the `custom_forms` key. This keeps them owner-scoped and lets the
 * renderer treat built-in and custom forms uniformly after lookup.
 *
 * Only metadata and Blossom URLs are stored here; the actual GLB/SVG bytes
 * are hosted as Blossom blobs.
 */

import { sanitizeUrl } from '@/lib/sanitizeUrl';
import type { Asset3DEntry } from './three-d-schema';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single user-created species. */
export interface CustomPetForm {
  /** URL-safe unique id, e.g. "my-honey-badger". */
  id: string;
  /** Display name shown in the UI. */
  label: string;
  /** Category is always "custom" for user-created species. */
  category: 'custom';
  /** SVG for the awake adult. */
  svgBase: Asset3DEntry;
  /** Optional SVG for the sleeping adult; defaults to base. */
  svgSleeping?: Asset3DEntry;
  /** Optional GLB model for the 3D adult. */
  asset3d?: Asset3DEntry;
  /** Optional GLB model for the 3D room/environment. */
  roomAsset3d?: Asset3DEntry;
  /** Creator / model credit. */
  author?: string;
  /** License name or URL. */
  license?: string;
  /** Link to the original source. */
  sourceUrl?: string;
}

/** Shape of `custom_forms` inside kind 11125 content JSON. */
export interface CustomFormsContent {
  v: 1;
  forms: Record<string, CustomPetForm>;
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value);
}

function isValidLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 120;
}

function isValidCreditString(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isValidSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) return false;
  const sanitized = sanitizeUrl(value);
  return sanitized === value;
}

function isValidAsset3DEntry(raw: unknown): raw is Asset3DEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  return typeof obj.url === 'string' && obj.url.length > 0 && typeof obj.sha256 === 'string' && /^[0-9a-fA-F]{64}$/.test(obj.sha256);
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse `custom_forms` from a kind 11125 content string.
 * Returns undefined if missing, malformed, or invalid. Never throws.
 */
export function parseCustomFormsContent(
  profileContent: string | undefined | null,
): CustomFormsContent | undefined {
  if (!profileContent || !profileContent.trim()) return undefined;

  try {
    const raw = JSON.parse(profileContent);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;

    const customForms = (raw as Record<string, unknown>).custom_forms;
    if (typeof customForms !== 'object' || customForms === null || Array.isArray(customForms)) {
      return undefined;
    }

    const formsObj = (customForms as Record<string, unknown>).forms;
    if (typeof formsObj !== 'object' || formsObj === null || Array.isArray(formsObj)) {
      return undefined;
    }

    const forms: Record<string, CustomPetForm> = {};
    for (const [id, rawForm] of Object.entries(formsObj)) {
      const parsed = parseCustomPetForm(id, rawForm);
      if (parsed) {
        forms[id] = parsed;
      }
    }

    if (Object.keys(forms).length === 0) return undefined;

    return { v: 1, forms };
  } catch {
    return undefined;
  }
}

function parseCustomPetForm(id: string, raw: unknown): CustomPetForm | undefined {
  if (!isValidId(id)) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  if (!isValidLabel(obj.label)) return undefined;
  if (obj.category !== 'custom') return undefined;
  if (!isValidAsset3DEntry(obj.svgBase)) return undefined;

  const form: CustomPetForm = {
    id,
    label: obj.label,
    category: 'custom',
    svgBase: obj.svgBase as Asset3DEntry,
  };

  if (isValidAsset3DEntry(obj.svgSleeping)) {
    form.svgSleeping = obj.svgSleeping as Asset3DEntry;
  }
  if (isValidAsset3DEntry(obj.asset3d)) {
    form.asset3d = obj.asset3d as Asset3DEntry;
  }
  if (isValidAsset3DEntry(obj.roomAsset3d)) {
    form.roomAsset3d = obj.roomAsset3d as Asset3DEntry;
  }
  if (isValidCreditString(obj.author, 200)) {
    form.author = obj.author;
  }
  if (isValidCreditString(obj.license, 120)) {
    form.license = obj.license;
  }
  if (isValidSourceUrl(obj.sourceUrl)) {
    form.sourceUrl = obj.sourceUrl;
  }

  return form;
}

// ─── Content Update Helper ───────────────────────────────────────────────────

/**
 * Update `custom_forms` inside an existing profile content string.
 *
 * @param prevContent - Raw kind 11125 content. May be empty or invalid.
 * @param patch - Pass a `CustomPetForm` to add/update, or `null` with an id to remove.
 * @returns The new JSON content string to publish.
 */
export function updateCustomFormsContent(
  prevContent: string | undefined | null,
  patch: { id: string; form: CustomPetForm | null },
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

  const currentCustom: Record<string, unknown> =
    parsed.custom_forms && typeof parsed.custom_forms === 'object' && !Array.isArray(parsed.custom_forms)
      ? { ...(parsed.custom_forms as Record<string, unknown>) }
      : { v: 1 };

  const currentForms: Record<string, CustomPetForm> =
    currentCustom.forms && typeof currentCustom.forms === 'object' && !Array.isArray(currentCustom.forms)
      ? { ...(currentCustom.forms as Record<string, CustomPetForm>) }
      : {};

  if (patch.form) {
    currentForms[patch.id] = patch.form;
  } else {
    delete currentForms[patch.id];
  }

  if (Object.keys(currentForms).length > 0) {
    parsed.custom_forms = { v: 1, forms: currentForms };
  } else {
    delete parsed.custom_forms;
  }

  return JSON.stringify(parsed);
}

/**
 * Read the current `custom_forms` map from a profile content string.
 * Returns an empty object if missing or malformed.
 */
export function readCustomFormsMap(
  content: string | undefined | null,
): Record<string, CustomPetForm> {
  return parseCustomFormsContent(content)?.forms ?? {};
}
