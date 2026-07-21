/**
 * NOSTR PETS 3D Asset Schema
 *
 * Defines how 3D pet/room assets are referenced from Nostr events.
 *
 *   - kind 31124 (Pets State) tags: ["asset_3d", "<url>", "<sha256>", "<mime>"]
 *   - kind 11125 (Nostr Pet Profile) content JSON: { assets_3d: Assets3DContent }
 *
 * Assets are hosted on Blossom (BUD-01) so they are Nostr-native binary blobs.
 * Other Nostr clients that do not support 3D rendering fall back to the standard
 * SVG pet / 2D room renderer.
 */

import { sanitizeUrl } from '@/lib/sanitizeUrl';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Lowercase hex sha256 length. */
export const ASSET_3D_SHA256_LENGTH = 64;

/** Regex for a valid hex sha256 (case-insensitive). */
const ASSET_3D_SHA256_RE = /^[0-9a-fA-F]{64}$/;

/** Allowed 3D asset MIME types. Kept permissive to allow model/gltf-binary etc. */
export const ASSET_3D_MIME_TYPES = [
  'model/gltf-binary',
  'model/gltf+json',
  'model/glb',
  'application/octet-stream',
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single validated 3D asset reference. */
export interface Asset3DEntry {
  /** Blossom (or other https) URL where the asset is hosted. */
  url: string;
  /** Hex sha256 of the blob content. */
  sha256: string;
  /** MIME type of the asset. */
  mime?: string;
  /** Optional dimensions hint (e.g. "1024x1024"). */
  dim?: string;
  /** Optional size in bytes. */
  size?: number;
  /** Optional named variant (e.g. "walk", "sleep"). */
  variant?: string;
  /** Optional display title for the asset. */
  title?: string;
  /** Author / creator credit (e.g. "Model by PixelPup on Sketchfab"). */
  author?: string;
  /** License name or URL (e.g. "CC-BY-4.0"). */
  license?: string;
  /** Link to the original source / Sketchfab page. */
  sourceUrl?: string;
  /** Per-asset scale override for this GLB inside the 3D room. */
  scale?: number;
}

/** Parsed result from a kind 31124 `asset_3d` tag. */
export interface Asset3DTag extends Asset3DEntry {
  /** The raw tag array it came from. */
  raw: string[];
}

/** Top-level content key shape stored in kind 11125 content JSON under `assets_3d`. */
export interface Assets3DContent {
  v: 1;
  /** Default 3D asset for the current pet. */
  pet?: Asset3DEntry;
  /** 3D environment asset for the room. */
  room?: Asset3DEntry;
  /** Per-adult-form overrides keyed by form id (e.g. "catti"). */
  by_form?: Record<string, Asset3DEntry>;
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

function isValidSha256(value: unknown): value is string {
  return typeof value === 'string' && ASSET_3D_SHA256_RE.test(value);
}

function isValidMime(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 120;
}

function isValidDim(value: unknown): value is string {
  return typeof value === 'string' && /^\d+x\d+$/.test(value);
}

function isValidSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isValidVariant(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 32;
}

function isValidCreditString(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isValidSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) return false;
  const sanitized = sanitizeUrl(value);
  return sanitized === value;
}

// ─── Tag Parser / Builder ────────────────────────────────────────────────────

/**
 * Parse the first valid `asset_3d` tag from a kind 31124 event.
 * Returns undefined if no valid tag is found. Never throws.
 */
export function parseAsset3DTag(tags: string[][]): Asset3DTag | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'asset_3d') continue;

    const url = sanitizeUrl(tag[1]);
    const sha256 = tag[2];
    const mime = tag[3];

    if (!url || !isValidSha256(sha256)) continue;

    const entry: Asset3DTag = { url, sha256, raw: tag };

    if (mime && isValidMime(mime)) {
      entry.mime = mime;
    }
    if (tag[4] && isValidDim(tag[4])) {
      entry.dim = tag[4];
    }
    if (tag[5] && isValidSize(Number(tag[5]))) {
      entry.size = Number(tag[5]);
    }
    if (tag[6] && isValidVariant(tag[6])) {
      entry.variant = tag[6];
    }

    return entry;
  }

  return undefined;
}

