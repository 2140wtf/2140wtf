import type { NostrEvent } from '@nostrify/nostrify';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { isAllowedBlossomUrl } from '@/lib/sanitizeUrl';

const SHA256_HEX = /^[a-f0-9]{64}$/;
const MAX_NSITE_PATH_LENGTH = 2048;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

/** Return true only for canonical absolute paths safe to use as manifest keys. */
export function isSafeNsitePath(path: string | undefined): path is string {
  if (!path || path.length > MAX_NSITE_PATH_LENGTH) return false;
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (path.includes('\\') || containsControlCharacter(path)) return false;
  if (/(^|\/)\.\.?($|\/)/.test(path) || path.includes('?') || path.includes('#')) return false;

  try {
    const decoded = decodeURIComponent(path);
    if (decoded.includes('\\') || containsControlCharacter(decoded)) return false;
    if (/(^|\/)\.\.?($|\/)/.test(decoded)) return false;

    const parsed = new URL(path, 'https://nsite.invalid');
    return parsed.origin === 'https://nsite.invalid' && parsed.pathname === path;
  } catch {
    return false;
  }
}

/** Return true only for a lowercase SHA-256 hex digest. */
export function isNsiteHash(value: string | undefined): value is string {
  return !!value && SHA256_HEX.test(value);
}

/** Build a trusted path-to-hash manifest from an nsite event. */
export function buildNsiteManifest(event: NostrEvent): Map<string, string> {
  const manifest = new Map<string, string>();
  for (const tag of event.tags) {
    if (tag[0] === 'path' && isSafeNsitePath(tag[1]) && isNsiteHash(tag[2])) {
      manifest.set(tag[1], tag[2]);
    }
  }
  return manifest;
}

function deduplicateServers(servers: string[]): string[] {
  const seen = new Set<string>();
  return servers.filter((server) => {
    const key = server.toLowerCase().replace(/\/+$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Resolve only safe HTTPS, public Blossom servers from event/app configuration. */
export function resolveNsiteServers(event: NostrEvent, appServers: string[]): string[] {
  const eventServers = event.tags
    .filter(([name]) => name === 'server')
    .map(([, url]) => url)
    .filter((url): url is string => isAllowedBlossomUrl(url));

  const trustedAppServers = appServers.filter((url) => isAllowedBlossomUrl(url));
  return deduplicateServers(eventServers.length > 0 ? eventServers : trustedAppServers);
}

/** Verify that a fetched blob matches the hash committed in the nsite manifest. */
export function verifyNsiteContent(body: Uint8Array, expectedHash: string): boolean {
  return isNsiteHash(expectedHash) && bytesToHex(sha256(body)) === expectedHash;
}
