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

function claim(id: string, author: string, ms: number, taskId = "t1", key?: string): ClaimInput {
  const content = `CLAIM ${taskId}${key ? ` key=${key}` : ""}`;
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
});
