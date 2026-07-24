/**
 * Write-batching proofs for the wire's plaintext ingest path, and a
 * regression guard pinning the fixed behavior.
 *
 * NIndexedDB batches writes: `event()` parks the event in a `pendingWrites`
 * map and resolves only when the burst commits, and the flush is scheduled on
 * `requestIdleCallback` (1s timeout fallback). Committing requires an idle
 * window; on a busy main thread (APK backfill: NIP-44 decrypts + Schnorr
 * verifies) rIC starves toward that timeout.
 *
 * The first two tests prove the mechanism, deterministic because the test
 * controls the idle queue:
 *
 *   - SERIAL pattern (`for (ev) await store.event(ev)`): each call resolves
 *     only with that event's OWN flush, so event k+1 isn't even submitted
 *     until event k has committed — N events need N idle windows and commit
 *     in N single-event readwrite transactions.
 *   - BATCHED pattern (submit all, then `Promise.all`): the burst collapses
 *     onto ONE scheduled flush — one idle window, one transaction.
 *
 * The third test pins `wire/ingest.ts` to the batched pattern (it originally
 * used the serial one: a 5-event ingest needed 5 idle windows, and the UI
 * bus stayed silent until the 5th — see git history). The fourth shows the
 * wall-clock amplification a starved main thread gives the serial pattern.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBDatabase } from "fake-indexeddb";
import { NIndexedDB } from "@nostrify/indexeddb";
import type { NostrEvent } from "@nostrify/nostrify";

import { ingestWireEvents, type WireSinks } from "@/wire/ingest";
import { onWireScopes, resetWireBus } from "@/wire/bus";

// ── event factory ────────────────────────────────────────────────────────────

/** A plaintext NIP-29 group-chat message (the wire's `plain` path). */
function chatEvent(n: number, groupId = "g1"): NostrEvent {
  return {
    id: n.toString(16).padStart(64, "0"),
    pubkey: "ab".repeat(32),
    created_at: 1_700_000_000 + n,
    kind: 9, // KIND_GROUP_CHAT
    tags: [["h", groupId]],
    content: `message ${n}`,
    sig: "cd".repeat(64),
  };
}

// ── controllable idle queue ──────────────────────────────────────────────────

type ScheduledCb = () => void;

let savedRic: unknown;
let savedCancelRic: unknown;
let hadRic = false;
let hadCancelRic = false;

/** Replace requestIdleCallback with a stub whose scheduling the test controls. */
function installIdleStub(schedule: (cb: ScheduledCb) => void): void {
  const g = globalThis as Record<string, unknown>;
  hadRic = "requestIdleCallback" in g;
  hadCancelRic = "cancelIdleCallback" in g;
  savedRic = g.requestIdleCallback;
  savedCancelRic = g.cancelIdleCallback;
  g.requestIdleCallback = (cb: IdleRequestCallback) => {
    schedule(() =>
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline),
    );
    return 1;
  };
  g.cancelIdleCallback = () => undefined;
}

function uninstallIdleStub(): void {
  const g = globalThis as Record<string, unknown>;
  if (hadRic) g.requestIdleCallback = savedRic;
  else delete g.requestIdleCallback;
  if (hadCancelRic) g.cancelIdleCallback = savedCancelRic;
  else delete g.cancelIdleCallback;
}

/** Let queued microtasks and fake-indexeddb completion events settle. */
async function settle(ticks = 5): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ── transaction counting ─────────────────────────────────────────────────────

let readwriteTxs = 0;
const originalTransaction = IDBDatabase.prototype.transaction;

function installTxCounter(): void {
  readwriteTxs = 0;
  IDBDatabase.prototype.transaction = function (
    this: IDBDatabase,
    storeNames: string | string[],
    mode?: IDBTransactionMode,
  ) {
    if (mode === "readwrite") readwriteTxs++;
    return originalTransaction.call(this, storeNames, mode);
  } as typeof IDBDatabase.prototype.transaction;
}

function uninstallTxCounter(): void {
  IDBDatabase.prototype.transaction = originalTransaction;
}

// ── store lifecycle ──────────────────────────────────────────────────────────

let dbCounter = 0;
const dbNames: string[] = [];
const stores: NIndexedDB[] = [];

function makeStore(): NIndexedDB {
  const name = `batching-proof-${Date.now()}-${dbCounter++}`;
  dbNames.push(name);
  const store = new NIndexedDB(name);
  stores.push(store);
  return store;
}

async function cleanupStores(): Promise<void> {
  for (const store of stores.splice(0)) await store.close();
  for (const name of dbNames.splice(0)) {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  }
}

// ── the two patterns under test ──────────────────────────────────────────────

/** The current wire/ingest.ts plaintext pattern. */
async function serialWrite(store: NIndexedDB, events: NostrEvent[]): Promise<void> {
  for (const ev of events) {
    await store.event(ev);
  }
}

