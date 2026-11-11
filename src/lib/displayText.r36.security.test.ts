/**
 * Security round 36 — display-guard follow-ups for `displayText`.
 *
 * Round 35 shipped the sanitizer; round 36 attacks it:
 *
 *  R36-D1 bidi / zero-width / soft-hyphen / invisible fillers never reach a
 *         rendered row (extended strip set),
 *  R36-D2 homoglyphs are NOT stripped — asserted on purpose so a future change
 *         is a deliberate decision, not an accident (documented accepted
 *         behaviour: a confusables table would mangle legitimate non-Latin
 *         court text and the trust decision never reads this string),
 *  R36-D3 over-stripping guard: emoji presentation selectors / keycaps survive,
 *  R36-D4 truncation never leaves a dangling combining mark or variation
 *         selector glued to the inserted ellipsis,
 *  R36-D5 the cap holds in CODE POINTS (surrogate pairs and ZWJ sequences),
 *  R36-D6 work is bounded by `maxChars`, not by input length (round 35 cleaned
 *         the whole string before capping it: a hostile multi-megabyte tag cost
 *         an O(n) pass + an O(n) array on every render).
 */
import { describe, expect, it } from "vitest";

import { sanitizeDisplayText, shortIdentifier } from "./displayText";

describe("R36-D1 — the extended invisible set", () => {
  it("strips soft hyphen, Mongolian vowel separator and invisible fillers", () => {
    // All of these render as NOTHING, so `a<invisible>b` looks exactly like
    // "ab" and two different values can be made to look identical.
    expect(sanitizeDisplayText("a\u00ADb")).toBe("ab");
    expect(sanitizeDisplayText("a\u180Eb")).toBe("ab");
    expect(sanitizeDisplayText("a\u3164b")).toBe("ab");
    expect(sanitizeDisplayText("a\uFFA0b")).toBe("ab");
    expect(sanitizeDisplayText("a\u2800b")).toBe("ab");
    expect(sanitizeDisplayText("a\u2065b")).toBe("ab");
  });

  it("strips a full Trojan-Source payload from a hostile outcome", () => {
    const hostile = "\u202Ebuyer\u2066 wins \u200B\u061C\uFEFF\u202C";
    const safe = sanitizeDisplayText(hostile);
    expect(safe).toBe("buyer wins");
    expect(
      Array.from(safe).some((char) => {
        const code = char.codePointAt(0) ?? 0;
        return (
          code === 0x00ad
          || (code >= 0x200b && code <= 0x200f)
          || (code >= 0x202a && code <= 0x202e)
          || (code >= 0x2060 && code <= 0x2069)
        );
      }),
    ).toBe(false);
  });
});

describe("R36-D2 — homoglyphs are accepted (documented)", () => {
  it("keeps a Cyrillic look-alike of a Latin outcome", () => {
    // ACCEPTED BEHAVIOUR. Stripping confusables would break legitimate
    // non-Latin titles, and nothing in the client makes a trust decision from
    // a display string. If this ever changes, it must be a deliberate decision
    // with a confusables table, not an edit to make the test pass.
    const homoglyph = "\u0423ES"; // Cyrillic capital U + "ES"
    expect(sanitizeDisplayText(homoglyph)).toBe("\u0423ES");
    // …and it is NOT equal to the Latin string a reader would assume.
    expect(sanitizeDisplayText(homoglyph)).not.toBe("YES");
  });
});

describe("R36-D3 — no over-stripping", () => {
  it("keeps emoji variation selectors and keycaps", () => {
    expect(sanitizeDisplayText("1\uFE0F\u20E3")).toBe("1\uFE0F\u20E3");
    expect(sanitizeDisplayText("\u2764\uFE0F")).toBe("\u2764\uFE0F");
  });

  it("keeps ordinary multi-script text, punctuation and spaces", () => {
    expect(sanitizeDisplayText("ΟΧΙ — 否决")).toBe("ΟΧΙ — 否决");
  });
});

describe("R36-D4 — truncation drops dangling combining marks", () => {
  it("drops trailing accents before adding the ellipsis", () => {
    const out = sanitizeDisplayText("a" + "\u0301".repeat(80), { maxChars: 8 });
    expect(out.endsWith("…")).toBe(true);
    const beforeEllipsis = Array.from(out).slice(0, -1);
    expect(beforeEllipsis).toEqual(["a"]);
    // Never longer than cap + the ellipsis.
    expect(Array.from(out).length).toBeLessThanOrEqual(9);
  });

  it("drops a trailing variation selector at the cut", () => {
    const out = sanitizeDisplayText("a".repeat(7) + "\uFE0F" + "b".repeat(10), { maxChars: 8 });
    expect(out).toBe("aaaaaaa…");
  });
});

describe("R36-D5 — the cap is counted in code points", () => {
  it("never splits a surrogate pair", () => {
    expect(sanitizeDisplayText("😀".repeat(10), { maxChars: 3 })).toBe("😀😀😀…");
  });

  it("never leaves a dangling zero-width joiner from a ZWJ emoji cluster", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const out = sanitizeDisplayText(family.repeat(4), { maxChars: 4 });
    expect(out.includes("\u200D")).toBe(false);
    expect(out.endsWith("…")).toBe(true);
  });

  it("caps shortIdentifier by code point too", () => {
    expect(shortIdentifier("\u202E" + "a".repeat(40), 8)).toBe("aaaaaaaa…");
    expect(Array.from(shortIdentifier("😀".repeat(40), 3)).length).toBe(4);
  });
});

describe("R36-D6 — bounded work (O(maxChars), not O(input))", () => {
  it("sanitises 20 MB far below any interactive budget", () => {
    const huge = "x".repeat(20_000_000);
    // Warm up so the measurement is about the loop, not the first JIT pass.
    sanitizeDisplayText(huge);
    const started = performance.now();
    const out = sanitizeDisplayText(huge, { maxChars: 64 });
    const elapsedMs = performance.now() - started;
    expect(out.length).toBe(65);
    // The round-35 implementation copied the whole string into an array first
    // (~O(n) at ~10-30 ms/MB); the single pass exits at the cap (~0.03 ms).
    // 20 ms leaves a >500x margin for a loaded CI box while still failing any
    // return of the unbounded pre-scan.
    expect(elapsedMs).toBeLessThan(20);
  });

  it("still bounds a huge hostile string of invisibles and controls", () => {
    const hostile = "\u202E\u200B\u0000".repeat(200_000);
    expect(sanitizeDisplayText(hostile)).toBe("");
  });
});
