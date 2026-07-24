import { describe, expect, it } from "vitest";

import { inviteDeliveryRelays, recipientInboxRelays } from "@/concord-v2/lib/inviteRelays";
import { STOCK_RELAYS } from "@/concord-v2/lib/invite";
import { normalizeRelayUrl } from "@/lib/platform";

import type { NostrEvent, NostrFilter } from "@nostrify/nostrify";

const norm = (u: string) => normalizeRelayUrl(u)!;

let evId = 0;
function ev(kind: number, tags: string[][], created_at: number): NostrEvent {
  return {
    id: (evId++).toString(16).padStart(64, "0"),
    kind,
    tags,
    content: "",
    created_at,
    pubkey: "aa".repeat(32),
    sig: "",
  } as NostrEvent;
}

/** A nostr stub that answers every query with a fixed event set. */
function nostrOf(events: NostrEvent[]) {
  return {
    query: async (_filters: NostrFilter[]) => events,
  };
}

/** A nostr stub whose query always fails (relays unreachable/timeout). */
function failingNostr() {
  return {
    query: async (_filters: NostrFilter[]): Promise<NostrEvent[]> => {
      throw new Error("relays unreachable");
    },
  };
}

const RECIPIENT = "bb".repeat(32);

describe("inviteDeliveryRelays — the stock interop floor (CORD-05 §6)", () => {
  it("falls back to the stock set when the member published no inbox", () => {
    expect(inviteDeliveryRelays([])).toEqual(STOCK_RELAYS);
  });

  it("uses the member's own inbox when they have one, never also the stock set", () => {
    const inbox = [norm("wss://my.inbox")];
    expect(inviteDeliveryRelays(inbox)).toEqual(inbox);
    expect(inviteDeliveryRelays(inbox)).not.toContain(STOCK_RELAYS[0]);
  });

  it("returns a fresh array, never the shared stock const (mutation-proof)", () => {
    const out = inviteDeliveryRelays([]);
    expect(out).toEqual(STOCK_RELAYS);
    expect(out).not.toBe(STOCK_RELAYS);
    out.push("wss://evil");
    expect(STOCK_RELAYS).not.toContain("wss://evil");
  });
});

describe("recipientInboxRelays", () => {
  it("returns [] when the member published neither a DM list nor NIP-65 reads", async () => {
    expect(await recipientInboxRelays(nostrOf([]), RECIPIENT)).toEqual([]);
  });

  it("returns null (undetermined, NOT empty) when the lookup itself fails", async () => {
    // The W1/W2 distinction: a failed fetch must not read as "no list", or a
    // send misdelivers to stock and a scan leaks its #p REQ there.
    expect(await recipientInboxRelays(failingNostr(), RECIPIENT)).toBeNull();
  });

  it("reads a kind-10050 DM relay list", async () => {
    const dm = ev(10050, [["relay", "wss://dm1.example"], ["relay", "wss://dm2.example"]], 100);
    expect(await recipientInboxRelays(nostrOf([dm]), RECIPIENT)).toEqual([
      norm("wss://dm1.example"),
      norm("wss://dm2.example"),
    ]);
  });

  it("prefers the DM list over NIP-65 when both exist", async () => {
    const dm = ev(10050, [["relay", "wss://dm.example"]], 100);
    const nip65 = ev(10002, [["r", "wss://read.example"]], 200);
    expect(await recipientInboxRelays(nostrOf([nip65, dm]), RECIPIENT)).toEqual([norm("wss://dm.example")]);
  });

  it("falls back to NIP-65 READ relays, excluding write-only entries", async () => {
    const nip65 = ev(
      10002,
      [
        ["r", "wss://read.example"],
        ["r", "wss://both.example"],
        ["r", "wss://write.example", "write"],
      ],
      200,
    );
    expect(await recipientInboxRelays(nostrOf([nip65]), RECIPIENT)).toEqual([
      "wss://read.example",
      "wss://both.example",
    ]);
  });

  it("takes the newest event of each kind", async () => {
    const older = ev(10050, [["relay", "wss://old.example"]], 100);
    const newer = ev(10050, [["relay", "wss://new.example"]], 300);
    expect(await recipientInboxRelays(nostrOf([older, newer]), RECIPIENT)).toEqual([norm("wss://new.example")]);
  });
});
