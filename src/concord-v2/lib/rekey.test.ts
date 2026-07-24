import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { EventTemplate } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import {
  baseRekeyGroupKey,
  bytesToHex,
  epochKeyCommitment,
  random32,
  recipientLocator,
  hex32,
} from "@/concord-v2/lib/derive";
import { KIND_SEAL_ENCRYPTED } from "@/concord-v2/lib/kinds";
import {
  base64ToBytes,
  buildRekeyRumors,
  bytesToBase64,
  checkContinuity,
  decodeWrappedKey,
  encodeWrappedKey,
  findBlob,
  groupRotations,
  lowerKeyWins,
  myLocator,
  parseRekey,
  rekeyScopeId,
  rotationExcludesMe,
  rotationPublishedAtMs,
  type RekeyBlob,
} from "@/concord-v2/lib/rekey";
import { openWrap, sealRumor, wrapSeal } from "@/concord-v2/lib/stream";

function signer(sk = generateSecretKey()) {
  return { sk, pubkey: getPublicKey(sk), signEvent: async (t: EventTemplate) => finalizeEvent(t, sk) };
}

describe("wrapped keys (CORD-06 §1)", () => {
  it("round-trips the 72-byte plaintext and verifies scope+epoch from inside", () => {
    const scopeId = random32();
    const newKey = random32();
    const plain = encodeWrappedKey(scopeId, 3n, newKey);
    expect(plain.length).toBe(72);
    expect(bytesToHex(decodeWrappedKey(plain, scopeId, 3n))).toBe(bytesToHex(newKey));
    expect(() => decodeWrappedKey(plain, random32(), 3n)).toThrow(/scope/);
    expect(() => decodeWrappedKey(plain, scopeId, 4n)).toThrow(/epoch/);
    // base64 transport survives.
    expect(bytesToHex(base64ToBytes(bytesToBase64(plain)))).toBe(bytesToHex(plain));
  });
});

describe("rekey events (CORD-06 §1–2)", () => {
  it("builds, seals, opens, and parses a base rotation", async () => {
    const rotator = signer();
    const priorRoot = random32();
    const cid = random32();
    const address = baseRekeyGroupKey(priorRoot, cid, 1);
    const prevCommit = bytesToHex(epochKeyCommitment(0n, priorRoot));

    const blobs: RekeyBlob[] = [{ locator: bytesToHex(random32()), wrapped: "AAAA" }];
    const rumors = buildRekeyRumors(rotator.pubkey, { scope: { kind: "root" }, newEpoch: 1n, prevEpoch: 0n, prevCommit }, blobs, Date.now());
    expect(rumors.length).toBe(1);

    const wrap = wrapSeal(await sealRumor(rumors[0], KIND_SEAL_ENCRYPTED, address, rotator), address);
    const parsed = parseRekey(openWrap(wrap, address));
    expect(parsed.rotator).toBe(rotator.pubkey);
    expect(parsed.scopeIdHex).toBe("0".repeat(64));
    expect(parsed.newEpoch).toBe(1n);
    expect(parsed.prevCommit).toBe(prevCommit);
    expect(parsed.blobs.length).toBe(1);
  });

  it("chunks at 120 blobs and completes only with every chunk", () => {
    const rotator = signer();
    const prevCommit = bytesToHex(epochKeyCommitment(0n, random32()));
    const blobs: RekeyBlob[] = Array.from({ length: 250 }, () => ({
      locator: bytesToHex(random32()),
      wrapped: "AA",
    }));
    const rumors = buildRekeyRumors(rotator.pubkey, { scope: { kind: "root" }, newEpoch: 1n, prevEpoch: 0n, prevCommit }, blobs, 1000);
    expect(rumors.length).toBe(3);

    // Parse them structurally (skip the envelope for speed).
    const parsed = rumors.map((r) =>
      parseRekey({
        rumorId: r.id,
        author: rotator.pubkey,
        kind: r.kind,
        content: r.content,
        tags: r.tags,
        ms: 1000,
        createdAt: r.created_at,
        wrapId: r.id,
        streamPk: "",
        sealKind: 20013,
        seal: {} as never,
      }),
    );

    const partial = groupRotations(parsed.slice(0, 2));
    expect(partial[0].complete).toBe(false); // a missing chunk is never a removal

    const full = groupRotations(parsed);
    expect(full.length).toBe(1);
    expect(full[0].complete).toBe(true);
    expect([...full[0].chunks.values()].reduce((n, c) => n + c.blobs.length, 0)).toBe(250);
  });

  it("continuity: match adopts, higher prevepoch is a gap, mismatch is a fork", () => {
    const key0 = random32();
    const commit0 = bytesToHex(epochKeyCommitment(0n, key0));
    expect(checkContinuity({ prevEpoch: 0n, prevCommit: commit0 }, 0n, key0)).toEqual({ ok: true });
    expect(checkContinuity({ prevEpoch: 2n, prevCommit: commit0 }, 0n, key0)).toEqual({ ok: false, reason: "gap" });
    expect(checkContinuity({ prevEpoch: 0n, prevCommit: "ff".repeat(32) }, 0n, key0)).toEqual({ ok: false, reason: "fork" });
  });

  it("locates my blob by the public-inputs locator", () => {
    const rotator = signer();
    const me = signer();
    const scopeId = rekeyScopeId({ kind: "root" });
    const locator = bytesToHex(recipientLocator(hex32(rotator.pubkey), hex32(me.pubkey), scopeId, 1n));
    expect(myLocator(rotator.pubkey, me.pubkey, bytesToHex(scopeId), 1n)).toBe(locator);

    const prevCommit = bytesToHex(epochKeyCommitment(0n, random32()));
    const rumors = buildRekeyRumors(
      rotator.pubkey,
      { scope: { kind: "root" }, newEpoch: 1n, prevEpoch: 0n, prevCommit },
      [{ locator, wrapped: "QQ" }],
      1000,
    );
    const parsed = parseRekey({
      rumorId: rumors[0].id,
      author: rotator.pubkey,
      kind: rumors[0].kind,
      content: rumors[0].content,
      tags: rumors[0].tags,
      ms: 1000,
      createdAt: rumors[0].created_at,
      wrapId: rumors[0].id,
      streamPk: "",
      sealKind: 20013,
      seal: {} as never,
    });
    const [set] = groupRotations([parsed]);
    expect(findBlob(set, locator)?.wrapped).toBe("QQ");
    expect(findBlob(set, bytesToHex(random32()))).toBeUndefined();
  });

  it("race convergence: the lexicographically lowest new key wins", () => {
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    expect(lowerKeyWins(a, b)).toBe(a);
    expect(lowerKeyWins(b, a)).toBe(a);
  });
});

