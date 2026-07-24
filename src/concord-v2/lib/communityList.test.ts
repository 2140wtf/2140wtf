import { describe, expect, it } from "vitest";

import {
  addToList,
  canonicalJson,
  EMPTY_COMMUNITY_LIST,
  isLive,
  liveEntries,
  mergeCommunityLists,
  refreshChannels,
  refreshCurrent,
  refreshRelays,
  rehydrateCommunity,
  removeFromList,
  toJoinMaterial,
  type CommunityListEntry,
  type JoinMaterial,
} from "@/concord-v2/lib/communityList";
import { bytesToHex, communityIdOf, random32 } from "@/concord-v2/lib/derive";

function makeJoinMaterial(overrides: Partial<JoinMaterial> = {}): JoinMaterial {
  const ownerSk = random32();
  const owner = bytesToHex(random32()); // placeholder; overridden below when consistency matters
  void ownerSk;
  return {
    community_id: bytesToHex(random32()),
    owner,
    owner_salt: bytesToHex(random32()),
    community_root: bytesToHex(random32()),
    root_epoch: 0,
    channels: [],
    relays: ["wss://a.example"],
    name: "Test",
    ...overrides,
  };
}

function entryOf(jm: JoinMaterial, addedAt = 1000): CommunityListEntry {
  return { community_id: jm.community_id, seed: jm, current: jm, added_at: addedAt };
}

describe("community list merge (CORD-02 §8)", () => {
  it("is commutative and idempotent", () => {
    const jm1 = makeJoinMaterial();
    const jm2 = makeJoinMaterial();
    const a = addToList(EMPTY_COMMUNITY_LIST, entryOf(jm1));
    const b = addToList(EMPTY_COMMUNITY_LIST, entryOf(jm2));
    const ab = canonicalJson(mergeCommunityLists(a, b));
    const ba = canonicalJson(mergeCommunityLists(b, a));
    expect(ab).toBe(ba);
    expect(canonicalJson(mergeCommunityLists(mergeCommunityLists(a, b), b))).toBe(ab);
  });

  it("current keeps the higher epoch, seed the lower", () => {
    const jm0 = makeJoinMaterial({ root_epoch: 0 });
    const jm2: JoinMaterial = { ...jm0, root_epoch: 2, community_root: bytesToHex(random32()) };
    const merged = mergeCommunityLists(
      { entries: [entryOf(jm0)], tombstones: [] },
      { entries: [entryOf(jm2)], tombstones: [] },
    );
    expect(merged.entries[0].current.root_epoch).toBe(2);
    expect(merged.entries[0].seed.root_epoch).toBe(0);
  });

  it("equal-epoch ties break on canonical bytes (a total order)", () => {
    const jmA = makeJoinMaterial({ name: "AAA" });
    const jmB: JoinMaterial = { ...jmA, name: "ZZZ" };
    const m1 = mergeCommunityLists(
      { entries: [entryOf(jmA)], tombstones: [] },
      { entries: [entryOf(jmB)], tombstones: [] },
    );
    const m2 = mergeCommunityLists(
      { entries: [entryOf(jmB)], tombstones: [] },
      { entries: [entryOf(jmA)], tombstones: [] },
    );
    expect(canonicalJson(m1)).toBe(canonicalJson(m2));
  });

  it("tombstones are permanent; liveness is derived, entries never deleted", () => {
    const jm = makeJoinMaterial();
    let list = addToList(EMPTY_COMMUNITY_LIST, entryOf(jm, 1000));
    list = removeFromList(list, jm.community_id, 2000);
    expect(list.entries.length).toBe(1); // the entry STAYS in the document
    expect(list.tombstones.length).toBe(1);
    expect(isLive(list, jm.community_id)).toBe(false);
    expect(liveEntries(list).length).toBe(0);

    // A re-join (newer add) resurrects; the tombstone stays.
    list = addToList(list, entryOf(jm, 3000));
    expect(isLive(list, jm.community_id)).toBe(true);
    expect(list.tombstones.length).toBe(1);

    // A backfill merging the OLD pre-leave state can't bury the re-join.
    const stale = addToList(EMPTY_COMMUNITY_LIST, entryOf(jm, 1000));
    const merged = mergeCommunityLists(list, stale);
    expect(isLive(merged, jm.community_id)).toBe(true);
  });

  it("round-trips unknown fields (the round-trip discipline)", () => {
    const jm = makeJoinMaterial({ vector_custom: { theme: "dark" } } as Partial<JoinMaterial>);
    const list = addToList(EMPTY_COMMUNITY_LIST, entryOf(jm));
    const merged = mergeCommunityLists(list, EMPTY_COMMUNITY_LIST);
    expect((merged.entries[0].current as Record<string, unknown>).vector_custom).toEqual({ theme: "dark" });
  });

  it("entry-level invite_ref survives merges and current refreshes (stranded self-heal anchor)", () => {
    const jm = makeJoinMaterial({ root_epoch: 1 });
    const ref = "naddr1example#BAACAwSramExdyfria50iKwvzRpK";
    const withRef: CommunityListEntry = { ...entryOf(jm, 1000), invite_ref: ref };

    // A device copy that predates the field must not strip it on merge.
    const merged = mergeCommunityLists(
      addToList(EMPTY_COMMUNITY_LIST, withRef),
      addToList(EMPTY_COMMUNITY_LIST, entryOf(jm, 900)),
    );
    expect(merged.entries[0].invite_ref).toBe(ref);

    // Adopting a fresh epoch (refresh-current) keeps the ref: the link is a
    // durable recovery anchor, not epoch-scoped state.
    const jm2: JoinMaterial = { ...jm, root_epoch: 2, community_root: bytesToHex(random32()) };
    const refreshed = refreshCurrent(merged, jm2);
    expect(refreshed.entries[0].invite_ref).toBe(ref);
    expect(refreshed.entries[0].current.root_epoch).toBe(2);
  });
});

