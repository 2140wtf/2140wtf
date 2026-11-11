/**
 * Security round 35 — kind-8 badge display, second pass.
 *
 * The round-1 fix pinned self-publication (`event.pubkey === juror`). This
 * round attacks the remaining surface:
 *
 *  R35-B1 a standard NIP-58 `a` tag (`30009:<author-pubkey>:<identifier>`)
 *         must display the IDENTIFIER — the old parser showed the badge
 *         author's pubkey as the badge name,
 *  R35-B2 a hostile `a` tag with bidi/control characters or a megabyte-long
 *         identifier must not reach the DOM (sanitised + capped),
 *  R35-B3 a large badge flood is capped (memory + DOM),
 *  R35-B4 one badge name is not duplicated into 10k rows (dedupe by name),
 *  R35-B5 a badge whose definition is never fetched is still labelled
 *         self-reported (the hook never implies a court award),
 *  R35-B6 a deleted/revoked acceptance is simply absent once the relay stops
 *         serving it (documented accepted behaviour — no client-side expiry).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

import type { NostrEvent } from "@nostrify/nostrify";

import {
  MAX_BADGES,
  NIP58_BADGE_ACCEPTED_KIND,
  badgeNameFromEvent,
  useJurorBadges,
} from "./useJurorBadges";

let queryEvents: NostrEvent[] = [];

vi.mock("@nostrify/nostrify", () => {
  class MockNRelay1 {
    constructor(_url: string) {}
    async query() {
      await new Promise((r) => setTimeout(r, 10));
      return queryEvents;
    }
    async close() {}
  }
  return { NRelay1: MockNRelay1 };
});

const JUROR_SECRET = generateSecretKey();
const JUROR = getPublicKey(JUROR_SECRET);
const BADGE_AUTHOR = "b".repeat(64);

let seq = 0;
function kind8(tags: string[][], createdAt?: number): NostrEvent {
  seq += 1;
  return finalizeEvent(
    {
      kind: NIP58_BADGE_ACCEPTED_KIND,
      created_at: createdAt ?? 1_700_000_000 + seq,
      tags: [["d", JUROR], ...tags],
      content: "",
    },
    JUROR_SECRET,
  ) as unknown as NostrEvent;
}

beforeEach(() => {
  queryEvents = [];
  vi.clearAllMocks();
});

describe("R35-B1 — NIP-58 a-tag parsing", () => {
  it("uses the identifier, not the badge author's pubkey, from a standard a tag", () => {
    const name = badgeNameFromEvent(kind8([["a", `30009:${BADGE_AUTHOR}:labour-juror`]]));
    expect(name).toBe("labour-juror");
    expect(name).not.toBe(BADGE_AUTHOR);
  });

  it("keeps the court's 2-segment shorthand working", () => {
    expect(badgeNameFromEvent(kind8([["a", "30009:labour-juror"]]))).toBe("labour-juror");
  });

  it("falls back to the name tag when there is no usable a tag", () => {
    expect(badgeNameFromEvent(kind8([["a", "30009:"], ["name", "appeal-juror"]]))).toBe(
      "appeal-juror",
    );
  });

  it("ignores non-30009 a tags (they are addresses, not badge definitions)", () => {
    expect(badgeNameFromEvent(kind8([["a", "39007:abc"]], 1_700_000_000))).toBeNull();
  });
});

describe("R35-B2 — hostile a-tag values are sanitised", () => {
  it("strips bidi override characters (Trojan Source)", () => {
    const hostile = kind8([["a", `30009:${BADGE_AUTHOR}:labour\u202Ee-\u202Djuror`]]);
    const name = badgeNameFromEvent(hostile)!;
    expect(name).toBe("laboure-juror");
    expect(name).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });

  it("strips C0/C1 controls and caps length", () => {
    const name = badgeNameFromEvent(
      kind8([["a", `30009:${"x".repeat(500)}\u0000\u0007`]]),
    )!;
    expect(name.length).toBeLessThanOrEqual(65); // 64 + ellipsis
    const hasControl = Array.from(name).some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    });
    expect(hasControl).toBe(false);
  });

  it("returns null for a name made only of controls", () => {
    expect(badgeNameFromEvent(kind8([["a", "30009:\u202E\u0000"], ["name", "\u202D"]]))).toBeNull();
  });
});

describe("R35-B3/B4 — flood and duplicate handling", () => {
  it("caps a large badge flood at MAX_BADGES distinct names", async () => {
    // 1k signed events (a relay may return far more than its `limit`); the
    // cap is count-independent, and signing 10k events in a unit test costs
    // ~15s for no extra coverage.
    const flood: NostrEvent[] = [];
    for (let i = 0; i < 1_000; i += 1) {
      flood.push(kind8([["a", `30009:badge-${i % 100}`]], 1_700_000_000 + i));
    }
    queryEvents = flood;
    const { result } = renderHook(() => useJurorBadges(JUROR));
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(result.current.length).toBeLessThanOrEqual(MAX_BADGES);
    // The 100 distinct names are deduped, then capped - never 10k rows.
    const names = result.current.map((badge) => badge.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the newest observation of a duplicated badge name", async () => {
    queryEvents = [
      kind8([["a", "30009:labour-juror"]], 1_700_000_000),
      kind8([["a", "30009:labour-juror"]], 1_700_000_500),
    ];
    const { result } = renderHook(() => useJurorBadges(JUROR));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]!.awardedAt).toBe(1_700_000_500);
  });
});

describe("R35-B5/B6 — accepted behaviors", () => {
  it("never verifies the badge definition: the surface is self-reported only", async () => {
    // A forged definition address is accepted exactly as "the juror claims
    // this badge"; the UI labels the whole block self-reported.
    queryEvents = [kind8([["a", `30009:${"f".repeat(64)}:fabricated-badge`]])];
    const { result } = renderHook(() => useJurorBadges(JUROR));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]!.name).toBe("fabricated-badge");
  });

  it("drops a revoked acceptance as soon as the relay stops serving it", async () => {
    queryEvents = [kind8([["a", "30009:labour-juror"]])];
    const first = renderHook(() => useJurorBadges(JUROR));
    await waitFor(() => expect(first.result.current).toHaveLength(1));
    first.unmount();

    queryEvents = [];
    const second = renderHook(() => useJurorBadges(JUROR));
    await waitFor(() => expect(second.result.current).toHaveLength(0));
  });
});