describe("exclusion vs. history (join-onto-a-past-Refounding, liveness-only bug)", () => {
  function chunkedRotationAtMs(ms: number) {
    // A one-chunk root rotation whose only chunk was published at `ms`.
    const rotator = signer();
    const prevCommit = bytesToHex(epochKeyCommitment(0n, random32()));
    const rumors = buildRekeyRumors(
      rotator.pubkey,
      { scope: { kind: "root" }, newEpoch: 1n, prevEpoch: 0n, prevCommit },
      [{ locator: bytesToHex(random32()), wrapped: "AA" }],
      ms,
    );
    const parsed = parseRekey({
      rumorId: rumors[0].id,
      author: rotator.pubkey,
      kind: rumors[0].kind,
      content: rumors[0].content,
      tags: rumors[0].tags,
      ms,
      createdAt: rumors[0].created_at,
      wrapId: rumors[0].id,
      streamPk: "",
      sealKind: 20013,
      seal: {} as never,
    });
    return groupRotations([parsed])[0];
  }

  it("reports a rotation's publish time as its newest chunk ms", () => {
    // Two chunks of one rotation, published at different times → the newest.
    const rotator = signer();
    const prevCommit = bytesToHex(epochKeyCommitment(0n, random32()));
    const blobs: RekeyBlob[] = Array.from({ length: 130 }, () => ({
      locator: bytesToHex(random32()),
      wrapped: "AA",
    }));
    const rumors = buildRekeyRumors(
      rotator.pubkey,
      { scope: { kind: "root" }, newEpoch: 1n, prevEpoch: 0n, prevCommit },
      blobs,
      5000,
    );
    const parsed = rumors.map((r, i) =>
      parseRekey({
        rumorId: r.id,
        author: rotator.pubkey,
        kind: r.kind,
        content: r.content,
        tags: r.tags,
        // Second chunk lands a beat later.
        ms: 5000 + i * 1000,
        createdAt: r.created_at,
        wrapId: r.id,
        streamPk: "",
        sealKind: 20013,
        seal: {} as never,
      }),
    );
    const [set] = groupRotations(parsed);
    expect(rotationPublishedAtMs(set)).toBe(6000);
  });

  it("a rotation entirely before my join is history, NOT an exclusion", () => {
    // The reported bug: a public invite hands me epoch N; the community already
    // ran an N→N+1 Refounding LONG before I joined. The rotation is complete and
    // has no blob for me, but it predates my join — so it must not tombstone me.
    const rotatedAt = 1_000_000; // the Refounding happened here
    const joinedAt = 9_000_000; // I joined much later, via the stale link
    const set = chunkedRotationAtMs(rotatedAt);
    expect(rotationPublishedAtMs(set)).toBe(rotatedAt);
    expect(rotationExcludesMe(rotationPublishedAtMs(set), joinedAt)).toBe(false);
  });

  it("a rotation at/after my join CAN exclude me", () => {
    const joinedAt = 1_000_000;
    // Exactly at join (boundary) and strictly after both count as an exclusion.
    expect(rotationExcludesMe(rotationPublishedAtMs(chunkedRotationAtMs(joinedAt)), joinedAt)).toBe(true);
    expect(rotationExcludesMe(rotationPublishedAtMs(chunkedRotationAtMs(joinedAt + 1)), joinedAt)).toBe(true);
  });
});

