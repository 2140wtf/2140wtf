import { describe, expect, it } from "vitest";

import { buildWireSpec, MAX_WRAP_BACKDATE_SECS, stampRoundSince } from "./spec";

import type { GroupKey } from "@/concord-v2/lib/derive";
import type { ChannelV2 } from "@/concord-v2/lib/types";

const PUBKEY = "f".repeat(64);

function v2Channel(idByte: number, pks: string[]): ChannelV2 {
  const id = new Uint8Array(32).fill(idByte);
  const idHex = Array.from(id, (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    id,
    idHex,
    name: "general",
    isPrivate: false,
    streams: pks.map((pk, i) => ({
      epoch: BigInt(i),
      group: { pk } as unknown as ChannelV2["streams"][number]["group"],
    })),
    current: { epoch: 0n, group: { pk: pks[0] } as unknown as ChannelV2["streams"][number]["group"] },
  } as ChannelV2;
}

describe("buildWireSpec", () => {
  it("merges Concord V2 stream authors per community relay and maps pk → channel", () => {
    const chanA = v2Channel(1, ["pkA1", "pkA2"]);
    const chanB = v2Channel(2, ["pkB1"]);

    const spec = buildWireSpec({
      concord2: [
        { relays: ["wss://c.relay"], channel: chanA, communityIdHex: "commA" },
        { relays: ["wss://c.relay"], channel: chanB, communityIdHex: "commB" },
      ],
    });

    expect(spec.subs).toHaveLength(1);
    expect(spec.subs[0].filters).toEqual([
      { kinds: [1059], authors: ["pkA1", "pkA2", "pkB1"] },
    ]);
    expect(spec.v2ByPk.get("pkA2")).toBe(chanA);
    expect(spec.v2ByPk.get("pkB1")).toBe(chanB);
    expect(spec.v2CommunityByChannel.get(chanA.idHex)).toBe("commA");
    expect(spec.v2CommunityByChannel.get(chanB.idHex)).toBe("commB");
  });

  it("splits Concord V2 channels across their own community relays", () => {
    const chanA = v2Channel(1, ["pkA1"]);
    const chanB = v2Channel(2, ["pkB1"]);

    const spec = buildWireSpec({
      concord2: [
        { relays: ["wss://a.relay/"], channel: chanA, communityIdHex: "commA" }, // unnormalized
        { relays: ["wss://b.relay"], channel: chanB, communityIdHex: "commB" },
      ],
    });

    expect(spec.subs).toHaveLength(2);
    const a = spec.subs.find((s) => s.relay.startsWith("wss://a.relay"));
    const b = spec.subs.find((s) => s.relay.startsWith("wss://b.relay"));
    expect(a?.filters).toEqual([{ kinds: [1059], authors: ["pkA1"] }]);
    expect(b?.filters).toEqual([{ kinds: [1059], authors: ["pkB1"] }]);
  });

  it("subscribes to Concord V2 control authors and maps control pk → community", () => {
    const spec = buildWireSpec({
      concord2: [],
      concord2Control: [
        {
          relays: ["wss://c.relay"],
          idHex: "a".repeat(64),
          groups: [{ pk: "ctlA1" } as unknown as GroupKey, { pk: "ctlA2" } as unknown as GroupKey],
        },
      ],
    });

    expect(spec.subs).toHaveLength(1);
    expect(spec.subs[0].filters).toEqual([{ kinds: [1059], authors: ["ctlA1", "ctlA2"] }]);
    expect(spec.v2CtlByPk.get("ctlA1")?.idHex).toBe("a".repeat(64));
    expect(spec.v2CtlByPk.get("ctlA2")?.idHex).toBe("a".repeat(64));
  });

  it("keeps chat-wrap and control-wrap filters separate on the same relay", () => {
    const chanA = v2Channel(1, ["pkA1"]);
    const spec = buildWireSpec({
      concord2: [{ relays: ["wss://c.relay"], channel: chanA, communityIdHex: "commA" }],
      concord2Control: [
        { relays: ["wss://c.relay"], idHex: "a".repeat(64), groups: [{ pk: "ctlA1" } as unknown as GroupKey] },
      ],
    });

    expect(spec.subs).toHaveLength(1);
    expect(spec.subs[0].filters).toEqual([
      { kinds: [1059], authors: ["pkA1"] },
      { kinds: [1059], authors: ["ctlA1"] },
    ]);
  });

  it("builds no subscriptions for an empty membership", () => {
    const spec = buildWireSpec({ concord2: [] });
    expect(spec.subs).toHaveLength(0);
    expect(spec.v2ByPk.size).toBe(0);
    expect(spec.v2CtlByPk.size).toBe(0);
  });

  it("keeps the sig stable across input reordering (no needless resubscribes)", () => {
    const chanA = v2Channel(1, ["pkA1"]);
    const chanB = v2Channel(2, ["pkB1"]);
    const a = buildWireSpec({
      concord2: [
        { relays: ["wss://c.relay"], channel: chanA, communityIdHex: "commA" },
        { relays: ["wss://c.relay"], channel: chanB, communityIdHex: "commB" },
      ],
    });
    const b = buildWireSpec({
      concord2: [
        { relays: ["wss://c.relay"], channel: chanB, communityIdHex: "commB" },
        { relays: ["wss://c.relay"], channel: chanA, communityIdHex: "commA" },
      ],
    });
    expect(a.sig).toBe(b.sig);
  });
});

describe("stampRoundSince", () => {
  const NOW = 1_800_000_000;
  const SINCE = NOW - 60; // a cursor-derived resume point

  it("stamps the cursor since onto every filter EXCEPT a NIP-17 wrap inbox", () => {
    const stamped = stampRoundSince(
      [
        { kinds: [1059], authors: ["pkA1"] }, // a Concord V2 wrap filter
        { kinds: [1059], "#p": [PUBKEY] }, // a NIP-17 DM wrap inbox filter
      ],
      SINCE,
      NOW,
    );

    for (const f of stamped) {
      if (f.kinds?.length === 1 && f.kinds[0] === 1059 && !f.authors) {
        // A gift wrap's created_at is NIP-59-backdated up to 2 days, and relays
        // apply `since` to live events too — a cursor-derived since would filter
        // out virtually every LIVE wrap (the "DMs only arrive on the poll" lag).
        expect(f.since).toBeLessThanOrEqual(NOW - MAX_WRAP_BACKDATE_SECS);
        // The rewind replays stored wraps each round; the limit bounds it.
        expect(f.limit).toBeGreaterThan(0);
      } else {
        expect(f.since).toBe(SINCE);
        expect(f.limit).toBeUndefined();
      }
    }
  });

  it("keeps the cursor since on a Concord V2 wrap filter (authors-scoped, real timestamps)", () => {
    const stamped = stampRoundSince([{ kinds: [1059], authors: ["pkA1"] }], SINCE, NOW);
    expect(stamped[0].since).toBe(SINCE);
    expect(stamped[0].limit).toBeUndefined();
  });

  it("takes the deeper of cursor since and the backdate rewind for the wrap filter", () => {
    const deepCursor = NOW - 6 * 24 * 60 * 60; // device off for days
    const stamped = stampRoundSince([{ kinds: [1059], "#p": [PUBKEY] }], deepCursor, NOW);
    expect(stamped[0].since).toBe(deepCursor);
  });
});
