import type { NostrMetadata } from '@nostrify/nostrify';
import { getProfileUrl } from '@/lib/profileUrl';

/**
 * Returns the canonical profile URL for a pubkey.
 *
 * Canonical links always use the npub path (`/npub1...`) because it is stable
 * and never changes. NIP-05 identifiers are still resolved by the router and
 * offered as an optional "short link" copy action, but they are not used as
 * canonical navigation URLs.
 */
export function useProfileUrl(pubkey: string, _metadata?: NostrMetadata): string {
  return getProfileUrl(pubkey);
}
