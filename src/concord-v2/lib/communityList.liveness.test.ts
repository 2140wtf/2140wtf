/**
 * Liveness regressions for the Concord V2 Community List.
 *
 * Two rules under test:
 *
 *  1. A rekey/Refounding adoption (`refreshCurrent`) is proof of CURRENT
 *     membership, so it must win liveness over an older removal tombstone —
 *     exactly like a re-join does. `refreshCurrent` bumps `added_at` for this;
 *     without it, a member who leaves (tombstone) then re-joins and adopts a
 *     newer epoch would be judged dead forever, since the merge is
 *     deterministic and tombstones are permanent.
 *
 *  2. Being KICKED/BANNED is not the same as leaving: it must NEVER remove the
 *     icon. The rekey watcher marks the entry read-only (`markExcluded`)
 *     instead of tombstoning it, so the community stays live and on the rail
 *     until the user chooses to leave (or a later Refounding re-includes them,
 *     which clears the marker). Only a real Leave / owner Dissolve tombstones.
 */

import { describe, expect, it } from "vitest";

import {
  addToList,
  EMPTY_COMMUNITY_LIST,
  isExcluded,
  isLive,
  liveEntries,
  markExcluded,
  mergeCommunityLists,
  refreshCurrent,
  removeFromList,
  type CommunityListEntry,
  type JoinMaterial,
} from "@/concord-v2/lib/communityList";
import { bytesToHex, random32 } from "@/concord-v2/lib/derive";

function jm(overrides: Partial<JoinMaterial> = {}): JoinMaterial {
  return {
    community_id: bytesToHex(random32()),
    owner: bytesToHex(random32()),
    owner_salt: bytesToHex(random32()),
    community_root: bytesToHex(random32()),
    root_epoch: 0,
    channels: [],
    relays: ["wss://a.example"],
    name: "Fleet",
    ...overrides,
  };
}

function entryOf(material: JoinMaterial, addedAt: number): CommunityListEntry {
  return { community_id: material.community_id, seed: material, current: material, added_at: addedAt };
}

describe("rekey adoption vs. an older removal tombstone", () => {
  it("re-included after a leave/removal tombstone: adoption must resurrect", () => {
    // A tombstone now comes ONLY from a real Leave or the owner's Dissolve
    // (the rekey watcher no longer tombstones — see the exclusion suite below).
    // But a resurrection can still legitimately need to beat one: the member
    //  1. joins at t=1000
    //  2. leaves at removed_at=2000 (tombstone)
    //  3. is re-invited and adopts epoch 2 via refresh-current, which keeps
    //     added_at=1000 unless bumped.
    // Holding the epoch-2 key proves current membership, so it must win.
    const seed = jm({ root_epoch: 0 });
    const cid = seed.community_id;

    let list = addToList(EMPTY_COMMUNITY_LIST, entryOf(seed, 1000));
    list = removeFromList(list, cid, 2000); // left
    expect(isLive(list, cid)).toBe(false);

    // Re-included: adopt epoch 2 via refresh-current.
    const epoch2 = jm({ ...seed, root_epoch: 2, community_root: bytesToHex(random32()) });
    list = refreshCurrent(list, epoch2);
    expect(list.entries[0].current.root_epoch).toBe(2); // key adopted

    // Holding the current key proves membership — must be live.
    expect(isLive(list, cid)).toBe(true);
  });

  it("a member who adopted a newer epoch (still in the community) stays live", () => {
    const seed = jm({ root_epoch: 0 });
    const cid = seed.community_id;

    // Device A: the member joined at t=1000, then adopted a Refounding to
    // epoch 1 (rekey watcher → refreshCurrent). refreshCurrent keeps added_at.
    let deviceA = addToList(EMPTY_COMMUNITY_LIST, entryOf(seed, 1000));
    const epoch1 = jm({ ...seed, root_epoch: 1, community_root: bytesToHex(random32()) });
    deviceA = refreshCurrent(deviceA, epoch1);
    expect(deviceA.entries[0].current.root_epoch).toBe(1);
    expect(isLive(deviceA, cid)).toBe(true);

    // Device B saw a transient removal at t=2000 (a stale Leave the member has
    // since undone by re-joining/adopting epoch 1 on device A). The tombstone
    // is permanent.
    const deviceB = removeFromList(addToList(EMPTY_COMMUNITY_LIST, entryOf(seed, 1000)), cid, 2000);
    expect(isLive(deviceB, cid)).toBe(false);

    // The two lists sync and merge (SelfSync / cross-device convergence).
    const merged = mergeCommunityLists(deviceA, deviceB);

    // The member currently HOLDS the epoch-1 key (proof of membership), so the
    // community must still be live. It is not: added_at (1000) < removed_at
    // (2000), so the adopted entry is judged dead and the community vanishes.
    expect(liveEntries(merged).map((e) => e.current.name)).toContain("Fleet");
    expect(isLive(merged, cid)).toBe(true);
  });
});

