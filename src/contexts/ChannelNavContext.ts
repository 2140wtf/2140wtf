import { createContext } from "react";

/**
 * A hashtag typed in chat (e.g. `#random`) should, when it names a channel in
 * the current server/community, navigate to that local channel rather than
 * linking out to Ditto's global hashtag feed. This context lets the chat pages
 * (NIP-29 / Concord V1 / V2) publish a name→navigation resolver that
 * {@link ChatContent} consults when rendering a `#tag` token.
 *
 * The resolver returns a click handler when a local channel matches the tag, or
 * `null` when none does (the renderer then falls back to the Ditto link).
 */
export interface ChannelNavValue {
  /**
   * Resolve a bare hashtag (no leading `#`) to a navigation handler for the
   * matching local channel, or `null` when the current scope has no such
   * channel. Matching is case-insensitive and slug-aware (a channel named
   * "Off Topic" matches `#off-topic`).
   */
  resolveChannelByName: (tag: string) => (() => void) | null;
}

export const ChannelNavContext = createContext<ChannelNavValue | undefined>(undefined);

/**
 * Normalize a channel name or hashtag for comparison: lowercase, trim, and
 * collapse any run of non-alphanumeric characters to a single hyphen (so
 * "Off Topic" / "off_topic" / "off-topic" all compare equal to `#off-topic`).
 */
export function normalizeChannelKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
