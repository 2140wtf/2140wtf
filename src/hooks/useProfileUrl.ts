import type { NostrMetadata } from '@nostrify/nostrify';
import { getProfileUrl } from '@/lib/profileUrl';

/**
 * Returns the canonical profile URL for a pubkey.
 *
 * Profile links are always generated as `/npub1...` because npubs are stable
 * and self-certifying. NIP-05 identifiers are still resolved for backwards
 * compatibility, but they are no longer used as canonical link paths.
 */
export function useProfileUrl(pubkey: string, _metadata?: NostrMetadata): string {
  return getProfileUrl(pubkey);
}
