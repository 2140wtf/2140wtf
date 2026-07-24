import type { NostrEvent } from "@nostrify/nostrify";

/**
 * Reaction helpers — PHASE 1 STUB.
 *
 * Armada's `hooks/useReactions.ts` is a full NIP-25 tally/publish hook (332
 * LOC) that phase 2 ports together with the shared chat UI. The ₿AO chat
 * foundation (Concord V2 chat codec + the wire's notify candidates) only
 * needs these pure normalizers, so they live here now at the same import path
 * phase 2's code expects. Phase 2 will extend this file with the hook itself.
 */

/**
 * NIP-30 custom-emoji tag for a reaction: when the content is a `:shortcode:`
 * with an image URL, the pill renders the image via an `["emoji", code, url]`
 * tag. Native/unicode reactions carry no extra tag.
 */
export function customEmojiReactionTags(content: string, emojiUrl?: string): string[][] {
  if (emojiUrl && content.startsWith(":") && content.endsWith(":")) {
    return [["emoji", content.slice(1, -1), emojiUrl]];
  }
  return [];
}

/** Normalize a kind 7 reaction's content into a display key. */
export function reactionKey(event: NostrEvent): string {
  return reactionContentKey(event.content);
}

/** Normalize raw reaction content into a display key (`+`/`` → 👍, `-` → 👎). */
export function reactionContentKey(content: string): string {
  if (content === "+" || content === "") return "👍";
  if (content === "-") return "👎";
  return content;
}
