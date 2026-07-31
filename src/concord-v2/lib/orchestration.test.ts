import { describe, expect, it } from "vitest";

import {
  deriveClaimKey,
  mentionsMe,
  parseTaskMessage,
  resolveClaims,
  ORCH_TASK_TAG,
  type ClaimInput,
} from "@/concord-v2/lib/orchestration";

const T = [["t", ORCH_TASK_TAG]];

function claim(id: string, author: string, ms: number, taskId = "t1", key?: string, epoch?: number): ClaimInput {
  const content = `CLAIM ${taskId}${key ? ` key=${key}` : ""}${epoch !== undefined ? ` epoch=${epoch}` : ""}`;
  return { id, author, ms, msg: parseTaskMessage(content, T)! };
}

function progress(id: string, author: string, ms: number, taskId = "t1"): ClaimInput {
  return { id, author, ms, msg: parseTaskMessage(`PROGRESS ${taskId} working`, T)! };
}

function done(id: string, author: string, ms: number, taskId = "t1"): ClaimInput {
  return { id, author, ms, msg: parseTaskMessage(`DONE ${taskId} branch xyz`, T)! };
}

describe("parseTaskMessage", () => {
  it("parses verbs with taskId, rest, and claim key", () => {
    expect(parseTaskMessage("CLAIM t3 key=abc123 rest of it", T)).toEqual({
      verb: "CLAIM", taskId: "t3", rest: "key=abc123 rest of it", idemKey: "abc123",
    });
    expect(parseTaskMessage("BLOCKED t1 need the API key", T)?.verb).toBe("BLOCKED");
    expect(parseTaskMessage("DONE t9", T)?.rest).toBe("");
  });

  it("extracts the fencing epoch from CLAIM (and only CLAIM)", () => {
    expect(parseTaskMessage("CLAIM t3 key=abc epoch=2 taking over", T)).toMatchObject({ epoch: 2, idemKey: "abc" });
    expect(parseTaskMessage("CLAIM t3 epoch=1", T)).toMatchObject({ epoch: 1 });
    expect(parseTaskMessage("CLAIM t3 key=abc", T)?.epoch).toBeUndefined(); // legacy
    expect(parseTaskMessage("PROGRESS t3 epoch=9 red herring", T)?.epoch).toBeUndefined();
  });

  it("requires the orch-task tag — untagged lookalikes are chat", () => {
    expect(parseTaskMessage("CLAIM t3 key=abc", [["t", "other"]])).toBeNull();
    expect(parseTaskMessage("CLAIM t3", [])).toBeNull();
  });

  it("rejects non-verbs and lowercase noise", () => {
    expect(parseTaskMessage("HELLO t3", T)).toBeNull();
    expect(parseTaskMessage("done t3", T)).not.toBeNull(); // case-insensitive verb
  });
});

