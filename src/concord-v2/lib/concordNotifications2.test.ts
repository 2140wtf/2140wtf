import { describe, expect, it } from "vitest";

import { mintCommunity } from "@/concord-v2/lib/community";
import { buildConcord2Subs } from "@/concord-v2/lib/concordNotifications2";
import type { FoldedChannel, FoldedControl } from "@/concord-v2/lib/control";
import { bytesToHex, channelGroupKey, random32 } from "@/concord-v2/lib/derive";
import type { CommunityV2 } from "@/concord-v2/lib/types";

const OWNER = bytesToHex(random32());

function foldedWith(channels: FoldedChannel[], name?: string): FoldedControl {
  return {
    roster: [],
    ownerHex: OWNER,
    metadata: name ? { name, relays: [] } : undefined,
    channels: new Map(channels.map((c) => [c.channelIdHex, c])),
    banned: new Set(),
    liveInviteLinks: new Set(),
    registriesByCreator: new Map(),
    heads: new Map(),
    headEditions: new Map(),
  } as unknown as FoldedControl;
}

function mint(): { community: CommunityV2; generalId: Uint8Array } {
  const { community, generalChannelId } = mintCommunity("Fleet", OWNER, ["wss://relay.example"]);
  return { community, generalId: generalChannelId };
}

describe("buildConcord2Subs", () => {
  it("builds one sub per readable channel with per-epoch streams + conv keys", () => {
    const { community, generalId } = mint();
    const folded = foldedWith(
      [{ channelIdHex: bytesToHex(generalId), name: "general", isPrivate: false, deleted: false }],
      "Fleet Renamed",
    );

    const { subs, streamKeys } = buildConcord2Subs(community, folded);
    expect(subs).toHaveLength(1);
    const sub = subs[0];
    expect(sub.communityId).toBe(community.idHex);
    expect(sub.communityName).toBe("Fleet Renamed"); // fold metadata wins over join preview
    expect(sub.channelId).toBe(bytesToHex(generalId));
    expect(sub.channelName).toBe("general");
    expect(sub.relays).toEqual(["wss://relay.example"]);

    // The stream matches the on-wire derivation exactly.
    const expected = channelGroupKey(community.root, generalId, 0n);
    expect(sub.streams).toEqual([
      { pk: expected.pk, convKey: bytesToHex(expected.convKey), epoch: "0" },
    ]);
    // No secret key leaves the builder in the sub; the GroupKeys are returned
    // separately for WebView-side NIP-42 registration.
    expect(JSON.stringify(subs)).not.toContain(bytesToHex(expected.sk));
    expect(streamKeys.map((k) => k.pk)).toEqual([expected.pk]);
  });

  it("includes held private channels even before the fold names them", () => {
    const { community } = mint();
    const id = random32();
    const key = random32();
    community.privateChannels.push({ id, key, epoch: 3n, name: "secret" });

    const { subs } = buildConcord2Subs(community, undefined);
    expect(subs).toHaveLength(1);
    expect(subs[0].channelName).toBe("secret");
    const expected = channelGroupKey(key, id, 3n);
    expect(subs[0].streams).toEqual([
      { pk: expected.pk, convKey: bytesToHex(expected.convKey), epoch: "3" },
    ]);
  });

  it("skips deleted channels and communities without relays", () => {
    const { community, generalId } = mint();
    const folded = foldedWith([
      { channelIdHex: bytesToHex(generalId), name: "general", isPrivate: false, deleted: true },
    ]);
    expect(buildConcord2Subs(community, folded).subs).toHaveLength(0);

    const relayless = { ...community, relays: [] };
    expect(buildConcord2Subs(relayless, undefined).subs).toHaveLength(0);
  });

  it("orders subs by community then channel id, not display name", () => {
    const { community } = mint();
    const a = { id: new Uint8Array(32).fill(1), key: random32(), epoch: 0n, name: "zzz" };
    const b = { id: new Uint8Array(32).fill(2), key: random32(), epoch: 0n, name: "aaa" };
    community.privateChannels.push(a, b);
    const { subs } = buildConcord2Subs(community, undefined);
    expect(subs.map((s) => s.channelName)).toEqual(["zzz", "aaa"]);
  });
});
