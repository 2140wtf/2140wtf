import { describe, expect, it } from "vitest";

import { bytesToHex, random32 } from "@/concord-v2/lib/derive";
import { KIND_WRAP } from "@/concord-v2/lib/kinds";
import { mirrorGroups, mirrorHistoryToRelays, type MirrorNostr } from "@/concord-v2/lib/relayMirror";
import type { CommunityV2 } from "@/concord-v2/lib/types";

import type { NostrEvent, NostrFilter } from "@nostrify/nostrify";

function makeCommunity(overrides: Partial<CommunityV2> = {}): CommunityV2 {
  const id = random32();
  const root = random32();
  return {
    id,
    idHex: bytesToHex(id),
    owner: bytesToHex(random32()),
    ownerSalt: random32(),
    root,
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays: ["wss://old-a.example", "wss://old-b.example"],
    name: "Test",
    ...overrides,
  };
}

function wrapAt(pubkey: string, createdAt: number, seq: number): NostrEvent {
  return {
    id: `${createdAt}-${seq}-${pubkey.slice(0, 8)}`.padEnd(64, "0"),
    pubkey,
    created_at: createdAt,
    kind: KIND_WRAP,
    tags: [],
    content: "x",
    sig: "00".repeat(64),
  };
}

/** In-memory relay honoring kinds/authors/until/limit, newest-first. */
class FakeRelay {
  published: NostrEvent[] = [];
  failOnce = new Set<string>();
  constructor(
    public store: NostrEvent[] = [],
    public rejectIds = new Set<string>(),
  ) {}

  async query(filters: NostrFilter[]): Promise<NostrEvent[]> {
    const out: NostrEvent[] = [];
    for (const f of filters) {
      const matches = this.store
        .filter(
          (e) =>
            (!f.kinds || f.kinds.includes(e.kind)) &&
            (!f.authors || f.authors.includes(e.pubkey)) &&
            (f.until === undefined || e.created_at <= f.until),
        )
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, f.limit ?? 500);
      out.push(...matches);
    }
    return out;
  }

  async event(ev: NostrEvent): Promise<void> {
    if (this.rejectIds.has(ev.id)) throw new Error("blocked: event too old");
    if (this.failOnce.has(ev.id)) {
      this.failOnce.delete(ev.id);
      throw new Error("transient socket loss");
    }
    this.published.push(ev);
  }
}

function poolOf(relays: Record<string, FakeRelay>): MirrorNostr {
  return { relay: (url: string) => relays[url] ?? new FakeRelay() };
}

describe("mirrorGroups", () => {
  it("covers control, guestbook, dissolution and the held epochs' rekey addresses, deduped", () => {
    const community = makeCommunity({
      heldRoots: [
        { epoch: 1n, key: random32() },
        { epoch: 0n, key: random32() },
      ],
    });
    const groups = mirrorGroups(community);
    // 2 control + 2 guestbook + 1 dissolved + 2 base-rekey (epochs 1→2, 0→1).
    expect(groups.length).toBe(7);
    expect(new Set(groups.map((g) => g.pk)).size).toBe(groups.length);
  });

  it("enumerates a held private channel's rekey addresses across epochs and roots", () => {
    const rootA = random32();
    const rootB = random32();
    const community = makeCommunity({
      heldRoots: [
        { epoch: 1n, key: rootA },
        { epoch: 0n, key: rootB },
      ],
      privateChannels: [{ id: random32(), key: random32(), epoch: 2n, name: "sec" }],
    });
    const groups = mirrorGroups(community);
    // Base 7 (above) + channel epochs 1..3 under 2 roots = 6 more.
    expect(groups.length).toBe(13);
  });
});

describe("mirrorHistoryToRelays", () => {
  it("copies every wrap verbatim to the new relay, deduped across sources", async () => {
    const community = makeCommunity();
    const [control] = mirrorGroups(community);
    const shared = wrapAt(control.pk, 100, 0);
    const onlyA = wrapAt(control.pk, 200, 1);
    const onlyB = wrapAt(control.pk, 300, 2);
    const relays = {
      "wss://old-a.example": new FakeRelay([shared, onlyA]),
      "wss://old-b.example": new FakeRelay([shared, onlyB]),
      "wss://new.example": new FakeRelay(),
    };

    const report = await mirrorHistoryToRelays(poolOf(relays), community, ["wss://new.example"]);

    expect(report.found).toBe(3);
    expect(report.perRelay.get("wss://new.example")).toEqual({ accepted: 3, rejected: 0 });
    const delivered = relays["wss://new.example"].published;
    expect(delivered).toHaveLength(3);
    // Verbatim: the identical signed object, not a re-seal.
    expect(delivered.find((e) => e.id === shared.id)).toEqual(shared);
  });

  it("pages past the 500-event window with until", async () => {
    const community = makeCommunity();
    const [control] = mirrorGroups(community);
    const events = Array.from({ length: 1200 }, (_, i) => wrapAt(control.pk, 1000 + i, i));
    const relays = {
      "wss://old-a.example": new FakeRelay(events),
      "wss://old-b.example": new FakeRelay(),
      "wss://new.example": new FakeRelay(),
    };

    const report = await mirrorHistoryToRelays(poolOf(relays), community, ["wss://new.example"]);
    expect(report.found).toBe(1200);
    expect(relays["wss://new.example"].published).toHaveLength(1200);
  });

  it("retries a transient failure but reports a persistent rejection", async () => {
    const community = makeCommunity();
    const [control] = mirrorGroups(community);
    const ok = wrapAt(control.pk, 100, 0);
    const flaky = wrapAt(control.pk, 200, 1);
    const refused = wrapAt(control.pk, 300, 2);
    const target = new FakeRelay([], new Set([refused.id]));
    target.failOnce.add(flaky.id);
    const relays = {
      "wss://old-a.example": new FakeRelay([ok, flaky, refused]),
      "wss://old-b.example": new FakeRelay(),
      "wss://new.example": target,
    };

    const report = await mirrorHistoryToRelays(poolOf(relays), community, ["wss://new.example"]);
    expect(report.perRelay.get("wss://new.example")).toEqual({ accepted: 2, rejected: 1 });
  });

  it("never reads from the relays it is seeding", async () => {
    const community = makeCommunity({ relays: ["wss://old-a.example", "wss://new.example"] });
    const [control] = mirrorGroups(community);
    // A wrap that exists ONLY on the target must not round-trip into `found`.
    const targetOnly = wrapAt(control.pk, 100, 0);
    const relays = {
      "wss://old-a.example": new FakeRelay(),
      "wss://new.example": new FakeRelay([targetOnly]),
    };

    const report = await mirrorHistoryToRelays(poolOf(relays), community, ["wss://new.example"]);
    expect(report.found).toBe(0);
    expect(relays["wss://new.example"].published).toHaveLength(0);
  });
});
