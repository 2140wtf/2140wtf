import { CustomEmojiImg } from "@/components/chat/CustomEmoji";

import type { ReactNode } from "react";

/** Regex matching `:shortcode:` patterns in text. */
const SHORTCODE_REGEX = /:([a-zA-Z0-9_-]+):/g;

/** Replaces `:shortcode:` patterns in text with inline custom emoji images. */
export function emojify(
  text: string,
  emojiMap: Map<string, string>,
  imgClassName?: string,
): ReactNode[] {
  if (emojiMap.size === 0) return [text];

  const result: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  SHORTCODE_REGEX.lastIndex = 0;

  while ((match = SHORTCODE_REGEX.exec(text)) !== null) {
    const [fullMatch, shortcode] = match;
    const url = emojiMap.get(shortcode);

    if (!url) continue;

    if (match.index > lastIndex) {
      result.push(text.substring(lastIndex, match.index));
    }

    result.push(
      <CustomEmojiImg
        key={`emoji-${match.index}`}
        name={shortcode}
        url={url}
        className={imgClassName}
      />,
    );

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    result.push(text.substring(lastIndex));
  }

  return result.length > 0 ? result : [text];
}
