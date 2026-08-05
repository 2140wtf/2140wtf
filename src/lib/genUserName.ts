import { nip19 } from 'nostr-tools';

import { isNostrId } from '@/lib/nostrId';

/**
 * Generate a short, stable display fallback for a pubkey when no profile is
 * available: `Anon-<last 5 of npub>`. Deterministic per key, so a nameless
 * participant reads as the same person across relays, sessions, and chat
 * surfaces (instead of the misleading "Anonymous", which collides for
 * everyone). Derived from the npub so it carries a checksum fragment.
 */
export function genUserName(pubkey: string): string {
  const npub = isNostrId(pubkey) ? nip19.npubEncode(pubkey) : undefined;
  return npub ? `Anon-${npub.slice(-5)}` : 'Anon-?????';
}
