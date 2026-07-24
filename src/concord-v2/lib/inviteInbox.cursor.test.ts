import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { advanceInviteInboxCursor, inviteInboxSince } from "@/concord-v2/lib/inviteInbox";

// A clean IndexedDB for the suite (the store singleton opens against it lazily).
(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();

const now = () => Math.floor(Date.now() / 1000);

describe("advanceInviteInboxCursor future-stamp clamp", () => {
  it("advances monotonically for normal timestamps", async () => {
    const pk = "aa".repeat(32);
    await advanceInviteInboxCursor(pk, now() - 5000);
    const first = await inviteInboxSince(pk);
    await advanceInviteInboxCursor(pk, now() - 1000);
    const second = await inviteInboxSince(pk);
    expect(second).toBeGreaterThan(first);
    // An older wrap never regresses the cursor.
    await advanceInviteInboxCursor(pk, now() - 4000);
    expect(await inviteInboxSince(pk)).toBe(second);
  });

  it("clamps a future-stamped wrap to the local clock", async () => {
    const pk = "bb".repeat(32);
    await advanceInviteInboxCursor(pk, now() + 86_400);
    // since stays near now (within the backdate window) instead of a day in
    // the future (which would wedge the inbox REQ permanently).
    const since = await inviteInboxSince(pk);
    expect(since).toBeLessThanOrEqual(now());
    expect(since).toBeGreaterThanOrEqual(now() - 2 * 86_400);
  });

  it("self-heals a legacy poisoned (future) cursor", async () => {
    const pk = "cc".repeat(32);
    await advanceInviteInboxCursor(pk, now() + 86_400);
    // A subsequent honest write keeps the healed cursor near now.
    await advanceInviteInboxCursor(pk, now() - 60);
    expect(await inviteInboxSince(pk)).toBeLessThanOrEqual(now());
  });
});
