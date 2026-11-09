/**
 * Security round 1 — kind-8 badge spoofing repro tests for useJurorBadges.
 *
 * NIP-58 badge ACCEPTANCE (kind 8) is published by the badge holder
 * themselves. The hook matches events by the `d` tag carrying the juror
 * pubkey; before the fix it accepted ANY kind-8 event with a matching d-tag
 * regardless of `event.pubkey`, so an attacker could publish a kind-8 with
 * someone else's pubkey in the d-tag and mint them a court badge they never
 * earned. The fix requires the acceptance to be self-published
 * (`event.pubkey === jurorPubkey`).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import type { NostrEvent } from "@nostrify/nostrify";

import { NIP58_BADGE_ACCEPTED_KIND, useJurorBadges } from "./useJurorBadges";

let queryEvents: NostrEvent[] = [];

vi.mock("@nostrify/nostrify", () => {
  class MockNRelay1 {
    constructor(_url: string) {}
    async query() {
      // Small delay so the post-query state (not the initial []) is what
      // waitFor observes — a spoofed event must NOT end up in the list.
      await new Promise((r) => setTimeout(r, 20));
      return queryEvents;
    }
    async close() {}
  }
  return { NRelay1: MockNRelay1 };
});

const JUROR = "a".repeat(64);
const ATTACKER = "b".repeat(64);

let seq = 0;
function kind8(opts: {
  dTag: string;
  pubkey: string;
  aTag?: string;
  nameTag?: string;
}): NostrEvent {
  seq += 1;
  const tags: string[][] = [["d", opts.dTag]];
  if (opts.aTag) tags.push(["a", opts.aTag]);
  if (opts.nameTag) tags.push(["name", opts.nameTag]);
  return {
    kind: NIP58_BADGE_ACCEPTED_KIND,
    created_at: 1_700_000_000 + seq,
    tags,
    content: "",
    pubkey: opts.pubkey,
    id: `kind8-${seq}`,
    sig: "f".repeat(128),
  };
}

beforeEach(() => {
  queryEvents = [];
  vi.clearAllMocks();
});

describe("kind-8 badge spoofing", () => {
  it("rejects an acceptance event published by anyone other than the juror", async () => {
    queryEvents = [
      kind8({ dTag: JUROR, pubkey: ATTACKER, aTag: "30009:labour-juror" }),
    ];
    const { result } = renderHook(() => useJurorBadges(JUROR));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(result.current).toEqual([]);
  });

  it("accepts a self-published acceptance event by the juror", async () => {
    queryEvents = [
      kind8({ dTag: JUROR, pubkey: JUROR, aTag: "30009:labour-juror" }),
    ];
    const { result } = renderHook(() => useJurorBadges(JUROR));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]!.name).toBe("labour-juror");
  });

  it("matches the juror pubkey case-insensitively", async () => {
    queryEvents = [
      kind8({ dTag: JUROR.toUpperCase(), pubkey: JUROR.toUpperCase(), aTag: "30009:labour-juror" }),
    ];
    const { result } = renderHook(() => useJurorBadges(JUROR));
    await waitFor(() => expect(result.current).toHaveLength(1));
  });

  it("does not leak another juror's badge into this juror's list", async () => {
    queryEvents = [
      kind8({ dTag: ATTACKER, pubkey: ATTACKER, aTag: "30009:labour-juror" }),
    ];
    const { result } = renderHook(() => useJurorBadges(JUROR));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(result.current).toEqual([]);
  });
});