describe("refreshChannels (channel-scope rekey adoption/exclusion, CORD-06 §2)", () => {
  const chan = (id: string, epoch: number) => ({ id, key: bytesToHex(random32()), epoch, name: "sec" });

  it("replaces current's channel set WITHOUT bumping added_at (a channel rotation is not re-inclusion proof)", () => {
    const a = chan("11".repeat(32), 0);
    const jm = makeJoinMaterial({ channels: [a] });
    const list = addToList(EMPTY_COMMUNITY_LIST, entryOf(jm, 1234));

    const rotated = { ...a, key: bytesToHex(random32()), epoch: 1 };
    const next = refreshChannels(list, jm.community_id, [rotated]);

    expect(next.entries[0].current.channels).toEqual([rotated]);
    expect(next.entries[0].added_at).toBe(1234); // untouched — feeds the exclusion-vs-history decision
    expect(next.entries[0].seed.channels).toEqual([a]); // seed keeps the original key for history
  });

  it("an excluded channel is dropped from current (visible removal) while seed retains it", () => {
    const a = chan("11".repeat(32), 0);
    const b = chan("22".repeat(32), 0);
    const jm = makeJoinMaterial({ channels: [a, b] });
    const list = addToList(EMPTY_COMMUNITY_LIST, entryOf(jm));

    const next = refreshChannels(list, jm.community_id, [a]); // b removed
    expect(next.entries[0].current.channels).toEqual([a]);
    expect(next.entries[0].seed.channels).toEqual([a, b]);
  });

  it("an unknown community is a no-op", () => {
    const list = addToList(EMPTY_COMMUNITY_LIST, entryOf(makeJoinMaterial()));
    expect(refreshChannels(list, "ff".repeat(32), [])).toEqual(list);
  });
});

describe("refreshRelays (follow the fold's relay list, CORD-02 §6)", () => {
  it("replaces current's relays WITHOUT bumping added_at (a relay move is not re-inclusion proof)", () => {
    const jm = makeJoinMaterial({ relays: ["wss://old.example"] });
    const list = addToList(EMPTY_COMMUNITY_LIST, entryOf(jm, 1234));

    const next = refreshRelays(list, jm.community_id, ["wss://new.example", "wss://old.example"]);

    expect(next.entries[0].current.relays).toEqual(["wss://new.example", "wss://old.example"]);
    expect(next.entries[0].added_at).toBe(1234);
    expect(next.entries[0].seed.relays).toEqual(["wss://old.example"]); // seed only ever moves backward
  });

  it("preserves the rest of the join material (keys, epoch, unknown fields)", () => {
    const jm = makeJoinMaterial({ vendor_ext: "keep-me" } as Partial<JoinMaterial>);
    const list = addToList(EMPTY_COMMUNITY_LIST, entryOf(jm));

    const next = refreshRelays(list, jm.community_id, ["wss://new.example"]);
    expect(next.entries[0].current.community_root).toBe(jm.community_root);
    expect(next.entries[0].current.root_epoch).toBe(jm.root_epoch);
    expect(next.entries[0].current.vendor_ext).toBe("keep-me");
  });

  it("an unknown community is a no-op", () => {
    const list = addToList(EMPTY_COMMUNITY_LIST, entryOf(makeJoinMaterial()));
    expect(refreshRelays(list, "ff".repeat(32), ["wss://x.example"])).toEqual(list);
  });
});

describe("rehydration", () => {
  it("verifies the owner commitment and rebuilds the runtime community", () => {
    const ownerPk = bytesToHex(random32());
    const salt = random32();
    const cid = communityIdOf(
      Uint8Array.from(ownerPk.match(/.{2}/g)!.map((b) => parseInt(b, 16))),
      salt,
    );
    const jm = makeJoinMaterial({
      community_id: bytesToHex(cid),
      owner: ownerPk,
      owner_salt: bytesToHex(salt),
      root_epoch: 3,
      held_roots: [{ epoch: 1, key: bytesToHex(random32()) }],
      channels: [{ id: bytesToHex(random32()), key: bytesToHex(random32()), epoch: 1, name: "secret" }],
    });
    const community = rehydrateCommunity(entryOf(jm), ["wss://app.example"]);
    expect(community).toBeDefined();
    expect(community!.rootEpoch).toBe(3n);
    expect(community!.heldRoots.map((r) => Number(r.epoch))).toEqual([3, 1]);
    expect(community!.privateChannels.length).toBe(1);
    expect(community!.relays).toContain("wss://app.example");

    // A corrupted owner fails closed.
    const corrupt = { ...jm, owner: bytesToHex(random32()) };
    expect(rehydrateCommunity(entryOf(corrupt))).toBeUndefined();
  });

  it("snapshots back to join material, preserving unknown fields", () => {
    const ownerPk = bytesToHex(random32());
    const salt = random32();
    const cid = communityIdOf(
      Uint8Array.from(ownerPk.match(/.{2}/g)!.map((b) => parseInt(b, 16))),
      salt,
    );
    const jm = makeJoinMaterial({
      community_id: bytesToHex(cid),
      owner: ownerPk,
      owner_salt: bytesToHex(salt),
      root_epoch: 1,
      vendor_field: 42,
    } as Partial<JoinMaterial>);
    const community = rehydrateCommunity(entryOf(jm))!;
    const back = toJoinMaterial(community, { prior: jm, relays: jm.relays });
    expect(back.community_id).toBe(jm.community_id);
    expect(back.root_epoch).toBe(1);
    expect((back as Record<string, unknown>).vendor_field).toBe(42);
  });
});
