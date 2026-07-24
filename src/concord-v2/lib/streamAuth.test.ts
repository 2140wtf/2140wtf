import { verifyEvent } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools/pure";
import { afterEach, describe, expect, it, vi } from "vitest";

import { controlGroupKey, random32 } from "@/concord-v2/lib/derive";
import {
  _resetStreamAuthRegistry,
  isStreamPubkey,
  noteAuthResult,
  noteRelayChallenged,
  noteStreamAuthSent,
  onStreamAuthStale,
  onStreamKeysAdded,
  registerStreamKeys,
  resetRelayAuth,
  signStreamAuths,
  signStreamAuthsChunked,
  streamAuthsSettled,
  streamPubkeys,
  streamPubkeysForRelay,
} from "@/concord-v2/lib/streamAuth";

const RELAY = "wss://relay.example.com";

function makeKey() {
  return controlGroupKey(random32(), random32(), 0n);
}

describe("streamAuth registry", () => {
  afterEach(() => _resetStreamAuthRegistry());

  it("registers keys idempotently and reports only new additions", () => {
    const a = makeKey();
    const b = makeKey();
    expect(registerStreamKeys([a, b])).toEqual([a.pk, b.pk]);
    // Re-registering the same keys adds nothing.
    expect(registerStreamKeys([a, b])).toEqual([]);
    // A mixed batch reports only the genuinely-new one.
    const c = makeKey();
    expect(registerStreamKeys([a, c])).toEqual([c.pk]);
    expect(new Set(streamPubkeys())).toEqual(new Set([a.pk, b.pk, c.pk]));
    expect(isStreamPubkey(a.pk)).toBe(true);
    expect(isStreamPubkey("f".repeat(64))).toBe(false);
  });

  it("notifies listeners with the newly-added pubkeys", () => {
    const seen: string[][] = [];
    const off = onStreamKeysAdded((added) => seen.push(added));
    const a = makeKey();
    registerStreamKeys([a]);
    registerStreamKeys([a]); // no-op, no notification
    off();
    registerStreamKeys([makeKey()]); // after unsubscribe, not seen
    expect(seen).toEqual([[a.pk]]);
  });

  it("signs a valid, verifiable kind-22242 AUTH per registered key", () => {
    const a = makeKey();
    const b = makeKey();
    registerStreamKeys([a, b]);

    const events = signStreamAuths("challenge-xyz", RELAY);
    expect(events).toHaveLength(2);
    for (const ev of events) {
      expect(ev.kind).toBe(22242);
      expect(verifyEvent(ev)).toBe(true);
      expect(ev.tags).toContainEqual(["relay", RELAY]);
      expect(ev.tags).toContainEqual(["challenge", "challenge-xyz"]);
    }
    // Signed by exactly the registered stream keys.
    expect(new Set(events.map((e) => e.pubkey))).toEqual(new Set([a.pk, b.pk]));
  });

  it("signs only the requested subset when given explicit pubkeys", () => {
    const a = makeKey();
    const b = makeKey();
    registerStreamKeys([a, b]);
    const events = signStreamAuths("c", RELAY, [a.pk]);
    expect(events.map((e) => e.pubkey)).toEqual([a.pk]);
  });

  it("scopes keys to their community's relays; unscoped keys sign everywhere", () => {
    const scoped = makeKey();
    const other = makeKey();
    const unscoped = makeKey();
    registerStreamKeys([scoped], [RELAY]);
    registerStreamKeys([other], ["wss://elsewhere.example.com"]);
    registerStreamKeys([unscoped]); // no relays: safe fallback, signs on all

    expect(new Set(streamPubkeysForRelay(RELAY))).toEqual(new Set([scoped.pk, unscoped.pk]));
    // Default signing (no explicit subset) follows the relay scope.
    const events = signStreamAuths("ch", RELAY);
    expect(new Set(events.map((e) => e.pubkey))).toEqual(new Set([scoped.pk, unscoped.pk]));
    // The other relay gets ITS key plus the unscoped one, never `scoped`.
    const elsewhere = signStreamAuths("ch", "wss://elsewhere.example.com");
    expect(new Set(elsewhere.map((e) => e.pubkey))).toEqual(new Set([other.pk, unscoped.pk]));
  });

  it("relay scoping normalizes URLs (trailing slash, bare host)", () => {
    const a = makeKey();
    registerStreamKeys([a], ["wss://relay.example.com/"]);
    expect(streamPubkeysForRelay("wss://relay.example.com")).toEqual([a.pk]);
    expect(streamPubkeysForRelay("relay.example.com")).toEqual([a.pk]);
    expect(streamPubkeysForRelay("wss://unrelated.example.com")).toEqual([]);
  });

  it("scopes only widen: re-registration adds relays, never removes them", () => {
    const a = makeKey();
    registerStreamKeys([a], ["wss://one.example.com"]);
    // A second community sharing the key on another relay widens the scope…
    expect(registerStreamKeys([a], ["wss://two.example.com"])).toEqual([a.pk]);
    // …and re-registering with a subset does NOT narrow it back.
    expect(registerStreamKeys([a], ["wss://one.example.com"])).toEqual([]);
    expect(streamPubkeysForRelay("wss://one.example.com")).toEqual([a.pk]);
    expect(streamPubkeysForRelay("wss://two.example.com")).toEqual([a.pk]);
    // Unscoped registration widens to everywhere; scoped never narrows it.
    registerStreamKeys([a]);
    registerStreamKeys([a], ["wss://one.example.com"]);
    expect(streamPubkeysForRelay("wss://anywhere.example.com")).toEqual([a.pk]);
  });

  it("an empty relay list falls back to unscoped, never scope-to-nowhere", () => {
    const a = makeKey();
    registerStreamKeys([a], []);
    expect(streamPubkeysForRelay(RELAY)).toEqual([a.pk]);
  });

  it("notifies listeners on scope widening (a challenged socket may need re-auth)", () => {
    const seen: string[][] = [];
    const a = makeKey();
    registerStreamKeys([a], ["wss://one.example.com"]);
    const off = onStreamKeysAdded((added) => seen.push(added));
    registerStreamKeys([a], ["wss://one.example.com"]); // identical: silent
    registerStreamKeys([a], ["wss://two.example.com"]); // widened: notify
    off();
    expect(seen).toEqual([[a.pk]]);
  });

  it("signStreamAuthsChunked yields the event loop between chunks", async () => {
    // 40 keys spans 3 chunks of 16. A macrotask queued at start must run
    // BEFORE iteration finishes — proving the loop yields instead of
    // monopolizing the thread (each signature is ~4ms of EC work).
    const keys = Array.from({ length: 40 }, () => makeKey());
    registerStreamKeys(keys, [RELAY]);

    let interleaved = false;
    let done = false;
    setTimeout(() => {
      interleaved = !done;
    }, 0);

    const events: NostrEvent[] = [];
    for await (const chunk of signStreamAuthsChunked("ch", RELAY)) {
      events.push(...chunk);
    }
    done = true;

    expect(events).toHaveLength(40);
    expect(new Set(events.map((e) => e.pubkey))).toEqual(new Set(keys.map((k) => k.pk)));
    for (const ev of events.slice(0, 2)) expect(verifyEvent(ev)).toBe(true);
    expect(interleaved).toBe(true);
  });
});

