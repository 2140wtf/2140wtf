import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent, NostrFilter } from "@nostrify/nostrify";

import { mintCommunity } from "@/concord-v2/lib/community";
import { mirrorGroups } from "@/concord-v2/lib/relayMirror";
import { purgeCommunityRemote, purgeDeletionTags } from "@/concord-v2/lib/purgeCommunity";
import { KIND_INVITE_BUNDLE, KIND_STREAM_SPONSORSHIP, KIND_WRAP } from "@/concord-v2/lib/kinds";

function event(sk: Uint8Array, kind: number, tags: string[][] = []): NostrEvent {
  return finalizeEvent({ kind, content: "ciphertext", tags, created_at: 1_800_000_000 }, sk);
}

function matchesFilter(candidate: NostrEvent, filter: NostrFilter): boolean {
  if (filter.kinds && !filter.kinds.includes(candidate.kind)) return false;
  if (filter.authors && !filter.authors.includes(candidate.pubkey)) return false;
  const dTags = filter["#d"];
  if (dTags && !dTags.includes(candidate.tags.find((tag) => tag[0] === "d")?.[1] ?? "")) return false;
  return true;
}

describe("remote BAO purge", () => {
  it("uses address coordinates for replaceable data", () => {
    const sk = generateSecretKey();
    const replaceable = event(sk, KIND_INVITE_BUNDLE, [["d", ""]]);
    const regular = event(sk, KIND_WRAP);

    expect(purgeDeletionTags([replaceable, regular])).toEqual([
      ["a", `${KIND_INVITE_BUNDLE}:${replaceable.pubkey}:`],
      ["k", String(KIND_INVITE_BUNDLE)],
      ["e", regular.id],
      ["k", String(KIND_WRAP)],
    ]);
  });

  it("deletes stream wraps, invite bundles, and founder sponsorships, then verifies the relay", async () => {
    const ownerSk = generateSecretKey();
    const owner = getPublicKey(ownerSk);
    const relayUrl = "wss://purge.example";
    const { community } = mintCommunity("Disposable", owner, [relayUrl]);
    const stream = mirrorGroups(community)[0];
    const linkSk = generateSecretKey();
    const linkPk = getPublicKey(linkSk);
    const stored = new Map<string, NostrEvent>([
      ["wrap", event(stream.sk, KIND_WRAP)],
      ["invite", event(linkSk, KIND_INVITE_BUNDLE, [["d", ""]])],
      ["sponsor", event(ownerSk, KIND_STREAM_SPONSORSHIP, [["d", community.idHex]])],
    ]);
    const accepted: NostrEvent[] = [];

    const relay = {
      query: async (filters: NostrFilter[]) => [...stored.values()].filter((candidate) =>
        filters.some((filter) => matchesFilter(candidate, filter))),
      event: async (deletion: NostrEvent) => {
        accepted.push(deletion);
        for (const [key, candidate] of stored) {
          if (candidate.pubkey !== deletion.pubkey) continue;
          const coordinate = `${candidate.kind}:${candidate.pubkey}:${candidate.tags.find((tag) => tag[0] === "d")?.[1] ?? ""}`;
          if (deletion.tags.some((tag) => (tag[0] === "e" && tag[1] === candidate.id) || (tag[0] === "a" && tag[1] === coordinate))) {
            stored.delete(key);
          }
        }
      },
    };

    const report = await purgeCommunityRemote(
      { relay: () => relay },
      community,
      new Map([[linkPk, linkSk]]),
      [],
      { signEvent: async (template) => finalizeEvent(template, ownerSk) },
    );

    expect(report).toMatchObject({ found: 3, requested: 3, accepted: 3, failed: 0, remaining: 0, unverified: 0 });
    expect(report.relays).toEqual([{
      url: relayUrl,
      found: 3,
      requested: 3,
      accepted: 3,
      remaining: 0,
      verified: true,
    }]);
    expect(stored.size).toBe(0);
    expect(accepted.some((deletion) => deletion.tags.some((tag) => tag[0] === "a" && tag[1]?.startsWith(`${KIND_STREAM_SPONSORSHIP}:`)))).toBe(true);
  });

  it("does not mistake a failed relay query for a verified empty relay", async () => {
    const ownerSk = generateSecretKey();
    const relayUrl = "wss://offline.example";
    const { community } = mintCommunity("Unknown", getPublicKey(ownerSk), [relayUrl]);

    const report = await purgeCommunityRemote({
      relay: () => ({
        query: async () => { throw new Error("offline"); },
        event: async () => undefined,
      }),
    }, community, new Map());

    expect(report).toMatchObject({ found: 0, remaining: 0, unverified: 1 });
    expect(report.relays[0]).toMatchObject({ url: relayUrl, verified: false });
  });
});