/**
 * Build a validated `asset_3d` tag from an entry.
 * Throws if the URL or sha256 are invalid.
 */
export function buildAsset3DTag(entry: Asset3DEntry): string[] {
  const url = sanitizeUrl(entry.url);
  if (!url) {
    throw new Error('Invalid asset_3d URL');
  }
  if (!isValidSha256(entry.sha256)) {
    throw new Error('Invalid asset_3d sha256');
  }

  const tag: string[] = ['asset_3d', url, entry.sha256.toLowerCase()];

  if (entry.mime && isValidMime(entry.mime)) {
    tag.push(entry.mime);
    if (entry.dim && isValidDim(entry.dim)) {
      tag.push(entry.dim);
    }
    if (entry.size !== undefined && isValidSize(entry.size)) {
      tag.push(entry.size.toString());
    }
    if (entry.variant && isValidVariant(entry.variant)) {
      tag.push(entry.variant);
    }
  }

  return tag;
}

// ─── Profile Content Parser ──────────────────────────────────────────────────

/**
 * Parse `assets_3d` from a kind 11125 content string.
 * Returns undefined if missing, malformed, or invalid. Never throws.
 */
export function parseAssets3DContent(
  profileContent: string | undefined | null,
): Assets3DContent | undefined {
  if (!profileContent || !profileContent.trim()) return undefined;

  try {
    const raw = JSON.parse(profileContent);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;

    const assets = raw.assets_3d;
    if (typeof assets !== 'object' || assets === null || Array.isArray(assets)) return undefined;
    if (assets.v !== 1) return undefined;

    const parsed: Assets3DContent = { v: 1 };

    const pet = parseAsset3DEntry((assets as Record<string, unknown>).pet);
    if (pet) parsed.pet = pet;

    const room = parseAsset3DEntry((assets as Record<string, unknown>).room);
    if (room) parsed.room = room;

    const byFormRaw = (assets as Record<string, unknown>).by_form;
    if (typeof byFormRaw === 'object' && byFormRaw !== null && !Array.isArray(byFormRaw)) {
      const byForm: Record<string, Asset3DEntry> = {};
      for (const key of Object.keys(byFormRaw)) {
        const entry = parseAsset3DEntry((byFormRaw as Record<string, unknown>)[key]);
        if (entry) {
          byForm[key] = entry;
        }
      }
      if (Object.keys(byForm).length > 0) {
        parsed.by_form = byForm;
      }
    }

    return parsed;
  } catch {
    return undefined;
  }
}

function parseAsset3DEntry(raw: unknown): Asset3DEntry | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  const url = sanitizeUrl(obj.url as string | undefined);
  const sha256 = obj.sha256;
  if (!url || !isValidSha256(sha256)) return undefined;

  const entry: Asset3DEntry = { url, sha256: sha256.toLowerCase() };

  const mime = obj.mime;
  if (mime && isValidMime(mime)) {
    entry.mime = mime;
  }

  const dim = obj.dim;
  if (dim && isValidDim(dim)) {
    entry.dim = dim;
  }

  const size = obj.size;
  if (size !== undefined && isValidSize(size)) {
    entry.size = size;
  }

  const variant = obj.variant;
  if (variant && isValidVariant(variant)) {
    entry.variant = variant;
  }

  const title = obj.title;
  if (title && isValidCreditString(title, 120)) {
    entry.title = title;
  }

  const author = obj.author;
  if (author && isValidCreditString(author, 200)) {
    entry.author = author;
  }

  const license = obj.license;
  if (license && isValidCreditString(license, 120)) {
    entry.license = license;
  }

  const sourceUrl = obj.sourceUrl;
  if (sourceUrl && isValidSourceUrl(sourceUrl)) {
    entry.sourceUrl = sourceUrl;
  }

  return entry;
}
