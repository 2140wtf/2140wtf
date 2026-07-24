import { beforeEach, describe, expect, it } from "vitest";

import { addReadCutPending, clearReadCutPending, readCutPending } from "@/concord-v2/lib/readCutPending";

const ME = "me".padEnd(64, "0");
const CID = "cid".padEnd(64, "0");
const A = "aa".repeat(32);
const B = "bb".repeat(32);
const C = "cc".repeat(32);

describe("readCutPending", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips targets + keep, and empties to undefined", () => {
    expect(readCutPending(ME, CID)).toBeUndefined();
    addReadCutPending(ME, CID, A, [B, C]);
    expect(readCutPending(ME, CID)).toEqual({ targets: [A], keep: [B, C] });
    clearReadCutPending(ME, CID);
    expect(readCutPending(ME, CID)).toBeUndefined();
  });

  it("never keeps a target in the keep-list (the persisted keep drives the retry's recipients)", () => {
    // Ban A keeping {B, C}; then ban B keeping {C} — B must leave the keep set.
    addReadCutPending(ME, CID, A, [B, C]);
    addReadCutPending(ME, CID, B, [C]);
    const pending = readCutPending(ME, CID)!;
    expect(new Set(pending.targets)).toEqual(new Set([A, B]));
    expect(pending.keep).not.toContain(A);
    expect(pending.keep).not.toContain(B);
    expect(pending.keep).toContain(C);
  });

  it("is scoped per (account, community)", () => {
    addReadCutPending(ME, CID, A, [B]);
    expect(readCutPending("other".padEnd(64, "0"), CID)).toBeUndefined();
    expect(readCutPending(ME, "other".padEnd(64, "0"))).toBeUndefined();
  });

  it("ignores malformed stored JSON", () => {
    localStorage.setItem(`concord2:read-cut-pending:${ME}:${CID}`, "{ not json");
    expect(readCutPending(ME, CID)).toBeUndefined();
    localStorage.setItem(`concord2:read-cut-pending:${ME}:${CID}`, JSON.stringify({ targets: "x", keep: [] }));
    expect(readCutPending(ME, CID)).toBeUndefined();
  });
});
