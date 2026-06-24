import { nip19 } from 'nostr-tools';
import type { NostrMetadata } from '@nostrify/nostrify';

/**
 * Generates the profile URL for a user.
 *
 * Links are always produced as `/npub1...` because an npub is a stable,
 * self-certifying identifier that never changes. NIP-05 identifiers can be
 * lost, expire, or be claimed by someone else, so they are no longer used as
 * canonical link paths.
 *
 * The app still *resolves* NIP-05 URLs (e.g. `/user@domain.com`) for
 * backwards compatibility and external sharing, but newly generated links
 * always use the npub form.
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