/** The proposed pattern: submit everything, await the single shared flush. */
async function batchedWrite(store: NIndexedDB, events: NostrEvent[]): Promise<void> {
  await Promise.all(events.map((ev) => store.event(ev)));
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("write batching: pattern proofs + the wire ingest regression guard", () => {
  /** Idle callbacks the store has scheduled, fired only when the test pumps. */
  let idleQueue: ScheduledCb[];

  /** Fire every queued idle callback once — one "idle window" — then settle. */
  async function pumpIdleWindow(): Promise<void> {
    const cbs = idleQueue.splice(0);
    for (const cb of cbs) cb();
    await settle();
  }

  beforeEach(() => {
    idleQueue = [];
    installIdleStub((cb) => idleQueue.push(cb));
    installTxCounter();
  });

  afterEach(async () => {
    uninstallIdleStub();
    uninstallTxCounter();
    resetWireBus();
    await cleanupStores();
  });

  it("serial await: N events need N idle windows and N transactions, one event each", async () => {
    const store = makeStore();
    const events = [chatEvent(1), chatEvent(2), chatEvent(3), chatEvent(4), chatEvent(5)];

    const done = serialWrite(store, events);

    for (let k = 1; k <= events.length; k++) {
      await settle(); // let the loop reach its k-th await
      // Exactly one flush is pending — the k-th event's own.
      expect(idleQueue.length).toBe(1);
      await pumpIdleWindow();
      // After k idle windows, only the first k events are durably committed.
      const stored = await store.query([{ kinds: [9] }]);
      expect(stored.map((e) => e.id).sort()).toEqual(
        events.slice(0, k).map((e) => e.id).sort(),
      );
    }

    await done;
    // One readwrite transaction PER EVENT — the batching never batches.
    expect(readwriteTxs).toBe(events.length);
  });

  it("batched writes: N events commit in 1 idle window and 1 transaction", async () => {
    const store = makeStore();
    const events = [chatEvent(1), chatEvent(2), chatEvent(3), chatEvent(4), chatEvent(5)];

    const done = batchedWrite(store, events);

    await settle();
    // All five writes collapsed onto ONE scheduled flush.
    expect(idleQueue.length).toBe(1);
    await pumpIdleWindow();

    const stored = await store.query([{ kinds: [9] }]);
    expect(stored.map((e) => e.id).sort()).toEqual(events.map((e) => e.id).sort());

    await done;
    expect(readwriteTxs).toBe(1);
    // No idle work left behind.
    expect(idleQueue.length).toBe(0);
  });

  it("regression: the REAL wire ingest commits a backfill batch in ONE idle window, then rings the bus", async () => {
    const store = makeStore();
    const events = [chatEvent(1), chatEvent(2), chatEvent(3), chatEvent(4), chatEvent(5)];

    const sinks: WireSinks = {
      eventStore: Promise.resolve(store),
      getSpec: () => undefined,
      getSelfPubkey: () => undefined,
    };

    const busEvents: ReadonlySet<string>[] = [];
    const unsub = onWireScopes((scopes) => busEvents.push(scopes));

    const done = ingestWireEvents(sinks, events, { live: false });

    // The whole batch collapses onto ONE scheduled flush…
    await settle();
    expect(idleQueue.length).toBe(1);

    // …and the bus must NOT ring before the commit: a doorbell sent early
    // would send hooks re-reading a store that can't see these events yet.
    await new Promise((r) => setTimeout(r, 60)); // bus coalesce window (50ms)
    expect(busEvents.length).toBe(0);

    await pumpIdleWindow();
    await done;

    // ONE idle window committed all five events, in a single transaction.
    expect((await store.query([{ kinds: [9] }])).length).toBe(events.length);
    expect(readwriteTxs).toBe(1);
    expect(idleQueue.length).toBe(0);

    // And only now does the bus ring — once, naming the group scope.
    await new Promise((r) => setTimeout(r, 60));
    expect(busEvents.length).toBe(1);
    expect([...busEvents[0]]).toEqual(["nip29:g1"]);

    unsub();
  });
});

describe("proof: wall-clock amplification under a starved main thread", () => {
  afterEach(async () => {
    uninstallIdleStub();
    await cleanupStores();
  });

  it("serial await multiplies the idle delay by N; batching pays it once", async () => {
    // Simulate a busy main thread: an idle callback only fires after 50ms
    // (real Chromium rIC under load starves up to the 1s timeout — 50ms here
    // keeps the test fast while proving the multiplication).
    const IDLE_DELAY_MS = 50;
    installIdleStub((cb) => {
      setTimeout(cb, IDLE_DELAY_MS);
    });

    const events = [chatEvent(1), chatEvent(2), chatEvent(3), chatEvent(4), chatEvent(5)];

    const serialStore = makeStore();
    const t0 = Date.now();
    await serialWrite(serialStore, events);
    const serialMs = Date.now() - t0;

    const batchedStore = makeStore();
    const t1 = Date.now();
    await batchedWrite(batchedStore, events);
    const batchedMs = Date.now() - t1;

    // Serial pays the idle delay once PER EVENT (5 × 50ms = 250ms; allow
    // generous slack for scheduling jitter). Batched pays it ONCE.
    expect(serialMs).toBeGreaterThanOrEqual(events.length * IDLE_DELAY_MS * 0.8);
    expect(batchedMs).toBeLessThan(events.length * IDLE_DELAY_MS * 0.8);
  });
});
