import type { NostrMetadata } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

/**
 * Get a display name for a user.
 * Prefers metadata.name, falls back to metadata.display_name, then
 * "Anonymous". Visual truncation is handled by CSS (`truncate` class) on
 * the containing element to avoid breaking NIP-30 custom emoji shortcodes.
 */
export function getDisplayName(
  metadata: NostrMetadata | undefined,
  _pubkey?: string,
): string {
  return metadata?.name || metadata?.display_name || 'Anonymous';
}

/**
 * A distinguishable fallback for a nameless pubkey, derived from the npub
 * ("anon-j4gslmfz"). Chat surfaces use this instead of "Anonymous" so a busy
 * room of nameless members still reads as distinct people. Stable per key.
 */
export function getKeyedFallbackName(pubkey: string): string {
  try {
    return `anon-${nip19.npubEncode(pubkey).slice(5, 13)}`;
  } catch {
    return 'Anonymous';
  }
}
