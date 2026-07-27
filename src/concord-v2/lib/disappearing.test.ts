import { beforeEach, describe, expect, it } from "vitest";

import {
  DISAPPEAR_OPTIONS,
  expirationOf,
  getDisappearTtl,
  isExpired,
  setDisappearTtl,
  ttlBadge,
  ttlOf,
} from "@/concord-v2/lib/disappearing";

describe("disappearing messages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("offers the ₿AO ladder", () => {
    expect(DISAPPEAR_OPTIONS.map((o) => o.secs)).toEqual([
      60, 21 * 60, 3600, 4 * 3600, 12 * 3600, 21 * 3600, 3 * 86400, 7 * 86400,
    ]);
  });

  it("persists the per-channel timer", () => {
    expect(getDisappearTtl("aa")).toBeUndefined();
    setDisappearTtl("aa", 1260);
    expect(getDisappearTtl("aa")).toBe(1260);
    // A different channel is independent.
    expect(getDisappearTtl("bb")).toBeUndefined();
    setDisappearTtl("aa", undefined);
    expect(getDisappearTtl("aa")).toBeUndefined();
  });

  it("ignores junk in storage", () => {
    localStorage.setItem("concord2:disappear:cc", "not-a-number");
    expect(getDisappearTtl("cc")).toBeUndefined();
    localStorage.setItem("concord2:disappear:cc", "-5");
    expect(getDisappearTtl("cc")).toBeUndefined();
  });

  it("parses expiration tags", () => {
    expect(expirationOf([["expiration", "2000"]])).toBe(2000);
    expect(expirationOf([["p", "abc"]])).toBeUndefined();
    expect(expirationOf([["expiration", "soon"]])).toBeUndefined();
  });

  it("detects expiry", () => {
    const tags = [["expiration", "2000"]];
    expect(isExpired(tags, 1999)).toBe(false);
    expect(isExpired(tags, 2000)).toBe(true);
    expect(isExpired([["p", "abc"]], 9999)).toBe(false);
  });

  it("derives the original TTL and formats the badge", () => {
    expect(ttlOf([["expiration", "2000"]], 1000)).toBe(1000);
    expect(ttlOf([["expiration", "500"]], 1000)).toBeUndefined(); // skewed clock
    expect(ttlBadge(60)).toBe("1m");
    expect(ttlBadge(1260)).toBe("21m");
    expect(ttlBadge(14400)).toBe("4h");
    expect(ttlBadge(604800)).toBe("7d");
  });
});
