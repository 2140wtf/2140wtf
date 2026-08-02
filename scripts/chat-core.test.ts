import { describe, expect, it } from "vitest";

import {
  adoptRootAccess,
  communityOf,
  migrateSavedCommunityAccess,
  migrateState,
  type SavedCommunity,
  type State,
} from "./chat-core";

const hex = (byte: string): string => byte.repeat(64);

function community(overrides: Partial<SavedCommunity> = {}): SavedCommunity {
  return {
    id: hex("1"),
    owner: hex("2"),
    owner_salt: hex("3"),
    community_root: hex("a"),
    root_epoch: 2,
    name: "test",
    relays: ["wss://relay.example"],
    ...overrides,
  };
}

function state(saved = community()): State {
  return {
    sk: hex("4"),
    role: "member",
    community: saved,
    private_channels: [],
    invites: [],
    registry_version: 0,
  };
}

describe("headless agent access-state migration", () => {
  it("upgrades a legacy identity without mutating the parsed state", () => {
    const legacy = state();
    const migrated = migrateState(legacy);

    expect(migrated).not.toBe(legacy);
    expect(migrated.community).not.toBe(legacy.community);
    expect(legacy.community.held_roots).toBeUndefined();
    expect(migrated.community.held_roots).toEqual([]);
    expect(migrated.community.joined_at).toBeUndefined();
  });

  it("canonicalizes and deduplicates retained roots newest-first", () => {
    const migrated = migrateSavedCommunityAccess(community({
      community_root: hex("A"),
      held_roots: [
        { epoch: 0, key: hex("c") },
        { epoch: 1, key: hex("B") },
        { epoch: 1, key: hex("b") },
        { epoch: 2, key: hex("a") },
      ],
    }));

    expect(migrated.community_root).toBe(hex("a"));
    expect(migrated.held_roots).toEqual([
      { epoch: 1, key: hex("b") },
      { epoch: 0, key: hex("c") },
    ]);
  });

  it("fails closed on equivocation at a retained or current epoch", () => {
    expect(() => migrateSavedCommunityAccess(community({
      held_roots: [{ epoch: 2, key: hex("b") }],
    }))).toThrow(/conflicting keys for its current root epoch/);
    expect(() => migrateSavedCommunityAccess(community({
      held_roots: [{ epoch: 1, key: hex("b") }, { epoch: 1, key: hex("c") }],
    }))).toThrow(/conflicting keys for retained root epoch 1/);
    expect(() => migrateSavedCommunityAccess(community({
      held_roots: [{ epoch: 3, key: hex("b") }],
    }))).toThrow(/newer than current epoch/);
    expect(() => migrateSavedCommunityAccess(community({
      held_roots: [{ epoch: 1, key: "not-a-key" }],
    }))).toThrow(/retained roots must contain/);
  });

  it("adopts newer access while retaining all readable history", () => {
    const before = state(community({
      held_roots: [{ epoch: 1, key: hex("b") }, { epoch: 0, key: hex("c") }],
      joined_at: 1234,
    }));
    const after = adoptRootAccess(before, {
      community_root: hex("d"),
      root_epoch: 3,
      held_roots: [{ epoch: 0, key: hex("c") }],
      refounder: hex("e"),
    });

    expect(before.community.root_epoch).toBe(2);
    expect(after.community).toMatchObject({
      community_root: hex("d"),
      root_epoch: 3,
      joined_at: 1234,
      refounder: hex("e"),
    });
    expect(after.community.held_roots).toEqual([
      { epoch: 2, key: hex("a") },
      { epoch: 1, key: hex("b") },
      { epoch: 0, key: hex("c") },
    ]);
  });

  it("ignores stale access and rejects same-epoch key disagreement", () => {
    const current = state();
    expect(adoptRootAccess(current, { community_root: hex("b"), root_epoch: 1 }).community.root_epoch).toBe(2);
    expect(() => adoptRootAccess(current, { community_root: hex("b"), root_epoch: 2 })).toThrow(/Conflicting root access update/);
  });

  it("merges authenticated historical roots at the same current epoch", () => {
    const current = state(community({ held_roots: [{ epoch: 1, key: hex("b") }] }));
    const merged = adoptRootAccess(current, {
      community_root: hex("a"),
      root_epoch: 2,
      held_roots: [{ epoch: 0, key: hex("c") }],
    });
    expect(merged.community.held_roots).toEqual([
      { epoch: 1, key: hex("b") },
      { epoch: 0, key: hex("c") },
    ]);
  });

  it("rehydrates every retained root for historical control and chat reads", () => {
    const runtime = communityOf(community({
      held_roots: [{ epoch: 1, key: hex("b") }, { epoch: 0, key: hex("c") }],
      refounder: hex("e"),
    }), []);

    expect(runtime.heldRoots.map((root) => [Number(root.epoch), Buffer.from(root.key).toString("hex")])).toEqual([
      [2, hex("a")],
      [1, hex("b")],
      [0, hex("c")],
    ]);
    expect(runtime.refounder).toBe(hex("e"));
  });
});
