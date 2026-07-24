import { useEffect } from "react";

import { tryNpubEncode } from "@/lib/safeNip19";

/**
 * A tiny module-level bus that lets any component request that the active chat
 * composer insert a NIP-27 mention (`nostr:npub1… `). Avoids threading an
 * insertion callback through the page → chat → composer tree.
 *
 * The composer subscribes via `useMentionInsertions`; callers (e.g. the member
 * list menu) fire `requestMention(pubkey)`.
 */
type MentionListener = (text: string) => void;

const listeners = new Set<MentionListener>();

/** Ask the active composer to insert a mention of `pubkey`. */
export function requestMention(pubkey: string): boolean {
  const npub = tryNpubEncode(pubkey);
  if (!npub) return false;
  const text = `nostr:${npub} `;
  for (const listener of listeners) listener(text);
  return listeners.size > 0;
}

/** Subscribe the active composer's insert function to mention requests. */
export function useMentionInsertions(insert: (text: string) => void) {
  useEffect(() => {
    listeners.add(insert);
    return () => {
      listeners.delete(insert);
    };
  }, [insert]);
}
