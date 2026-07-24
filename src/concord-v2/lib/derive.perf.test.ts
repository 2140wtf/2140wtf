/**
 * Performance guard for `groupKey` derivation (derive.ts).
 *
 * History: a user report ("doing the key derivation every single time a
 * channel key is needed is very inefficient") proved out — every `groupKey()`
 * call costs one HKDF-SHA256 plus TWO secp256k1 point multiplications (~4ms
 * each in this environment), nothing memoized it, and the app re-derives the
 * full key set of EVERY community on short polls (stream-auth registration
 * each 20s in useStreamAuth2, subscription/wire rebuilds each 60s/2min).
 * Measured uncached: ~2.1s of blocking crypto per 20s poll at 10 communities ×
 * 20 channels × 2 held roots (~10% of the main thread), ~13s per poll at
 * 30 × 30 × 3 — the poll outran its own interval. Phones run 5-10x slower.
 *
 * The fix memoizes `groupKey()` on its inputs (sound: CORD-02 Appendix A is a
 * frozen pure function, consumers never mutate GroupKeys). These tests prove
 * cache hits are near-free and pin that behavior against regression.
 */

import { describe, expect, it } from "vitest";

import { sha256 } from "@noble/hashes/sha2.js";

import { channelsView } from "@/concord-v2/lib/community";
import {
  baseRekeyGroupKey,
  bytesToHex,
  channelGroupKey,
  controlGroupKey,
  dissolvedGroupKey,
  guestbookGroupKey,
  type GroupKey,
} from "@/concord-v2/lib/derive";
import type { FoldedChannel, FoldedControl } from "@/concord-v2/lib/control";
import type { CommunityV2 } from "@/concord-v2/lib/types";

// ── Deterministic fixtures ───────────────────────────────────────────────────

/** Deterministic 32 bytes from a label (stable across runs). */
function b32(label: string): Uint8Array {
  return sha256(new TextEncoder().encode(label));
}

function makeCommunity(n: number, heldRootCount: number): CommunityV2 {
  const id = b32(`community-${n}`);
  const heldRoots = Array.from({ length: heldRootCount }, (_, i) => ({
    // Newest first, like communityList rehydration.
    epoch: BigInt(heldRootCount - 1 - i),
    key: b32(`root-${n}-${heldRootCount - 1 - i}`),
  }));
  return {
    id,
    idHex: bytesToHex(id),
    owner: bytesToHex(b32(`owner-${n}`)),
    ownerSalt: b32(`salt-${n}`),
    root: heldRoots[0].key,
    rootEpoch: heldRoots[0].epoch,
    heldRoots,
    privateChannels: [],
    relays: ["wss://relay.example.com"],
    name: `community-${n}`,
  };
}

function makeFolded(communityN: number, channelCount: number): FoldedControl {
  const channels = new Map<string, FoldedChannel>();
  for (let i = 0; i < channelCount; i++) {
    const idHex = bytesToHex(b32(`channel-${communityN}-${i}`));
    channels.set(idHex, {
      channelIdHex: idHex,
      name: `channel-${i}`,
      isPrivate: false,
      deleted: false,
    });
  }
  // channelsView only reads `.channels`; the rest of the fold is irrelevant here.
  return { channels } as unknown as FoldedControl;
}

/** Mirror of useStreamAuth2.ts `communityCoreKeys` (not exported). */
function coreKeys(community: CommunityV2): GroupKey[] {
  const keys: GroupKey[] = [];
  for (const r of community.heldRoots) {
    keys.push(controlGroupKey(r.key, community.id, r.epoch));
    keys.push(guestbookGroupKey(r.key, community.id, r.epoch));
  }
  keys.push(dissolvedGroupKey(community.id));
  keys.push(baseRekeyGroupKey(community.root, community.id, community.rootEpoch + 1n));
  return keys;
}

/**
 * One full useRegisterAllStreamKeys2 pass (the 20-second poll), minus the
 * IndexedDB fold read: core keys + channelsView per community. Returns the
 * number of GroupKeys derived so the report can show work volume.
 */
