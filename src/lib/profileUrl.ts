import { nip19 } from 'nostr-tools';
import type { NostrMetadata } from '@nostrify/nostrify';

/**
 * Generates the profile URL for a user.
 *
 * Uses the verified NIP-05 identifier as the URL path when available, because
 * it is human-readable. If the NIP-05 is not verified (or not present), the
 * URL falls back to the stable npub so an attacker cannot hijack profile links
 * by claiming someone else's identifier.
 *
 * The app also *resolves* npub URLs (`/npub1...`) and raw-hex pubkeys, so both
 * forms always lead to the same profile page.
 *
 * `_@domain.com` users link to `/domain.com` — the profile page detects
 * bare domains as NIP-05 identifiers and resolves them correctly.
 *
 * **Precondition:** `pubkey` must be a valid 64-char lowercase hex string.
 * Callers extracting pubkeys from tag content must validate with
 * `isNostrId` first (parse-layer responsibility).
 */
export function getProfileUrl(
  pubkey: string,
  metadata?: NostrMetadata,
  nip05Verified = false,
): string {
  if (nip05Verified && metadata?.nip05) {
    const nip05 = metadata.nip05;
    // _@domain.com → /domain.com (the profile page detects bare domains as NIP-05)
    if (nip05.startsWith('_@')) {
      return `/${nip05.slice(2)}`;
    }
    // user@domain.com → /user@domain.com
    return `/${nip05}`;
  }
  return `/${nip19.npubEncode(pubkey)}`;
}
