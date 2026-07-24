import { describe, expect, it } from "vitest";

import { customEmojiReactionTags } from "@/hooks/useReactions";

describe("customEmojiReactionTags", () => {
  it("emits an emoji tag for a :shortcode: with a url", () => {
    expect(customEmojiReactionTags(":pepe:", "https://e/pepe.png")).toEqual([
      ["emoji", "pepe", "https://e/pepe.png"],
    ]);
  });

  it("returns no tags for a unicode/native reaction", () => {
    expect(customEmojiReactionTags("👍")).toEqual([]);
    expect(customEmojiReactionTags("+")).toEqual([]);
  });

  it("returns no tags for a :shortcode: without a url", () => {
    expect(customEmojiReactionTags(":pepe:")).toEqual([]);
  });

  it("returns no tags when content isn't shortcode-delimited", () => {
    expect(customEmojiReactionTags("pepe", "https://e/pepe.png")).toEqual([]);
  });
});
