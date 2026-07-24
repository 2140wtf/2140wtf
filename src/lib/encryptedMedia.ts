import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

import type { ImetaEncryption } from "@/lib/imeta";

/**
 * Decrypt client-encrypted Blossom attachments (Vector / 0xChat).
 *
 * Vector encrypts chat attachments with AES-256-GCM *before* uploading to
 * Blossom, so the blob at the URL is ciphertext (`ciphertext || 16-byte tag`,
 * which is exactly WebCrypto's `AES-GCM` output layout). The per-file key and
 * nonce ride in the message's NIP-92 `imeta` tag (`decryption-key` /
 * `decryption-nonce`), readable only by members who can open the event. Vector
 * uses a 16-byte (0xChat-compatible) nonce; WebCrypto's AES-GCM accepts an IV
 * of any length, so we pass the hex nonce through verbatim.
 *
 * Results are cached per (url, key, nonce) as object URLs. The same blob is
 * commonly rendered as an inline thumbnail and again in the lightbox, and
 * messages re-render frequently, so the object URL is shared across those.
 *
 * Each decrypted attachment holds its full plaintext bytes alive in a Blob for
 * as long as its object URL is live, so an unbounded, never-revoked cache is a
 * steady memory leak — on iOS Safari's low per-tab memory ceiling a media
 * channel scroll eventually OOM-kills the tab. The cache is therefore bounded
 * by total decrypted BYTES (not entry count: one 4K video dwarfs hundreds of
 * thumbnails), evicting least-recently-used entries and revoking their object
 * URLs. Revocation is deferred by a grace period so a `<video>`/`<img>` still
 * referencing a just-evicted URL keeps working until it can re-resolve.
 */

/** Max total decrypted bytes to keep alive as object URLs (~192 MB). */
const MAX_CACHED_BYTES = 192 * 1024 * 1024;
/** How long to keep a revoked entry's object URL alive after eviction. */
const REVOKE_GRACE_MS = 30_000;

interface Entry {
  /** Resolved object URL, or the in-flight fetch/decrypt promise. */
  promise: Promise<string>;
  /** Decrypted byte size (0 until resolved / on failure). */
  bytes: number;
  /** Resolved object URL once known, for revocation on eviction. */
  url?: string;
}

/** key = `${url}\n${key}\n${nonce}` → cache entry. Insertion order = LRU order. */
const cache = new Map<string, Entry>();
let totalBytes = 0;

function cacheKey(url: string, enc: ImetaEncryption): string {
  return `${url}\n${enc.key}\n${enc.nonce}`;
}

/** Mark an entry most-recently-used (re-insert at the tail of the Map). */
function touch(k: string, entry: Entry): void {
  cache.delete(k);
  cache.set(k, entry);
}

/** Evict least-recently-used entries until the byte budget is satisfied. */
function evictToBudget(keep: string): void {
  for (const [k, entry] of cache) {
    if (totalBytes <= MAX_CACHED_BYTES) break;
    if (k === keep) continue; // never evict the entry we just resolved
    cache.delete(k);
    totalBytes -= entry.bytes;
    // Defer revocation: a still-mounted <img>/<video> may reference this URL
    // for another frame; give it a grace window to re-resolve first.
    const url = entry.url;
    if (url) setTimeout(() => URL.revokeObjectURL(url), REVOKE_GRACE_MS);
  }
}

/** Copy bytes into a fresh ArrayBuffer-backed view (WebCrypto wants `ArrayBuffer`, not `ArrayBufferLike`). */
function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(bytes.byteLength);
  const view = new Uint8Array(ab);
  view.set(bytes);
  return view;
}

/**
 * Fetch + AES-GCM-decrypt an encrypted attachment into an object URL suitable
 * for an `<img src>` / `<video src>`. `mime` is used as the resulting Blob's
 * type (display only). Throws on fetch / decrypt failure.
 */