describe("streamAuth per-relay ack state", () => {
  afterEach(() => _resetStreamAuthRegistry());

  it("an unchallenged relay is always settled (nothing to wait for)", () => {
    const a = makeKey();
    registerStreamKeys([a], [RELAY]);
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(true);
  });

  it("a challenged relay settles per-pubkey as the relay acks each AUTH", () => {
    const a = makeKey();
    const b = makeKey();
    registerStreamKeys([a, b], [RELAY]);
    noteRelayChallenged(RELAY);
    expect(streamAuthsSettled(RELAY, [a.pk, b.pk])).toBe(false);

    noteStreamAuthSent(RELAY, "ev-a", a.pk);
    noteStreamAuthSent(RELAY, "ev-b", b.pk);
    noteAuthResult(RELAY, "ev-a", true);
    expect(streamAuthsSettled(RELAY, [a.pk]), "acked key is settled").toBe(true);
    expect(streamAuthsSettled(RELAY, [a.pk, b.pk]), "unacked key still holds").toBe(false);

    noteAuthResult(RELAY, "ev-b", true);
    expect(streamAuthsSettled(RELAY, [a.pk, b.pk])).toBe(true);
  });

  it("a rejected AUTH (OK false) does not settle, and unknown OK ids are ignored", () => {
    const a = makeKey();
    registerStreamKeys([a], [RELAY]);
    noteRelayChallenged(RELAY);
    noteStreamAuthSent(RELAY, "ev-a", a.pk);
    noteAuthResult(RELAY, "unrelated-publish-ok", true); // e.g. an EVENT's OK
    noteAuthResult(RELAY, "ev-a", false);
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(false);
  });

  it("resetRelayAuth clears the live-socket session (reconnect = fresh unauthenticated socket)", () => {
    const a = makeKey();
    registerStreamKeys([a], [RELAY]);
    noteRelayChallenged(RELAY);
    noteStreamAuthSent(RELAY, "ev-a", a.pk);
    noteAuthResult(RELAY, "ev-a", true);
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(true);

    resetRelayAuth(RELAY);
    // Unchallenged again — settled until the new socket's challenge arrives…
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(true);
    // …after which the old acks must NOT count.
    noteRelayChallenged(RELAY);
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(false);
  });

  it("ack state normalizes relay URLs", () => {
    const a = makeKey();
    registerStreamKeys([a], [RELAY]);
    noteRelayChallenged("wss://relay.example.com/");
    noteStreamAuthSent("relay.example.com", "ev-a", a.pk);
    noteAuthResult(`${RELAY}/`, "ev-a", true);
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(true);
  });
});

