import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Checks if a string is a NIP-30 custom emoji shortcode (`:shortcode:` format).
 */
export function isCustomEmoji(content: string): boolean {
  return /^:[a-zA-Z0-9_-]+:$/.test(content);
}

/**
 * Whether a reaction key is renderable as a pill glyph. Guards against junk
 * reactions such as a raw URL pasted as the content (which have no `:shortcode:`
 * form and no `emoji` image tag) rendering as a long line of text. A key is
 * renderable when it's either a NIP-30 custom emoji shortcode with a resolved
 * image URL, or a short unicode glyph (no whitespace, no URL, and only a couple
 * of code points long).
 */
export function isRenderableReactionKey(key: string, url?: string): boolean {
  if (isCustomEmoji(key)) return Boolean(url);
  if (!key) return false;
  // Reject anything that looks like a URL or contains whitespace/newlines.
  if (/\s/.test(key) || /^\w+:\/\//.test(key) || /^(www\.|https?:)/i.test(key)) return false;
  // A genuine emoji is at most a few code points (e.g. flags, ZWJ sequences);
  // anything longer is almost certainly junk text.
  return [...key].length <= 8;
}

/**
 * Extracts the custom emoji URL from a NostrEvent's tags for a given shortcode.
 * The shortcode should include the colons (e.g., `:soapbox:`).
 */
export function getCustomEmojiUrl(shortcode: string, tags: string[][]): string | undefined {
  const name = shortcode.slice(1, -1); // Remove surrounding colons
  const emojiTag = tags.find(([tagName, tagShortcode]) => tagName === 'emoji' && tagShortcode === name);
  return emojiTag?.[2];
}

/**
 * Build NIP-30 `["emoji", shortcode, url]` tags for every `:shortcode:` in
 * `content` that matches one of the given custom emojis (one tag per unique
 * shortcode). Shared by the chat composer and the status dialog so anything
 * that publishes user-typed text attaches the same emoji tags.
 */
export function collectEmojiTags(
  content: string,
  emojis: Array<{ shortcode: string; url: string }>,
): string[][] {
  if (emojis.length === 0) return [];
  const emojiMap = new Map(emojis.map((e) => [e.shortcode, e.url]));
  const shortcodeRegex = /:([a-zA-Z0-9_-]+):/g;
  const used = new Set<string>();
  const tags: string[][] = [];
  let match;
  while ((match = shortcodeRegex.exec(content)) !== null) {
    const shortcode = match[1];
    if (emojiMap.has(shortcode) && !used.has(shortcode)) {
      used.add(shortcode);
      tags.push(["emoji", shortcode, emojiMap.get(shortcode)!]);
    }
  }
  return tags;
}

/**
 * Builds a map of shortcode -> URL from an event's emoji tags.
 */
export function buildEmojiMap(tags: string[][]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of tags) {
    if (tag[0] === 'emoji' && tag[1] && tag[2]) {
      map.set(tag[1], tag[2]);
    }
  }
  return map;
}

/**
 * Represents a resolved reaction emoji that can be rendered.
 * For custom emojis, includes the URL; for unicode, just the content string.
 */
export interface ResolvedEmoji {
  /** The display content — unicode emoji string or `:shortcode:` */
  content: string;
  /** For custom emojis, the image URL. Undefined for unicode emojis. */
  url?: string;
  /** For custom emojis, the shortcode name (without colons). */
  name?: string;
}

/**
 * Checks whether a kind 7 reaction event is valid.
 * Custom emoji reactions (`:shortcode:` content) are invalid without a matching `emoji` tag.
 */
export function isValidReaction(event: NostrEvent): boolean {
  const content = event.content.trim();
  const emoji = (content === '+' || content === '') ? '+' : content;
  if (isCustomEmoji(emoji)) {
    return getCustomEmojiUrl(emoji, event.tags) !== undefined;
  }
  return true;
}

/**
 * Resolves a reaction emoji from a kind 7 event into a ResolvedEmoji.
 * Returns `undefined` for malformed custom emoji reactions (missing emoji tag).
 */
export function resolveReactionEmoji(event: NostrEvent): ResolvedEmoji | undefined {
  const content = event.content.trim();
  const emoji = (content === '+' || content === '') ? '👍' : content === '-' ? '👎' : content;

  if (isCustomEmoji(emoji)) {
    const url = getCustomEmojiUrl(emoji, event.tags);
    if (url) {
      return { content: emoji, url, name: emoji.slice(1, -1) };
    }
    // Malformed: custom emoji shortcode without a matching emoji tag
    return undefined;
  }

  return { content: emoji };
}
