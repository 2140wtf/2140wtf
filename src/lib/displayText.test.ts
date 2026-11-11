import { describe, expect, it } from "vitest";

import { sanitizeDisplayText, shortIdentifier } from "./displayText";

describe("sanitizeDisplayText", () => {
  it("keeps ordinary text intact", () => {
    expect(sanitizeDisplayText("case-1234")).toBe("case-1234");
    expect(sanitizeDisplayText("labour juror")).toBe("labour juror");
  });

  it("returns empty for non-strings and empty input", () => {
    expect(sanitizeDisplayText(undefined)).toBe("");
    expect(sanitizeDisplayText(null)).toBe("");
    expect(sanitizeDisplayText(42)).toBe("");
    expect(sanitizeDisplayText("   ")).toBe("");
  });

  it("strips bidi override / isolation characters (Trojan Source)", () => {
    const hostile = "case\u202Egnp.exe\u202C";
    const safe = sanitizeDisplayText(hostile);
    expect(safe).toBe("casegnp.exe");
    expect(safe).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/);
  });

  it("strips zero-width and BOM characters", () => {
    expect(sanitizeDisplayText("ca\u200Bse\uFEFF-1")).toBe("case-1");
  });

  it("replaces control characters and collapses whitespace to one line", () => {
    expect(sanitizeDisplayText("a\u0000b\u0007c\n\n\td")).toBe("a b c d");
    expect(sanitizeDisplayText("a\u009Fb")).toBe("a b");
  });

  it("caps by code point and never splits a surrogate pair", () => {
    const capped = sanitizeDisplayText("😀".repeat(10), { maxChars: 3 });
    expect(capped).toBe("😀😀😀…");
    expect(Array.from(capped).length).toBe(4);
  });

  it("bounds a megabyte string cheaply", () => {
    const huge = "x".repeat(1_000_000);
    expect(sanitizeDisplayText(huge).length).toBe(65);
  });
});

describe("shortIdentifier", () => {
  it("shortens long ids and leaves short ones alone", () => {
    expect(shortIdentifier("abc", 5)).toBe("abc");
    expect(shortIdentifier("a".repeat(40), 8)).toBe("aaaaaaaa…");
  });

  it("sanitises before shortening", () => {
    expect(shortIdentifier("\u202E" + "a".repeat(40), 4)).toBe("aaaa…");
  });

  it("returns empty for hostile-only input", () => {
    expect(shortIdentifier("\u202E\u0000")).toBe("");
    expect(shortIdentifier(undefined)).toBe("");
  });
});
