/**
 * Performance evidence + regression guard for NIP-42 stream-auth signing.
 *
 * History (the bug this pins against): `signStreamAuths()` used to sign a
 * kind-22242 with `finalizeEvent()` for EVERY registered stream key on EVERY
 * relay challenge — NostrProvider passed no subset. At a realistic 450-key
 * registry (10 communities, the derive.perf profile) that measured ~1.5-2s of
 * synchronous Schnorr signing per challenge (~4ms/signature, phones 5-10x
 * slower), and the new-key mass reconnect (NostrProvider force-closes
 * challenged sockets) burned relays × keys: ~6-9s over 4 relays.
 *
 * The fix scopes keys to their community's relays at registration; a relay's
 * challenge signs only the keys it hosts. The regression test below FAILS if
 * default signing ever returns to full-registry behavior. Raw per-signature
 * cost and set-linearity remain measured as evidence, and one NEGATIVE result
 * is pinned: signing with the registry's known pubkey (skipping
 * finalizeEvent's getPublicKey) saves ~nothing, because schnorr.sign
 * recomputes the public point internally — that micro-optimization is not
 * worth pursuing.
 */

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "@noble/hashes/sha2.js";
import { schnorr } from "@noble/curves/secp256k1.js";
import { getEventHash, verifyEvent, type NostrEvent, type UnsignedEvent } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { channelGroupKey, type GroupKey } from "@/concord-v2/lib/derive";
import {
  _resetStreamAuthRegistry,
  registerStreamKeys,
  signStreamAuths,
  streamPubkeys,
} from "@/concord-v2/lib/streamAuth";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Deterministic 32 bytes from a label (stable across runs). */
function b32(label: string): Uint8Array {
  return sha256(new TextEncoder().encode(label));
}

/**
 * A realistic full registry: 10 communities × ~45 stream keys each (20
 * channels × 2 held root epochs + core control/guestbook/dissolved/rekey
 * addresses) ≈ the ~450-key registry of the derive.perf "moderate user".
 * Derivation itself is memoized (derive.ts), so this measures SIGNING only.
 */
const COMMUNITIES = 10;
const KEYS_PER_COMMUNITY = 45;