describe("exclusion (kick/ban) never removes the icon — read-only, not gone", () => {
  it("markExcluded keeps the community LIVE but flags it read-only", () => {
    const seed = jm({ root_epoch: 0 });
    const cid = seed.community_id;
    let list = addToList(EMPTY_COMMUNITY_LIST, entryOf(seed, 1000));

    // Kicked at epoch 1 (a Refounding I got no key for). The watcher used to
    // tombstone here, vanishing the icon; now it only marks exclusion.
    list = markExcluded(list, cid, 1);

    // Still live (still on the rail), but read-only.
    expect(isLive(list, cid)).toBe(true);
    expect(liveEntries(list).map((e) => e.current.name)).toContain("Fleet");
    expect(isExcluded(list.entries[0])).toBe(true);
  });

  it("adopting a later epoch (re-inclusion) clears the exclusion", () => {
    const seed = jm({ root_epoch: 0 });
    const cid = seed.community_id;
    let list = addToList(EMPTY_COMMUNITY_LIST, entryOf(seed, 1000));
    list = markExcluded(list, cid, 1);
    expect(isExcluded(list.entries[0])).toBe(true);

    // A later Refounding re-includes me at epoch 2 → adopt it.
    const epoch2 = jm({ ...seed, root_epoch: 2, community_root: bytesToHex(random32()) });
    list = refreshCurrent(list, epoch2);

    expect(list.entries[0].current.root_epoch).toBe(2);
    expect(isExcluded(list.entries[0])).toBe(false); // marker cleared
    expect(isLive(list, cid)).toBe(true);
  });

  it("an invite vending EXACTLY the excluded epoch is re-inclusion (unban + re-invite)", () => {
    const seed = jm({ root_epoch: 0 });
    const cid = seed.community_id;
    let list = addToList(EMPTY_COMMUNITY_LIST, entryOf(seed, 1000));
    list = markExcluded(list, cid, 1); // the 0→1 Refounding carried no key for me
    expect(isExcluded(list.entries[0])).toBe(true);

    // Unbanned + directly re-invited: the bundle hands me epoch 1 itself —
    // holding the marked epoch's own root IS re-inclusion, no later Refounding
    // required.
    const epoch1 = jm({ ...seed, root_epoch: 1, community_root: bytesToHex(random32()) });
    list = refreshCurrent(list, epoch1);
    expect(list.entries[0].current.root_epoch).toBe(1);
    expect(isExcluded(list.entries[0])).toBe(false);
    expect(list.entries[0].excluded_at_epoch).toBeUndefined(); // spent marker dropped

    // The merge path agrees: a stale device copy still carrying the marker
    // can't resurrect the exclusion.
    const stale = markExcluded(addToList(EMPTY_COMMUNITY_LIST, entryOf(seed, 1000)), cid, 1);
    const merged = mergeCommunityLists(list, stale);
    expect(isExcluded(merged.entries[0])).toBe(false);
  });

  it("the exclusion marker merges deterministically and stays cleared once superseded", () => {
    const seed = jm({ root_epoch: 0 });
    const cid = seed.community_id;

    // Device A: kicked at epoch 1, still read-only.
    const deviceA = markExcluded(addToList(EMPTY_COMMUNITY_LIST, entryOf(seed, 1000)), cid, 1);
    expect(isExcluded(deviceA.entries[0])).toBe(true);

    // Device B: re-included, adopted epoch 2.
    const epoch2 = jm({ ...seed, root_epoch: 2, community_root: bytesToHex(random32()) });
    const deviceB = refreshCurrent(addToList(EMPTY_COMMUNITY_LIST, entryOf(seed, 1000)), epoch2);

    // Merge either way: current is epoch 2, so the epoch-1 exclusion is stale.
    const merged1 = mergeCommunityLists(deviceA, deviceB);
    const merged2 = mergeCommunityLists(deviceB, deviceA);
    expect(merged1.entries[0].current.root_epoch).toBe(2);
    expect(isExcluded(merged1.entries[0])).toBe(false);
    expect(isExcluded(merged2.entries[0])).toBe(false);
    expect(isLive(merged1, cid)).toBe(true);
  });

  it("a stale exclusion below the current epoch never bites", () => {
    const seed = jm({ root_epoch: 3 });
    const cid = seed.community_id;
    let list = addToList(EMPTY_COMMUNITY_LIST, entryOf(seed, 1000));
    // A late-arriving exclusion for an OLD epoch I've already moved past.
    list = markExcluded(list, cid, 1);
    expect(isExcluded(list.entries[0])).toBe(false);
    expect(isLive(list, cid)).toBe(true);
  });
});
