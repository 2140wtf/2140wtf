import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { readStreamCursor, updateStreamCursor } from "@/concord-v2/lib/rumorStore";

// A clean IndexedDB for the suite (the store singleton opens against it lazily).
(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();

const now = () => Math.floor(Date.now() / 1000);

describe("updateStreamCursor future-stamp clamp", () => {
  it("advances newest monotonically for normal timestamps", async () => {
    const scope = "test:clamp:normal";
    // Capture the clock ONCE: each now() below is separated by an awaited
    // IndexedDB round-trip, so a second-boundary flip mid-test makes the
    // expected value drift by one and flakes the suite.
    const t = now();
    await updateStreamCursor(scope, { newest: t - 500 });
    await updateStreamCursor(scope, { newest: t - 100 });
    expect((await readStreamCursor(scope))?.newest).toBe(t - 100);
    // An older patch never regresses the cursor.
    await updateStreamCursor(scope, { newest: t - 400 });
    expect((await readStreamCursor(scope))?.newest).toBe(t - 100);
  });

  it("clamps a future-stamped newest to the local clock", async () => {
    const scope = "test:clamp:future";
    await updateStreamCursor(scope, { newest: now() + 86_400 });
    const newest = (await readStreamCursor(scope))?.newest ?? 0;
    expect(newest).toBeLessThanOrEqual(now());
    expect(newest).toBeGreaterThan(now() - 60);
  });

  it("self-heals a legacy poisoned (future) cursor on the next write", async () => {
    const scope = "test:clamp:heal";
    await updateStreamCursor(scope, { newest: now() + 86_400 });
    // Pulled down to ~now instead of wedging a day in the future…
    const healed = (await readStreamCursor(scope))?.newest ?? 0;
    expect(healed).toBeLessThanOrEqual(now());
    // …honestly-stamped events keep it there (monotonic, never regresses).
    await updateStreamCursor(scope, { newest: now() - 60 });
    expect((await readStreamCursor(scope))?.newest).toBe(healed);
  });
});
