import { parseFileMessageTags, parseImetaMap } from "@/lib/imeta";
import { IMAGE_URL_REGEX } from "@/lib/mediaUrls";

/** NIP-17 file-message rumor kind (Armada's lib/nip17/protocol; not ported). */
export const KIND_DM_FILE = 15;

import type { ChatMsg } from "@/components/chat/transport";
import type { EncryptedRef } from "@/hooks/useResolvedMediaSrc";

/**
 * Extract the id of the message this event *inline*-replies to via NIP-10
 * marked `e` tags (Signal/Discord style — quoted in the timeline). Used by
 * NIP-29, whose inline replies are NIP-10. Concord inline replies use a NIP-C7
 * `q` tag instead (see the per-page reply-context resolvers); thread replies
 * are a separate mechanism that never renders in the timeline.
 */
export function getReplyToId(event: ChatMsg): string | undefined {
  const replyTag = event.tags.find(([name, , , marker]) => name === "e" && marker === "reply");
  if (replyTag) return replyTag[1];
  const rootTag = event.tags.find(([name, , , marker]) => name === "e" && marker === "root");
  return rootTag?.[1];
}

/**
 * The id of the message a Concord event *inline*-replies to (a NIP-C7 `q` tag).
 * Concord threads are kind-1111 comments (never in the timeline) and Concord
 * inline replies are kind-9 with a `q`, so on a rendered top-level Concord row a
 * `q` means "inline reply to this rumor".
 */
export function getQuoteReplyToId(event: ChatMsg): string | undefined {
  return event.tags.find(([name]) => name === "q")?.[1];
}

/**
 * A one-line preview of a message's body for the reply-context line: URLs are
 * collapsed to 📎 (they'd blow out the line), and an all-URL/empty body falls
 * back to 📎. Shared so NIP-29 and Concord previews read identically.
 *
 * Prefer {@link ReplyPreview} (a node) where mentions should resolve to
 * `@name`; this plain-string form is the fallback for contexts that need a
 * bare string.
 */
export function replyPreviewText(content: string): string {
  return content.replace(/https?:\/\/\S+/g, "📎").trim() || "📎";
}

/**
 * The first image attachment of a message, as a media ref for a preview
 * thumbnail — or undefined if the message has no image. Prefers an imeta entry
 * declaring an image MIME (carries the decryption params for Concord's
 * encrypted Blossom blobs), else the first inline image URL by extension.
 */
export function firstImageRef(event: ChatMsg): EncryptedRef | undefined {
  // NIP-17 kind-15 file messages carry the blob URL in content and the
  // file/encryption metadata in top-level tags (no imeta) — synthesize the
  // entry so its decryption key rides into the thumbnail ref.
  if (event.kind === KIND_DM_FILE) {
    const fileEntry = parseFileMessageTags(event.content.trim(), event.tags);
    if (fileEntry && (fileEntry.mime?.startsWith("image/") || IMAGE_URL_REGEX.test(fileEntry.url))) {
      return { url: fileEntry.url, encryption: fileEntry.encryption, mime: fileEntry.mime };
    }
  }
  const imeta = parseImetaMap(event.tags);
  for (const entry of imeta.values()) {
    const isImage = entry.mime?.startsWith("image/") || IMAGE_URL_REGEX.test(entry.url);
    if (isImage) return { url: entry.url, encryption: entry.encryption, mime: entry.mime };
  }
  const inline = event.content.match(IMAGE_URL_REGEX)?.[0];
  return inline ? { url: inline } : undefined;
}
