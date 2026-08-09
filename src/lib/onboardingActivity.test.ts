import type { NostrEvent } from "@nostrify/nostrify";
import { describe, expect, it, vi } from "vitest";
import { APP_CURATED_FEED_RELAYS } from "@/lib/appRelays";
import {
  fetchActiveOnboardingPubkeys,
  type RelayGroupProvider,
} from "@/lib/onboardingActivity";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const OUTSIDER = "c".repeat(64);
const NOW = 2_000_000_000;

function event(pubkey: string, createdAt: number, kind = 1): NostrEvent {
  return {
    id: `${pubkey[0]}${createdAt}`.padEnd(64, "0").slice(0, 64),
    pubkey,
    created_at: createdAt,
    kind,
    tags: [],
    content: "hello",
    sig: "0".repeat(128),
  };
}

describe("fetchActiveOnboardingPubkeys", () => {
  it("uses discovery relays and returns only recent candidate posts", async () => {
    const query = vi.fn(async () => [
      event(ALICE, NOW - 60),
      event(BOB, NOW - 30),
      event(ALICE, NOW - 10),
      event(OUTSIDER, NOW - 5),
      event(BOB, NOW - 90_000),
      event(BOB, NOW - 1, 0),
      event(BOB, NOW + 1),
    ]);
    const group = vi.fn(() => ({ query }));
    const nostr: RelayGroupProvider = { group };
    const controller = new AbortController();

    const result = await fetchActiveOnboardingPubkeys(
      nostr,
      [ALICE, BOB],
      NOW,
      controller.signal,
    );

    expect(group).toHaveBeenCalledWith(APP_CURATED_FEED_RELAYS);
    expect(query).toHaveBeenCalledWith([{
      kinds: [1],
      authors: [ALICE, BOB],
      since: NOW - 86_400,
      limit: 200,
    }], { signal: controller.signal });
    expect(result).toEqual([ALICE, BOB]);
  });
});