describe("streamAuth self-heal (never wedge until a restart)", () => {
  afterEach(() => {
    _resetStreamAuthRegistry();
    vi.useRealTimers();
  });

  it("a challenged-but-unacked relay self-heals past the stale window: reports settled AND fires a re-auth", () => {
    vi.useFakeTimers();
    const a = makeKey();
    registerStreamKeys([a], [RELAY]);
    noteRelayChallenged(RELAY);

    const reauthed: string[] = [];
    const off = onStreamAuthStale((url) => reauthed.push(url));

    // Inside the fresh-challenge window: still unsettled (a slow live ack wins).
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(false);
    expect(reauthed).toEqual([]);

    // Past the stale window: an AUTH frame or its OK was lost. Stop blocking
    // sweeps forever (the old restart-only wedge) and trigger a re-auth.
    vi.advanceTimersByTime(13_000);
    expect(streamAuthsSettled(RELAY, [a.pk]), "stale relay must stop reporting unsettled").toBe(true);
    expect(reauthed, "a re-auth must be fired for the stale relay").toEqual([RELAY]);

    off();
  });

  it("a re-auth that lands (OK acks arrive) settles cleanly without further re-auth storms", () => {
    vi.useFakeTimers();
    const a = makeKey();
    registerStreamKeys([a], [RELAY]);
    noteRelayChallenged(RELAY);

    let reauthCount = 0;
    const off = onStreamAuthStale(() => reauthCount++);

    vi.advanceTimersByTime(13_000);
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(true); // heals, fires re-auth #1
    expect(reauthCount).toBe(1);

    // The re-auth's AUTH lands and the relay acks it.
    noteStreamAuthSent(RELAY, "ev-a2", a.pk);
    noteAuthResult(RELAY, "ev-a2", true);

    // Now genuinely settled — no more re-auths regardless of how much time passes.
    vi.advanceTimersByTime(60_000);
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(true);
    expect(reauthCount, "an acked relay must not keep firing re-auths").toBe(1);

    off();
  });

  it("re-arms the window so a stale relay fires ONE re-auth per window, not a storm", () => {
    vi.useFakeTimers();
    const a = makeKey();
    registerStreamKeys([a], [RELAY]);
    noteRelayChallenged(RELAY);

    let reauthCount = 0;
    const off = onStreamAuthStale(() => reauthCount++);

    vi.advanceTimersByTime(13_000);
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(true); // heals, fires re-auth #1
    expect(reauthCount).toBe(1);

    // Immediately re-checking (the sweep polls every ~50ms) must NOT re-fire —
    // the window was re-armed, so the gate goes back to WAITING for the
    // re-auth's ack (returns false) rather than firing another re-auth.
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(false);
    expect(reauthCount).toBe(1);

    // Only after the NEW window elapses without an ack does it heal + fire again.
    vi.advanceTimersByTime(13_000);
    expect(streamAuthsSettled(RELAY, [a.pk])).toBe(true);
    expect(reauthCount).toBe(2);

    off();
  });
});