export async function decryptAttachmentToObjectURL(
  url: string,
  enc: ImetaEncryption,
  mime: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const k = cacheKey(url, enc);
  const existing = cache.get(k);
  if (existing) {
    touch(k, existing);
    return existing.promise;
  }

  const entry: Entry = { promise: Promise.resolve(""), bytes: 0 };

  entry.promise = (async () => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`attachment fetch failed: HTTP ${res.status}`);
    const ciphertext = new Uint8Array(await res.arrayBuffer());
    const plaintext = await decryptBytes(ciphertext, enc.key, enc.nonce);
    const blob = new Blob([plaintext], { type: mime || "application/octet-stream" });
    const objectUrl = URL.createObjectURL(blob);
    // Record the resolved size + URL, then trim the cache to the byte budget.
    if (cache.get(k) === entry) {
      entry.bytes = plaintext.byteLength;
      entry.url = objectUrl;
      totalBytes += entry.bytes;
      evictToBudget(k);
    }
    return objectUrl;
  })();

  // Cache the in-flight entry so concurrent renders share one fetch/decrypt;
  // drop it on failure so a transient error can be retried.
  cache.set(k, entry);
  entry.promise.catch(() => {
    if (cache.get(k) === entry) {
      cache.delete(k);
      totalBytes -= entry.bytes;
    }
  });

  return entry.promise;
}

/** Result of encrypting a file for upload: the ciphertext blob + the params to put in imeta. */
export interface EncryptedUpload {
  /** Ciphertext as a File (`ciphertext || 16-byte GCM tag`), ready to upload to Blossom. */
  file: File;
  /** AES-256 key as lowercase hex (64 chars). */
  key: string;
  /** 16-byte GCM nonce as lowercase hex (0xChat / Vector compatible). */
  nonce: string;
  /** SHA-256 (hex) of the ORIGINAL plaintext — published as the imeta `ox` field. */
  originalHash: string;
}

/**
 * Encrypt a file with AES-256-GCM for a client-encrypted Blossom upload,
 * matching Vector / 0xChat: a random 32-byte key and a **16-byte** nonce, with
 * the WebCrypto output (`ciphertext || 16-byte tag`) uploaded verbatim. The
 * returned key/nonce go into the message's `imeta` (`decryption-key` /
 * `decryption-nonce`) so members can decrypt; the blob on Blossom stays
 * ciphertext-at-rest.
 *
 * The ciphertext File keeps the original MIME type — many Blossom servers
 * reject `application/octet-stream`, and Vector sends the original MIME for
 * the same reason.
 */
export async function encryptFileForUpload(file: File): Promise<EncryptedUpload> {
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16)); // 16-byte (0xChat-compatible) nonce
  const key = bytesToHex(keyBytes);
  const nonce = bytesToHex(nonceBytes);

  const ciphertext = await encryptBytes(plaintext, key, nonce);

  const encryptedFile = new File([ciphertext], file.name, {
    type: file.type || "application/octet-stream",
  });

  return {
    file: encryptedFile,
    key,
    nonce,
    originalHash: bytesToHex(sha256(plaintext)),
  };
}

/**
 * AES-256-GCM encrypt raw bytes with a hex key + nonce. Output is WebCrypto's
 * `ciphertext || 16-byte tag` layout (identical to Vector's 16-byte-nonce
 * aes-gcm), so blobs are decryptable cross-client. Exported for testing.
 */
export async function encryptBytes(
  plaintext: Uint8Array,
  keyHex: string,
  nonceHex: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", buf(hexToBytes(keyHex)), "AES-GCM", false, ["encrypt"]);
  const ctBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buf(hexToBytes(nonceHex)) },
    cryptoKey,
    buf(plaintext),
  );
  return new Uint8Array(ctBuffer);
}

/** AES-256-GCM decrypt raw bytes with a hex key + nonce. Exported for testing. */
export async function decryptBytes(
  ciphertext: Uint8Array,
  keyHex: string,
  nonceHex: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", buf(hexToBytes(keyHex)), "AES-GCM", false, ["decrypt"]);
  const ptBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf(hexToBytes(nonceHex)) },
    cryptoKey,
    buf(ciphertext),
  );
  return new Uint8Array(ptBuffer);
}