function registerAllPass(communities: CommunityV2[], folds: FoldedControl[]): number {
  let derived = 0;
  for (let i = 0; i < communities.length; i++) {
    derived += coreKeys(communities[i]).length;
    for (const channel of channelsView(communities[i], folds[i])) {
      derived += channel.streams.length;
      derived += 1; // voiceGroupKey per channel (voiceMediaKey is HKDF-only)
    }
  }
  return derived;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ── The measurements ─────────────────────────────────────────────────────────

const SECRET = b32("bench-secret");
const CHANNEL_ID = b32("bench-channel");

describe("derivation cost (perf guard)", () => {
  it("one cold channelGroupKey call costs real EC work (baseline)", { timeout: 30_000 }, () => {
    // Warm up noble's precomputed tables so we measure steady-state cost.
    for (let i = 0; i < 20; i++) channelGroupKey(SECRET, b32(`warm-${i}`), 0);

    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const id = b32(`distinct-${i}`);
      const t0 = performance.now();
      channelGroupKey(SECRET, id, 0);
      times.push(performance.now() - t0);
    }
    const med = median(times);
    console.log(`[perf] channelGroupKey cold: median ${(med * 1000).toFixed(0)}µs per call (n=100, distinct inputs)`);
    expect(med).toBeGreaterThan(0);
  });

  it("repeated IDENTICAL derivations are cache hits, not re-derivations", { timeout: 30_000 }, () => {
    // Cold baseline: median cost of a genuinely uncached derivation.
    const colds: number[] = [];
    for (let i = 0; i < 50; i++) {
      const id = b32(`cache-baseline-${i}`);
      const t0 = performance.now();
      channelGroupKey(SECRET, id, 0);
      colds.push(performance.now() - t0);
    }
    const cold = median(colds);

    const REPEATS = 500;
    channelGroupKey(SECRET, CHANNEL_ID, 0); // populate the memo
    const t0 = performance.now();
    for (let i = 0; i < REPEATS; i++) channelGroupKey(SECRET, CHANNEL_ID, 0);
    const total = performance.now() - t0;

    console.log(
      `[perf] ${REPEATS} identical channelGroupKey calls: ${total.toFixed(2)}ms total ` +
        `(${((total / REPEATS) * 1000).toFixed(1)}µs each vs ${(cold * 1000).toFixed(0)}µs cold) — ` +
        `uncached this took ~${(cold * REPEATS).toFixed(0)}ms`,
    );

    // Uncached, 500 repeats cost ~500 cold derivations (measured ~2000ms).
    // Cached, they are Map lookups (measured <1ms). Assert with 10x headroom
    // for CI jitter: the total must beat 50 cold derivations (~200ms).
    expect(total).toBeLessThan(cold * 50);

    // And cache hits return the SAME object — no per-call allocation churn.
    expect(channelGroupKey(SECRET, CHANNEL_ID, 0)).toBe(channelGroupKey(SECRET, CHANNEL_ID, 0));
  });

  it("the 20-second useRegisterAllStreamKeys2 poll is near-free after the first pass", { timeout: 60_000 }, () => {
    // A moderately active user: 10 communities, 20 channels each, 2 held root
    // epochs (one past rekey retained), a voice channel per 5.
    const communities = Array.from({ length: 10 }, (_, i) => makeCommunity(i, 2));
    const folds = communities.map((_, i) => makeFolded(i, 20));

    const t0 = performance.now();
    const derived = registerAllPass(communities, folds);
    const coldPass = performance.now() - t0;

    const warms: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t1 = performance.now();
      registerAllPass(communities, folds);
      warms.push(performance.now() - t1);
    }
    const warm = median(warms);

    console.log(
      `[perf] registerAll pass (10 communities × 20 channels × 2 roots, ${derived} GroupKeys): ` +
        `cold ${coldPass.toFixed(1)}ms, warm ${warm.toFixed(2)}ms — ` +
        `every 20s poll after the first now costs the warm number ` +
        `(uncached, EVERY pass cost the cold number: ~2.1s measured pre-fix)`,
    );

    expect(derived).toBeGreaterThan(0);
    // The repeat poll must be dominated by cache hits: at least 20x cheaper
    // than the cold pass (measured ~500x; margin absorbs CI noise).
    expect(warm).toBeLessThan(coldPass / 20);
  });

  it("derivation is deterministic, so caching identical inputs is always sound", () => {
    // The premise the memo rests on: same inputs ⇒ same key. Frozen wire
    // format (CORD-02 Appendix A) guarantees it; pin it here, including
    // across the number/bigint epoch representations.
    const a = channelGroupKey(SECRET, CHANNEL_ID, 7);
    const b = channelGroupKey(SECRET, CHANNEL_ID, 7n);
    expect(a.pk).toBe(b.pk);
    expect(bytesToHex(a.sk)).toBe(bytesToHex(b.sk));
    expect(bytesToHex(a.convKey)).toBe(bytesToHex(b.convKey));
  });

  it("the memo never conflates distinct inputs", () => {
    // Same (secret, id, epoch) under different labels, different epochs, and
    // the epoch-free shape must all stay distinct through the cache.
    const pks = new Set([
      channelGroupKey(SECRET, CHANNEL_ID, 0).pk,
      controlGroupKey(SECRET, CHANNEL_ID, 0).pk,
      guestbookGroupKey(SECRET, CHANNEL_ID, 0).pk,
      channelGroupKey(SECRET, CHANNEL_ID, 1).pk,
      channelGroupKey(CHANNEL_ID, SECRET, 0).pk,
      dissolvedGroupKey(SECRET).pk,
      baseRekeyGroupKey(SECRET, CHANNEL_ID, 1).pk,
    ]);
    expect(pks.size).toBe(7);
  });
});