describe("deriveClaimKey", () => {
  it("is deterministic and scoped to orch+task", () => {
    expect(deriveClaimKey("o1", "t1")).toBe(deriveClaimKey("o1", "t1"));
    expect(deriveClaimKey("o1", "t1")).not.toBe(deriveClaimKey("o1", "t2"));
    expect(deriveClaimKey("o1", "t1")).not.toBe(deriveClaimKey("o2", "t1"));
    expect(deriveClaimKey("o1", "t1")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is salted by the fencing epoch (retry idempotent, re-claim fresh)", () => {
    expect(deriveClaimKey("o1", "t1", 2)).toBe(deriveClaimKey("o1", "t1", 2));
    expect(deriveClaimKey("o1", "t1", 1)).not.toBe(deriveClaimKey("o1", "t1", 2));
    expect(deriveClaimKey("o1", "t1")).toBe(deriveClaimKey("o1", "t1", 1)); // default epoch
  });
});

describe("resolveClaims — the ONE tie-break", () => {
  const TTL = 60_000;

  it("first claim by timestamp wins; later claims lose", () => {
    const s = resolveClaims(
      [claim("bb", "bob", 2000), claim("aa", "alice", 1000)],
      { ttlMs: TTL, nowMs: 3000 },
    );
    expect(s.get("t1")!.claimant).toBe("alice");
  });

  it("timestamp ties break by lowest message id", () => {
    const s = resolveClaims(
      [claim("ff", "bob", 1000), claim("01", "alice", 1000)],
      { ttlMs: TTL, nowMs: 2000 },
    );
    expect(s.get("t1")!.claimant).toBe("alice");
  });

  it("a claim without progress goes stale and is reclaimable", () => {
    const s = resolveClaims(
      [claim("aa", "alice", 1000), claim("bb", "bob", 200_000)],
      { ttlMs: TTL, nowMs: 300_000 },
    );
    expect(s.get("t1")!.claimant).toBe("bob"); // alice's claim went stale
  });

  it("PROGRESS by the claimant refreshes staleness; others' does not", () => {
    const fresh = resolveClaims(
      [claim("aa", "alice", 1000), progress("pp", "alice", 250_000)],
      { ttlMs: TTL, nowMs: 300_000 },
    );
    expect(fresh.get("t1")!.stale).toBe(false);
    const notYours = resolveClaims(
      [claim("aa", "alice", 1000), progress("pp", "mallory", 250_000)],
      { ttlMs: TTL, nowMs: 300_000 },
    );
    expect(notYours.get("t1")!.stale).toBe(true);
  });

  it("DONE is terminal and only the claimant can mark it", () => {
    const s = resolveClaims(
      [claim("aa", "alice", 1000), done("dd", "mallory", 2000), progress("pp", "alice", 3000)],
      { ttlMs: TTL, nowMs: 4000 },
    );
    expect(s.get("t1")!.done).toBe(false); // mallory can't finish alice's task
    const own = resolveClaims([claim("aa", "alice", 1000), done("dd", "alice", 2000)], { ttlMs: TTL, nowMs: 3000 });
    expect(own.get("t1")!.done).toBe(true);
  });

  it("a stale claim's task can be re-claimed but a live claim's cannot", () => {
    const s = resolveClaims(
      [claim("aa", "alice", 1000), claim("bb", "bob", 5000)],
      { ttlMs: TTL, nowMs: 6000 },
    );
    expect(s.get("t1")!.claimant).toBe("alice");
  });

  it("tracks tasks independently", () => {
    const s = resolveClaims(
      [claim("aa", "alice", 1000, "t1"), claim("bb", "bob", 1001, "t2")],
      { ttlMs: TTL, nowMs: 2000 },
    );
    expect(s.get("t1")!.claimant).toBe("alice");
    expect(s.get("t2")!.claimant).toBe("bob");
  });
});

describe("resolveClaims — fencing epochs (mosaico generation check)", () => {
  const TTL = 60_000;

  it("first epoch-bearing claim starts at epoch 1", () => {
    const s = resolveClaims([claim("aa", "alice", 1000, "t1", "k", 1)], { ttlMs: TTL, nowMs: 2000 });
    expect(s.get("t1")!.epoch).toBe(1);
    expect(s.get("t1")!.claimant).toBe("alice");
  });

  it("a correct-epoch CLAIM reclaims a stale claim", () => {
    const s = resolveClaims(
      [claim("aa", "alice", 1000, "t1", "k", 1), claim("bb", "bob", 200_000, "t1", "k", 2)],
      { ttlMs: TTL, nowMs: 300_000 },
    );
    expect(s.get("t1")!.claimant).toBe("bob");
    expect(s.get("t1")!.epoch).toBe(2);
  });

  it("a stale-view CLAIM (wrong epoch) is IGNORED — never half-honored", () => {
    const s = resolveClaims(
      [claim("aa", "alice", 1000, "t1", "k", 1), claim("bb", "bob", 200_000, "t1", "k", 3)],
      { ttlMs: TTL, nowMs: 300_000 },
    );
    expect(s.get("t1")!.claimant).toBe("alice"); // bob's epoch=3 never landed
    expect(s.get("t1")!.epoch).toBe(1);
    expect(s.get("t1")!.stale).toBe(true); // still reclaimable — at epoch 2
  });

  it("concurrent reclaimers at the same epoch: tie-break picks one, loser is visible", () => {
    const s = resolveClaims(
      [
        claim("aa", "alice", 1000, "t1", "k", 1),
        claim("zz", "bob", 200_000, "t1", "k", 2), // loses: higher id at same ms
        claim("yy", "carol", 200_000, "t1", "k", 2),
      ],
      { ttlMs: TTL, nowMs: 300_000 },
    );
    expect(s.get("t1")!.claimant).toBe("carol"); // lowest id at the winning ms
    expect(s.get("t1")!.epoch).toBe(2);
    // Bob re-resolving sees claimant≠bob at epoch 2 → held=false, no double-work.
  });

  it("epoch bumps on every change of hands, including past DONE", () => {
    const s = resolveClaims(
      [
        claim("aa", "alice", 1000, "t1", "k", 1),
        done("dd", "alice", 2000),
        claim("bb", "bob", 3000, "t1", "k", 2),
        claim("cc", "carol", 300_000, "t1", "k", 3), // bob's claim went stale
      ],
      { ttlMs: TTL, nowMs: 400_000 },
    );
    expect(s.get("t1")!.claimant).toBe("carol");
    expect(s.get("t1")!.epoch).toBe(3);
    expect(s.get("t1")!.done).toBe(false); // re-claim resets terminal markers
  });

  it("a wrong-epoch CLAIM on a never-claimed task is ignored", () => {
    const s = resolveClaims([claim("aa", "alice", 1000, "t1", "k", 2)], { ttlMs: TTL, nowMs: 2000 });
    expect(s.has("t1")).toBe(false);
  });

  it("legacy epoch-less CLAIMs still claim and bump the epoch (mixed fleet)", () => {
    const s = resolveClaims(
      [claim("aa", "alice", 1000, "t1", "k", 1), claim("bb", "bob", 200_000)], // bob is a legacy binary
      { ttlMs: TTL, nowMs: 300_000 },
    );
    expect(s.get("t1")!.claimant).toBe("bob");
    expect(s.get("t1")!.epoch).toBe(2);
  });
});

describe("mentionsMe", () => {
  const base = { myPubkey: "ab".repeat(32), myNpub: "npub1xyz", myNames: ["baofund-agent"] };

  it("matches a p-tag (the trustworthy form)", () => {
    expect(mentionsMe({ ...base, tags: [["p", "ab".repeat(32)]], content: "hi" })).toBe(true);
    expect(mentionsMe({ ...base, tags: [["p", "cd".repeat(32)]], content: "hi" })).toBe(false);
  });

  it("matches the npub inline and name forms (hints)", () => {
    expect(mentionsMe({ ...base, tags: [], content: "cc npub1xyz what do you think" })).toBe(true);
    expect(mentionsMe({ ...base, tags: [], content: "@baofund-agent ping" })).toBe(true);
    expect(mentionsMe({ ...base, tags: [], content: "unrelated" })).toBe(false);
  });

  it("never routes a mention across identities (mosaico demux rule)", () => {
    const alice = { myPubkey: "aa".repeat(32), myNpub: "npub1alice", myNames: ["alice"] };
    // Every mention form for bob must be invisible to alice.
    expect(mentionsMe({ ...alice, tags: [["p", "bb".repeat(32)]], content: "hi" })).toBe(false);
    expect(mentionsMe({ ...alice, tags: [], content: "hey npub1bob look" })).toBe(false);
    expect(mentionsMe({ ...alice, tags: [], content: "@bob ping" })).toBe(false);
    expect(mentionsMe({ ...alice, tags: [], content: "bob: ping" })).toBe(false);
  });
});
