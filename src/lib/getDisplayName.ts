import type { NostrMetadata } from '@nostrify/nostrify';

import { genUserName } from '@/lib/genUserName';

/**
 * Get a display name for a user.
 * Prefers metadata.name, falls back to metadata.display_name, then a
 * stable npub-derived fallback (genUserName → "Anon-<last 5 of npub>").
 * Visual truncation is handled by CSS (`truncate` class) on
 * the containing element to avoid breaking NIP-30 custom emoji shortcodes.
 */
export function getDisplayName(
  metadata: NostrMetadata | undefined,
  pubkey?: string,
): string {
  return metadata?.name || metadata?.display_name || (pubkey ? genUserName(pubkey) : 'Anonymous');
}

/**
 * A distinguishable fallback for a nameless pubkey, derived from the npub
 * ("Anon-<last 5 of npub>"). Chat surfaces use this instead of "Anonymous" so
 * a busy room of nameless members still reads as distinct people. Stable per key.
 */
export function getKeyedFallbackName(pubkey: string): string {
  return genUserName(pubkey);
}