function communityKeys(n: number): GroupKey[] {
  const secret = b32(`auth-root-${n}`);
  return Array.from({ length: KEYS_PER_COMMUNITY }, (_, i) =>
    channelGroupKey(secret, b32(`auth-channel-${n}-${i}`), 0),
  );
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

afterEach(() => _resetStreamAuthRegistry());

// ── The measurements ─────────────────────────────────────────────────────────

describe("NIP-42 stream-auth signing cost (perf evidence + regression guard)", () => {
  it("REGRESSION GUARD: a relay's challenge signs ONLY the keys scoped to it", { timeout: 120_000 }, () => {
    // 10 communities spread round-robin over 4 relays, exactly how the app
    // registers them now (registerStreamKeys(keys, community.relays)).
    const RELAYS = 4;
    const relayOf = (n: number) => `wss://relay-${n % RELAYS}.example.com`;
    const perCommunity = Array.from({ length: COMMUNITIES }, (_, n) => communityKeys(n));
    perCommunity.forEach((keys, n) => registerStreamKeys(keys, [relayOf(n)]));
    const total = streamPubkeys().length;
    expect(total).toBe(COMMUNITIES * KEYS_PER_COMMUNITY);

    signStreamAuths("warmup", relayOf(0), perCommunity[0].slice(0, 10).map((k) => k.pk)); // warm-up

    // Default signing (what NostrProvider's auth callback does — no subset)
    // across every relay: the "mass reconnect" worst case.
    const t0 = performance.now();
    let signed = 0;
    const perRelayCounts: number[] = [];
    for (let r = 0; r < RELAYS; r++) {
      const events = signStreamAuths(`reconnect-challenge-${r}`, `wss://relay-${r}.example.com`);
      perRelayCounts.push(events.length);
      signed += events.length;

      // Every event must belong to a community actually hosted on relay r.
      const hosted = new Set(
        perCommunity.flatMap((keys, n) => (n % RELAYS === r ? keys.map((k) => k.pk) : [])),
      );
      for (const ev of events) expect(hosted.has(ev.pubkey)).toBe(true);
    }
    const burst = performance.now() - t0;

    console.log(
      `[perf] scoped mass-reconnect burst (${RELAYS} relays, ${total} keys): ${signed} signatures ` +
        `in ${burst.toFixed(0)}ms — unscoped this was ${RELAYS * total} signatures / measured ~6-9s pre-fix`,
    );

    // THE guard: each relay signs exactly its hosted communities' keys — the
    // whole burst totals one registry pass, not relays × registry. If someone
    // reverts default signing to the full registry, `signed` becomes
    // RELAYS × total and this fails.
    expect(signed).toBe(total);
    // 10 communities round-robin over 4 relays: 3+3+2+2 communities.
    expect(perRelayCounts).toEqual([3, 3, 2, 2].map((c) => c * KEYS_PER_COMMUNITY));
  });

  it("raw signing cost is linear in the signed set (why scoping works)", { timeout: 120_000 }, () => {
    // Registered UNSCOPED (no relays) — the safe fallback still signs
    // everywhere, which doubles as the pre-fix full-registry measurement.
    const perCommunity = Array.from({ length: COMMUNITIES }, (_, n) => communityKeys(n));
    for (const keys of perCommunity) registerStreamKeys(keys);
    const total = streamPubkeys().length;

    signStreamAuths("warmup", "wss://relay.example.com", streamPubkeys().slice(0, 10)); // warm-up

    const t0 = performance.now();
    const events = signStreamAuths("challenge-nonce-1", "wss://relay.example.com");
    const fullPass = performance.now() - t0;

    expect(events.length).toBe(total); // unscoped keys still sign on any relay
    expect(verifyEvent(events[0])).toBe(true); // real, valid signatures

    const scopedPks = perCommunity[0].map((k) => k.pk);
    const scopedTimes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t1 = performance.now();
      const scoped = signStreamAuths(`challenge-nonce-${i + 2}`, "wss://relay.example.com", scopedPks);
      scopedTimes.push(performance.now() - t1);
      expect(scoped.length).toBe(KEYS_PER_COMMUNITY);
    }
    const scopedPass = median(scopedTimes);

    console.log(
      `[perf] signStreamAuths, full registry (${total} keys): ${fullPass.toFixed(0)}ms per challenge; ` +
        `one community (${KEYS_PER_COMMUNITY} keys): ${scopedPass.toFixed(0)}ms ` +
        `(${(fullPass / scopedPass).toFixed(1)}x cheaper — phones 5-10x slower throughout)`,
    );

    // Linearity, with wide CI margins (measured ~10x for a 10x smaller set).
    expect(fullPass).toBeGreaterThan(scopedPass * 3);
  });

  it("NEGATIVE result: skipping finalizeEvent's getPublicKey saves ~nothing", { timeout: 60_000 }, () => {
    // Theory tested: finalizeEvent(sk) internally recomputes getPublicKey(sk)
    // although the registry is keyed by that pubkey — so building the event
    // with the known pk and calling schnorr.sign directly should halve the EC
    // work. MEASURED: it doesn't (~1.0x) — schnorr.sign recomputes the public
    // point internally anyway (BIP-340 needs it for parity), and noble's
    // precomputed base tables make the extra fixed-base mult cheap. Pinned
    // here so nobody re-proposes the micro-optimization; the real fix is
    // scoping the signed SET (the regression guard above).
    const keys = communityKeys(0);
    registerStreamKeys(keys);
    const pks = keys.map((k) => k.pk);

    signStreamAuths("warmup", "wss://r", pks.slice(0, 5)); // warm-up
    const t0 = performance.now();
    const current = signStreamAuths("bench-challenge", "wss://r", pks);
    const currentMs = performance.now() - t0;

    const createdAt = Math.floor(Date.now() / 1000);
    const lean = (pk: string, sk: Uint8Array): NostrEvent => {
      const unsigned: UnsignedEvent = {
        kind: 22242,
        content: "",
        tags: [["relay", "wss://r"], ["challenge", "bench-challenge"]],
        created_at: createdAt,
        pubkey: pk,
      };
      const id = getEventHash(unsigned);
      const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
      return { ...unsigned, id, sig };
    };
    lean(keys[0].pk, keys[0].sk); // warm-up
    const t1 = performance.now();
    const leanEvents = keys.map((k) => lean(k.pk, k.sk));
    const leanMs = performance.now() - t1;

    console.log(
      `[perf] ${pks.length} NIP-42 signs: finalizeEvent ${currentMs.toFixed(0)}ms vs ` +
        `known-pubkey sign ${leanMs.toFixed(0)}ms (${(currentMs / leanMs).toFixed(2)}x) — ` +
        `not worth it; per-signature cost is ~${(currentMs / pks.length).toFixed(1)}ms either way`,
    );

    // Both paths produce real, equivalent NIP-42 auths (kept as a correctness
    // pin for whatever the eventual fix ships). No timing assertion: the two
    // are within noise of each other — that IS the finding.
    for (const ev of leanEvents.slice(0, 3)) expect(verifyEvent(ev)).toBe(true);
    expect(leanEvents[0].pubkey).toBe(current[0].pubkey);
    expect(leanEvents[0].kind).toBe(22242);
    expect(leanEvents[0].tags).toEqual(current[0].tags);
  });
});
