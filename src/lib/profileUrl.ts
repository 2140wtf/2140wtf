import { nip19 } from 'nostr-tools';
import type { NostrMetadata } from '@nostrify/nostrify';

/**
 * Generates the canonical profile URL for a user.
 *
 * Always uses the npub (`/npub1...`) as the canonical path because it is the
 * only stable, self-certifying identifier. NIP-05 identifiers can be changed,
 * expire, or be reassigned, so they are no longer used as canonical link paths.
 *
 * The app still *resolves* NIP-05 URLs (`/user@domain.com`) for backwards
 * compatibility and for the optional "short link" copy action, but any newly
 * generated navigation link uses the npub form.
 *
 * **Precondition:** `pubkey` must be a valid 64-char lowercase hex string.
 * Callers extracting pubkeys from tag content must validate with
 * `isNostrId` first (parse-layer responsibility).
 */
export function getProfileUrl(
  pubkey: string,
  _metadata?: NostrMetadata,
  _nip05Verified = false,
): string {
  return `/${nip19.npubEncode(pubkey)}`;
}
