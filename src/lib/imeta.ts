/** Parsed imeta entry from NIP-94 tags. */
export interface ImetaEntry {
  url: string;
  thumbnail?: string;
  mime?: string;
  /** Summary text (used as webxdc app name for webxdc attachments). */
  summary?: string;
  /** Webxdc session UUID — present when the attachment is a stateful webxdc app. */
  webxdc?: string;
  /** Pixel dimensions from NIP-94 `dim` tag, e.g. "1280x720". */
  dim?: string;
  /** Blurhash placeholder from NIP-94 `blurhash` tag. */
  blurhash?: string;
  /** Original filename from the `name` field (used to infer a MIME when `m` is absent). */
  name?: string;
  /**
   * Client-side blob encryption metadata, as sent by Vector/0xChat for
   * Blossom attachments: the blob at `url` is AES-GCM ciphertext, decryptable
   * only with `key` + `nonce` (both lowercase hex). Present only when the
   * imeta carried `encryption-algorithm`, `decryption-key`, `decryption-nonce`.
   */
  encryption?: ImetaEncryption;
}

/** AES-GCM blob-encryption parameters carried in an imeta tag. */
export interface ImetaEncryption {
  /** Encryption algorithm, e.g. "aes-gcm" (only aes-gcm is supported). */
  algorithm: string;
  /** AES-256 key as lowercase hex (64 chars). */
  key: string;
  /** AES-GCM nonce/IV as lowercase hex (Vector uses a 16-byte, 0xChat-compatible nonce). */
  nonce: string;
}

/** Parse all imeta tags into a map keyed by URL. Works for any event kind. */
export function parseImetaMap(tags: string[][]): Map<string, ImetaEntry> {
  const map = new Map<string, ImetaEntry>();
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue;
    const entry: Record<string, string> = {};
    for (let i = 1; i < tag.length; i++) {
      const part = tag[i];
      const spaceIdx = part.indexOf(' ');
      if (spaceIdx === -1) continue;
      const key = part.slice(0, spaceIdx);
      const value = part.slice(spaceIdx + 1);
      entry[key] = value;
    }
    if (entry.url) {
      const enc = parseImetaEncryption(entry);
      map.set(entry.url, {
        url: entry.url,
        thumbnail: entry.image,
        mime: entry.m,
        summary: entry.summary,
        webxdc: entry.webxdc,
        dim: entry.dim,
        blurhash: entry.blurhash,
        name: entry.name,
        encryption: enc,
      });
    }
  }
  return map;
}

/**
 * Parse a NIP-17 kind-15 file message (`content` is the blob URL; the file
 * metadata rides in TOP-LEVEL tags, not an `imeta` tag) into an
 * {@link ImetaEntry}. This is the shape Amethyst/0xChat send for encrypted DM
 * attachments: `file-type` (MIME), `x`/`ox` (hashes), `size`, `dim`,
 * `blurhash`, `thumb`/`image`, and the `encryption-algorithm` /
 * `decryption-key` / `decryption-nonce` triple.
 *
 * Returns `undefined` when `url` isn't a usable http(s) URL. Encryption is
 * attached only when the params parse as valid AES-GCM (see
 * {@link parseImetaEncryption}); a file message with no/invalid encryption
 * still yields an entry so a plaintext attachment renders.
 */
export function parseFileMessageTags(url: string, tags: string[][]): ImetaEntry | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  const flat: Record<string, string> = {};
  for (const [name, value] of tags) {
    if (name && value !== undefined && !(name in flat)) flat[name] = value;
  }
  return {
    url,
    thumbnail: flat.thumb ?? flat.image,
    // NIP-17 file messages use `file-type` for the MIME; fall back to `m`.
    mime: flat["file-type"] ?? flat.m,
    dim: flat.dim,
    blurhash: flat.blurhash,
    name: flat.name,
    encryption: parseImetaEncryption(flat),
  };
}

/** Lowercase-hex validator (even length, hex digits only). */
function isHex(s: string | undefined, len?: number): s is string {
  if (!s) return false;
  if (len !== undefined && s.length !== len) return false;
  return s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s);
}

/**
 * Build an {@link ImetaEncryption} from a raw imeta field map, or `undefined`
 * when the attachment is not encrypted / the parameters are malformed. Only
 * `aes-gcm` is recognized; the key must be a 32-byte (64-hex) AES-256 key and
 * the nonce must be valid hex (Vector/0xChat use 16 bytes; we don't hardcode
 * the length so other senders' nonces still work).
 */
function parseImetaEncryption(entry: Record<string, string>): ImetaEncryption | undefined {
  const algorithm = entry["encryption-algorithm"];
  const key = entry["decryption-key"];
  const nonce = entry["decryption-nonce"];
  if (!algorithm) return undefined;
  if (algorithm.toLowerCase() !== "aes-gcm") return undefined;
  if (!isHex(key, 64) || !isHex(nonce)) return undefined;
  return { algorithm: algorithm.toLowerCase(), key: key.toLowerCase(), nonce: nonce.toLowerCase() };
}
