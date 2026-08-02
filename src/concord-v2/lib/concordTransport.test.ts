import { getPublicKey, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";

import type { GroupKey } from "./derive";
import { ConcordTransport, type ConcordRelayFactory } from "./concordTransport";

const id = (digit: string) => digit.repeat(64);
const group = (digit: number): GroupKey => {
  const sk = new Uint8Array(32); sk[31] = digit;
  return { sk, pk: getPublicKey(sk), convKey: new Uint8Array(32).fill(digit) };
};

interface FakeConnection {
  url: string;
  auth: (challenge: string) => Promise<import("@nostrify/nostrify").NostrEvent>;
  frames: string[];
  close: ReturnType<typeof vi.fn>;
  relay?: ReturnType<ConcordRelayFactory>;
  emit(type: string, event: unknown): void;
}

function harness(autoAck = true) {
  const connections: FakeConnection[] = [];
  const factory: ConcordRelayFactory = (url, auth) => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const connection = {
      url,
      auth,
      frames: [],
      close: vi.fn(async () => undefined),
      emit: (type: string, event: unknown) => {
        for (const listener of listeners.get(type) ?? []) listener(event);
      },
    } as FakeConnection;
    const relay = {
      socket: {
        send: (frame: string) => {
          connection.frames.push(frame);
          const parsed = JSON.parse(frame) as [string, import("@nostrify/nostrify").NostrEvent];
          if (autoAck && parsed[0] === "AUTH") {
            queueMicrotask(() => {
              connection.emit("message", { data: JSON.stringify(["OK", parsed[1].id, true, "auth accepted"]) });
            });
          }
        },
        addEventListener: (type: string, listener: (...args: unknown[]) => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      },
      query: vi.fn(async () => []),
      req: vi.fn(() => ({ async *[Symbol.asyncIterator]() { /* empty */ } })),
      event: vi.fn(async () => undefined),
      close: connection.close,
    } as unknown as ReturnType<ConcordRelayFactory>;
    connection.relay = relay;
    connections.push(connection);
    return relay;
  };
  return { connections, factory };
}

describe("community-isolated Concord transport", () => {
  it("uses distinct sessions for two communities sharing one relay", () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    expect(transport.relay(id("1"), "wss://relay.example", [group(1)]))
      .not.toBe(transport.relay(id("2"), "wss://relay.example", [group(2)]));
    expect(h.connections).toHaveLength(2);
  });

  it("never crosses stream identities between same-relay community challenges", async () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    const a = group(1); const b = group(2);
    transport.relay(id("1"), "wss://relay.example", [a]);
    transport.relay(id("2"), "wss://relay.example", [b]);
    const [aAuth, bAuth] = await Promise.all([
      h.connections[0].auth("challenge-a"),
      h.connections[1].auth("challenge-b"),
    ]);
    expect(aAuth.pubkey).toBe(a.pk);
    expect(bAuth.pubkey).toBe(b.pk);
    expect(h.connections[0].frames).toEqual([]);
    expect(h.connections[1].frames).toEqual([]);
  });

  it("uses distinct sessions for one community on different relays", () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    const key = group(1);
    expect(transport.relay(id("1"), "wss://one.example", [key]))
      .not.toBe(transport.relay(id("1"), "wss://two.example", [key]));
    expect(h.connections.map((connection) => connection.url)).toEqual([
      "wss://one.example",
      "wss://two.example",
    ]);
  });

  it("authenticates only keys registered to that community session", async () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    const a = group(1); const b = group(2);
    transport.relay(id("1"), "wss://relay.example", [a, b]);
    const first = await h.connections[0].auth("challenge-a");
    const raw = h.connections[0].frames.map((frame) => JSON.parse(frame) as [string, import("@nostrify/nostrify").NostrEvent]);
    const events = [first, ...raw.map(([, event]) => event)];
    expect(new Set(events.map((event) => event.pubkey))).toEqual(new Set([a.pk, b.pk]));
    expect(events.every((event) => verifyEvent(event) && event.tags.some((tag) => tag[0] === "challenge" && tag[1] === "challenge-a"))).toBe(true);
    expect(events.every((event) => event.tags.some((tag) => tag[0] === "relay" && tag[1] === "wss://relay.example"))).toBe(true);
  });

  it("does not widen an authenticated socket when a new capability is requested", async () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    const a = group(1); const b = group(2);
    transport.relay(id("1"), "wss://relay.example", [a]);
    await h.connections[0].auth("challenge-a");
    transport.relay(id("1"), "wss://relay.example", [b]);
    expect(h.connections).toHaveLength(2);
    expect(h.connections[0].frames).toEqual([]);
    expect((await h.connections[1].auth("challenge-b")).pubkey).toBe(b.pk);
  });

  it("holds the primary AUTH until every secondary stream identity is accepted", async () => {
    const h = harness(false);
    const transport = new ConcordTransport(h.factory);
    transport.relay(id("1"), "wss://relay.example", [group(1), group(2)]);
    let settled = false;
    const primary = h.connections[0].auth("challenge-a").finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    const [, secondary] = JSON.parse(h.connections[0].frames[0]) as [string, import("@nostrify/nostrify").NostrEvent];
    h.connections[0].emit("message", {
      data: JSON.stringify(["OK", secondary.id, true, "auth accepted"]),
    });
    await expect(primary).resolves.toMatchObject({ kind: 22242 });
  });

  it("fails the handshake when a secondary stream identity is rejected", async () => {
    const h = harness(false);
    const transport = new ConcordTransport(h.factory);
    transport.relay(id("1"), "wss://relay.example", [group(1), group(2)]);
    const auth = h.connections[0].auth("challenge-a");
    await Promise.resolve();
    const [, secondary] = JSON.parse(h.connections[0].frames[0]) as [string, import("@nostrify/nostrify").NostrEvent];
    h.connections[0].emit("message", {
      data: JSON.stringify(["OK", secondary.id, false, "denied"]),
    });
    await expect(auth).rejects.toThrow(/rejected or timed out/);
  });

  it("rejects an AUTH flow superseded by a newer challenge", async () => {
    const h = harness(false);
    const transport = new ConcordTransport(h.factory);
    transport.relay(id("1"), "wss://relay.example", [group(1), group(2)]);
    const old = h.connections[0].auth("challenge-a");
    await Promise.resolve();
    const current = h.connections[0].auth("challenge-b");
    await expect(old).rejects.toThrow(/rejected or timed out|superseded/);
    await Promise.resolve();
    const [, secondary] = JSON.parse(h.connections[0].frames.at(-1) ?? "null") as [string, import("@nostrify/nostrify").NostrEvent];
    h.connections[0].emit("message", {
      data: JSON.stringify(["OK", secondary.id, true, "accepted"]),
    });
    await expect(current).resolves.toMatchObject({ kind: 22242 });
  });

  it("rejects conflicting conversation keys for an existing stream identity", () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    const original = group(1);
    transport.relay(id("1"), "wss://relay.example", [original]);
    expect(() => transport.relay(id("1"), "wss://relay.example", [{
      ...original,
      convKey: new Uint8Array(32).fill(9),
    }])).toThrow(/Conflicting Concord key material/);
  });

  it("blocks cross-community filters and publishes before network I/O", async () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    const a = group(1); const b = group(2);
    const relay = transport.relay(id("1"), "wss://relay.example", [a]);
    expect(() => relay.query([{ kinds: [1059], authors: [b.pk] }])).toThrow(/Cross-scope/);
    expect(() => relay.query([{ kinds: [21059], authors: [b.pk] }])).toThrow(/Cross-scope/);
    expect(() => relay.query([{ kinds: [21059] }])).toThrow(/Cross-scope/);
    expect(() => relay.query([{ kinds: [39000], authors: [b.pk] }])).toThrow(/Cross-scope/);
    expect(() => relay.event({ id: id("a"), pubkey: b.pk, kind: 1059, created_at: 1, content: "", tags: [], sig: id("b") })).toThrow(/Cross-scope/);
  });

  it("closes and replaces every old session on account switch", () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    transport.resetAccount(id("a"));
    transport.relay(id("1"), "wss://relay.example", [group(1)]);
    transport.resetAccount(id("b"));
    expect(h.connections[0].close).toHaveBeenCalledOnce();
    transport.relay(id("1"), "wss://relay.example", [group(2)]);
    expect(h.connections).toHaveLength(2);
  });

  it("closes only the departed community's sessions", () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    transport.relay(id("1"), "wss://relay.example", [group(1)]);
    transport.relay(id("2"), "wss://relay.example", [group(2)]);
    transport.closeCommunity(id("1"));
    expect(h.connections[0].close).toHaveBeenCalledOnce();
    expect(h.connections[1].close).not.toHaveBeenCalled();
  });

  it("rotates the socket to shrink its authenticated keyset", async () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    const a = group(1); const b = group(2);
    transport.relay(id("1"), "wss://relay.example", [a, b]);
    await h.connections[0].auth("old");
    transport.closeCommunity(id("1"));
    transport.relay(id("1"), "wss://relay.example", [b]);
    const current = await h.connections[1].auth("new");
    expect(current.pubkey).toBe(b.pk);
    expect(h.connections[1].frames).toEqual([]);
  });

  it("watches replacement sockets and clears stale challenge state on reopen", async () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    const relay = transport.relay(id("1"), "wss://relay.example", [group(1)]);
    await h.connections[0].auth("old-challenge");
    const reopened = vi.fn();
    relay.onReopen(reopened);

    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    h.connections[0].relay!.socket = {
      send: vi.fn(),
      addEventListener: (type: string, listener: (...args: unknown[]) => void) =>
        listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    } as unknown as ReturnType<ConcordRelayFactory>["socket"];
    for (const listener of listeners.get("open") ?? []) listener();

    expect(reopened).toHaveBeenCalledOnce();
    const fresh = await h.connections[0].auth("new-challenge");
    expect(fresh.pubkey).toBe(group(1).pk);
    expect(fresh.tags).toContainEqual(["challenge", "new-challenge"]);
  });

  it("makes stale handles unusable after account reset", () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    transport.resetAccount(id("a"));
    const relay = transport.relay(id("1"), "wss://relay.example", [group(1)]);
    transport.resetAccount(id("b"));
    expect(() => relay.query([{ kinds: [1059], authors: [group(1).pk] }])).toThrow(/closed/);
    expect(() => relay.event({ id: id("a"), pubkey: group(1).pk, kind: 1059, created_at: 1, content: "", tags: [], sig: id("b") })).toThrow(/closed/);
  });

  it("prevents stale clients from recreating sessions after leave or account switch", () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    transport.resetAccount(id("a"));
    const left = transport.client(id("1"), [group(1)]);
    left.relay("wss://relay.example");
    transport.closeCommunity(id("1"));
    expect(() => left.relay("wss://relay.example")).toThrow(/revoked/);

    const switched = transport.client(id("2"), [group(2)]);
    transport.resetAccount(id("b"));
    expect(() => switched.relay("wss://relay.example")).toThrow(/revoked/);
    expect(h.connections).toHaveLength(1);
  });

  it("revokes a closed one-shot capability without disturbing its community", () => {
    const h = harness();
    const transport = new ConcordTransport(h.factory);
    const key = group(1);
    const oneShot = transport.client(id("1"), [key]);
    oneShot.relay("wss://relay.example");
    transport.closeCapability(id("1"), [key]);
    expect(() => oneShot.relay("wss://relay.example")).toThrow(/revoked/);
    expect(transport.client(id("1"), [group(2)]).relay("wss://relay.example")).toBeDefined();
  });
});
