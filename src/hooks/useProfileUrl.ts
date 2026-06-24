import type { NostrMetadata } from '@nostrify/nostrify';
import { getProfileUrl } from '@/lib/profileUrl';
import { useNip05Verify } from '@/hooks/useNip05Verify';

/**
 * Returns the canonical profile URL for a pubkey, using the NIP-05 identifier
 * as the path only when it has been verified against the pubkey.
 *
 * Falls back to the npub URL when:
 * - No metadata is available
 * - The NIP-05 has not been verified yet
 * - Verification failed
 *
 * Npub URLs (`/npub1...`) are always available as a stable alternative via the
 * profile's "Copy link" menu and resolve to the same profile page.
 *
 * TanStack Query deduplicates requests, so calling this hook alongside
 * useNip05Verify or Nip05Badge for the same pubkey incurs no extra network cost.
 */
export function useProfileUrl(pubkey: string, metadata?: NostrMetadata): string {
  const nip05 = metadata?.nip05;
  const { data: nip05Verified } = useNip05Verify(nip05, pubkey);
  return getProfileUrl(pubkey, metadata, nip05Verified === true);
}
