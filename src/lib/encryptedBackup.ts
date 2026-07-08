import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sanitizeUrl } from '@/lib/sanitizeUrl';

/**
 * Helpers for Blossom-backed encrypted settings backups.
 *
 * The primary settings payload is still stored in the kind 30078 event's
 * NIP-44 encrypted `content`. As a redundant fallback, the ciphertext can be
 * uploaded to Blossom and referenced with a `['blossom', url, sha256]` tag.
 */

/** Compute the hex sha256 of a plaintext string. */
export function computeBackupHash(plaintext: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(plaintext)));
}

/** Build a File from an encrypted ciphertext string. */
export function createBackupFile(plaintext: string): File {
  const blob = new Blob([plaintext], { type: 'text/plain' });
  return new File([blob], '2140-settings-backup.txt', { type: 'text/plain' });
}

/** Build a `['blossom', url, sha256]` tag from an uploaded backup URL and plaintext. */
export function buildBlossomBackupTag(url: string, plaintext: string): string[] {
  return ['blossom', url, computeBackupHash(plaintext)];
}

/** Parse the Blossom backup tag from an event, if present and valid. */
export function parseBlossomBackupTag(tags: string[][]): { url: string; hash: string } | undefined {
  const tag = tags.find(([name]) => name === 'blossom');
  if (!tag?.[1] || !tag?.[2]) return undefined;
  const url = sanitizeUrl(tag[1]);
  if (!url) return undefined;
  return { url, hash: tag[2] };
}

/**
 * Fetch a Blossom-backed encrypted backup and verify its sha256 hash.
 * Returns the ciphertext as a string, or `null` if unavailable or invalid.
 */
export async function fetchEncryptedBackup(
  url: string,
  expectedHash: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;

    const text = await response.text();
    const actualHash = computeBackupHash(text);
    if (actualHash !== expectedHash) {
      console.warn('Encrypted backup hash mismatch');
      return null;
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    console.warn('Failed to fetch encrypted backup:', error);
    return null;
  }
}
