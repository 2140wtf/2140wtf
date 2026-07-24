/**
 * Encrypted community images (icon / banner) — CORD-02 §6.
 *
 * Images never touch a media server in plaintext: each is AES-256-GCM
 * encrypted under a fresh random key and uploaded as an ordinary blob; the
 * Control Plane entity carries only the pointer `{url, key, nonce, hash}`.
 * A member fetches the blob, decrypts, and verifies the plaintext SHA-256, so
 * the media server learns nothing and a swapped blob fails closed.
 *
 * The V2 pointer carries no extension/mime (unlike Armada's V1 shape), so the
 * decrypted bytes are sniffed by magic numbers for display.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import type { ImagePointer } from "@/concord-v2/lib/types";

/** 16-byte (128-bit) nonce, matching Vector's AES-GCM parameters. */
const NONCE_BYTES = 16;

const CACHE_NAME = "concord-v2-images";

/** Copy into a fresh ArrayBuffer-backed view (WebCrypto wants BufferSource). */
function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(bytes.byteLength);
  const view = new Uint8Array(ab);
  view.set(bytes);
  return view;
}

/** Best-effort mime from magic bytes (display only). */
export function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 5 && bytes[0] === 0x3c) return "image/svg+xml"; // '<' — svg-ish
  return "application/octet-stream";
}

/** AES-GCM encrypt file bytes; returns ciphertext + the pointer fields to seal in metadata. */
export async function encryptImageBlob(
  file: File | Blob,
): Promise<{ ciphertext: Uint8Array<ArrayBuffer>; key: string; nonce: string; hash: string }> {
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonceBytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const cryptoKey = await crypto.subtle.importKey("raw", buf(keyBytes), "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonceBytes) }, cryptoKey, buf(plaintext));
  return {
    ciphertext: new Uint8Array(ct),
    key: bytesToHex(keyBytes),
    nonce: bytesToHex(nonceBytes),
    hash: bytesToHex(sha256(plaintext)),
  };
}

async function readCached(hash: string): Promise<Blob | undefined> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(`/${hash}`);
    return res ? await res.blob() : undefined;
  } catch {
    return undefined;
  }
}

async function writeCached(hash: string, plaintext: Uint8Array, mime: string): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(`/${hash}`, new Response(buf(plaintext), { headers: { "Content-Type": mime } }));
  } catch {
    // best-effort
  }
}

/**
 * Fetch + decrypt an {@link ImagePointer} to an object URL. Verifies the
 * plaintext SHA-256 against `pointer.hash`; the caller revokes the URL on
 * unmount. Content-addressed disk cache (Cache Storage) skips re-fetch +
 * re-decrypt across reloads.
 */
export async function decryptImagePointer(pointer: ImagePointer, signal?: AbortSignal): Promise<string> {
  const cached = await readCached(pointer.hash);
  if (cached) return URL.createObjectURL(cached);

  const res = await fetch(pointer.url, { signal });
  if (!res.ok) throw new Error(`image fetch failed: HTTP ${res.status}`);
  const ciphertext = new Uint8Array(await res.arrayBuffer());

  const cryptoKey = await crypto.subtle.importKey("raw", buf(hexToBytes(pointer.key)), "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(hexToBytes(pointer.nonce)) }, cryptoKey, buf(ciphertext));
  const plaintext = new Uint8Array(pt);

  if (bytesToHex(sha256(plaintext)) !== pointer.hash.toLowerCase()) {
    throw new Error("image integrity check failed");
  }
  const mime = sniffImageMime(plaintext);
  void writeCached(pointer.hash, plaintext, mime);
  return URL.createObjectURL(new Blob([buf(plaintext)], { type: mime }));
}
