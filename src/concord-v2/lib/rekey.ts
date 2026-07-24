/**
 * Concord V2 Rekeys & Refoundings — CORD-06.
 *
 * Post-removal secrecy without ratchets: a rotation mints a fresh key at the
 * next epoch and delivers it as per-recipient "rekey blobs" (kind 3303, up to
 * 120 per event, chunked) at an address derived from the PRIOR secret — so
 * every current holder can find it, and a removed member finding no blob for
 * their locator across ALL chunks knows they're out.
 *
 * The wrapped plaintext is fixed-width — `scope_id[32] ‖ epoch_be[8] ‖
 * new_key[32]` — NIP-44-encrypted under the Rotator↔recipient pairwise key
 * (one ECDH either side can compute, so a NIP-46 bunker opens its blob with a
 * single nip44_decrypt). NOTE: signer nip44 interfaces carry STRINGS, so this
 * implementation transports the 72 bytes as base64 inside the NIP-44 plaintext
 * (the spec doesn't pin a byte-transport for string-only signers — flagged as
 * spec feedback).
 */

import { bytesToHex, epochKeyCommitment, random32, recipientLocator } from "@/concord-v2/lib/derive";
import { KIND_REKEY, KIND_SEAL_ENCRYPTED } from "@/concord-v2/lib/kinds";
import { buildRumor, type OpenedEvent, type Rumor } from "@/concord-v2/lib/stream";

/** Per-recipient blobs per rekey event (CORD-06 §1). */
export const REKEY_BLOBS_PER_EVENT = 120;

const ZERO32 = new Uint8Array(32);
const ZERO32_HEX = "0".repeat(64);

/** A rotation's scope: one Private Channel, or the community_root (a Refounding). */
export type RekeyScope = { kind: "channel"; channelId: Uint8Array } | { kind: "root" };

/** The 32-byte scope id: the channel id, or all-zeroes for the root (never collides). */
export function rekeyScopeId(scope: RekeyScope): Uint8Array {
  return scope.kind === "channel" ? scope.channelId : ZERO32;
}

// ── The 72-byte wrapped plaintext ────────────────────────────────────────────

/** `scope_id[32] ‖ epoch_be[8] ‖ new_key[32]` — scope and epoch live INSIDE the ciphertext. */
export function encodeWrappedKey(scopeId: Uint8Array, newEpoch: bigint, newKey: Uint8Array): Uint8Array {
  const out = new Uint8Array(72);
  out.set(scopeId, 0);
  new DataView(out.buffer).setBigUint64(32, newEpoch, false);
  out.set(newKey, 40);
  return out;
}

/**
 * Parse + verify a decrypted 72-byte blob against the event's tags: a
 * recipient accepts the key only when the INNER scope and epoch match, which
 * is what makes a blob unspliceable across channels/epochs (CORD-06 §1).
 */
export function decodeWrappedKey(
  plain: Uint8Array,
  expectedScopeId: Uint8Array,
  expectedEpoch: bigint,
): Uint8Array {
  if (plain.length !== 72) throw new Error(`wrapped key must be 72 bytes, got ${plain.length}`);
  const scopeId = plain.slice(0, 32);
  const epoch = new DataView(plain.buffer, plain.byteOffset).getBigUint64(32, false);
  if (bytesToHex(scopeId) !== bytesToHex(expectedScopeId)) throw new Error("wrapped key scope mismatch");
  if (epoch !== expectedEpoch) throw new Error("wrapped key epoch mismatch");
  return plain.slice(40, 72);
}

/** base64 helpers for carrying the 72 bytes through string-only nip44 signers. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── The 3303 rumor ───────────────────────────────────────────────────────────

/** One located, wrapped key. */
export interface RekeyBlob {
  /** Where its recipient finds it (hex of {@link recipientLocator}). */
  locator: string;
  /** NIP-44 ciphertext under the Rotator↔recipient pairwise key. */
  wrapped: string;
}

export interface RekeyRotation {
  scope: RekeyScope;
  newEpoch: bigint;
  prevEpoch: bigint;
  /** The epoch-key commitment over the key being replaced (continuity check). */
  prevCommit: string;
}

/** Build the chunked 3303 rumors for one rotation. */
export function buildRekeyRumors(
  rotatorPubkey: string,
  rotation: RekeyRotation,
  blobs: RekeyBlob[],
  ms: number,
): Rumor[] {
  const chunks: RekeyBlob[][] = [];
  for (let i = 0; i < blobs.length; i += REKEY_BLOBS_PER_EVENT) {
    chunks.push(blobs.slice(i, i + REKEY_BLOBS_PER_EVENT));
  }
  if (chunks.length === 0) chunks.push([]);
  const n = chunks.length;
  const scopeHex = bytesToHex(rekeyScopeId(rotation.scope));
  return chunks.map((chunk, i) =>
    buildRumor({
      kind: KIND_REKEY,
      content: JSON.stringify(chunk),
      tags: [
        ["scope", scopeHex],
        ["newepoch", rotation.newEpoch.toString()],
        ["prevepoch", rotation.prevEpoch.toString()],
        ["prevcommit", rotation.prevCommit],
        ["chunk", (i + 1).toString(), n.toString()],
      ],
      pubkey: rotatorPubkey,
      ms,
    }),
  );
}

export interface ParsedRekey {
  /** The rotator's real pubkey (the seal's signer). */
  rotator: string;
  scopeIdHex: string;
  newEpoch: bigint;
  prevEpoch: bigint;
  prevCommit: string;
  chunkIndex: number;
  chunkCount: number;
  blobs: RekeyBlob[];
  /** ms of the rumor (ordering / correlation aid). */
  ms: number;
  wrapId: string;
}

/** Parse an opened rekey stream event into its rotation fields. */
export function parseRekey(opened: OpenedEvent): ParsedRekey {
  if (opened.kind !== KIND_REKEY) throw new Error("not a rekey rumor");
  if (opened.sealKind !== KIND_SEAL_ENCRYPTED) throw new Error("rekey seals must be encrypted (CORD-02 §5)");
  const get = (name: string) => opened.tags.find((t) => t[0] === name);
  const scope = get("scope")?.[1];
  const newEpoch = get("newepoch")?.[1];
  const prevEpoch = get("prevepoch")?.[1];
  const prevCommit = get("prevcommit")?.[1];
  const chunk = get("chunk");
  if (!scope || !/^[0-9a-f]{64}$/i.test(scope)) throw new Error("bad scope tag");
  if (!newEpoch || !/^\d+$/.test(newEpoch)) throw new Error("bad newepoch tag");
  if (!prevEpoch || !/^\d+$/.test(prevEpoch)) throw new Error("bad prevepoch tag");
  if (!prevCommit || !/^[0-9a-f]{64}$/i.test(prevCommit)) throw new Error("bad prevcommit tag");
  const chunkIndex = chunk ? Number(chunk[1]) : 1;
  const chunkCount = chunk ? Number(chunk[2]) : 1;
  if (!Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount) || chunkIndex < 1 || chunkCount < 1 || chunkIndex > chunkCount) {
    throw new Error("bad chunk tag");
  }
  let blobs: RekeyBlob[];
  try {
    const parsed = JSON.parse(opened.content) as RekeyBlob[];
    blobs = Array.isArray(parsed)
      ? parsed.filter((b) => b && typeof b.locator === "string" && typeof b.wrapped === "string")
      : [];
  } catch {
    throw new Error("bad rekey content");
  }
  return {
    rotator: opened.author,
    scopeIdHex: scope.toLowerCase(),
    newEpoch: BigInt(newEpoch),
    prevEpoch: BigInt(prevEpoch),
    prevCommit: prevCommit.toLowerCase(),
    chunkIndex,
    chunkCount,
    blobs,
    ms: opened.ms,
    wrapId: opened.wrapId,
  };
}

/**
 * Group parsed rekey chunks into complete rotations. Chunks correlate by
 * (rotator, scope, newepoch, prevcommit) so two Rotators concurrently rekeying
 * the same epoch never merge into one set (CORD-06 §2). A rotation is COMPLETE
 * only when all `n` chunks are held — a missing chunk is never a removal.
 */
export interface RekeyRotationSet {
  rotator: string;
  scopeIdHex: string;
  newEpoch: bigint;
  prevEpoch: bigint;
  prevCommit: string;
  chunkCount: number;
  /** chunkIndex → chunk. */
  chunks: Map<number, ParsedRekey>;
  complete: boolean;
}

export function groupRotations(parsed: ParsedRekey[]): RekeyRotationSet[] {
  const byKey = new Map<string, RekeyRotationSet>();
  for (const p of parsed) {
    const key = `${p.rotator}:${p.scopeIdHex}:${p.newEpoch}:${p.prevCommit}`;
    let set = byKey.get(key);
    if (!set) {
      byKey.set(
        key,
        (set = {
          rotator: p.rotator,
          scopeIdHex: p.scopeIdHex,
          newEpoch: p.newEpoch,
          prevEpoch: p.prevEpoch,
          prevCommit: p.prevCommit,
          chunkCount: p.chunkCount,
          chunks: new Map(),
          complete: false,
        }),
      );
    }
    if (p.chunkCount === set.chunkCount) set.chunks.set(p.chunkIndex, p);
  }
  for (const set of byKey.values()) {
    set.complete = set.chunks.size >= set.chunkCount;
  }
  return [...byKey.values()];
}

/**
 * Verify a rotation's CONTINUITY against the key we currently hold: the
 * commitment over (prevEpoch, heldKey) must equal the event's `prevcommit`.
 * A mismatch with a HIGHER prevepoch means we missed a rotation (fetch the gap
 * first); any other mismatch is a fork or garbage — reject (CORD-06 §2).
 */
export function checkContinuity(set: { prevEpoch: bigint; prevCommit: string }, heldEpoch: bigint, heldKey: Uint8Array):
  | { ok: true }
  | { ok: false; reason: "gap" | "fork" } {
  if (set.prevEpoch === heldEpoch) {
    const commit = bytesToHex(epochKeyCommitment(heldEpoch, heldKey));
    return commit === set.prevCommit ? { ok: true } : { ok: false, reason: "fork" };
  }
  return { ok: false, reason: set.prevEpoch > heldEpoch ? "gap" : "fork" };
}

/** Find my blob across a complete rotation's chunks by my locator. */
export function findBlob(set: RekeyRotationSet, locatorHex: string): RekeyBlob | undefined {
  for (const chunk of set.chunks.values()) {
    const hit = chunk.blobs.find((b) => b.locator === locatorHex);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * When did this rotation publish? The newest of its chunks' rumor ms.
 * Used to tell a removal apart from community history: a rotation that
 * entirely predates a member's join happened before they existed in the
 * community, so its lack of a blob for them is not an exclusion.
 */
export function rotationPublishedAtMs(set: RekeyRotationSet): number {
  let newest = 0;
  for (const chunk of set.chunks.values()) if (chunk.ms > newest) newest = chunk.ms;
  return newest;
}

/**
 * Does a complete rotation carrying no blob for me actually EXCLUDE me, or is
 * it community history that predates my membership? A member who joins via a
 * stale public invite (bundle epoch N) lands ON a historical `N→N+1`
 * Refounding they were never part of. It is continuity-valid and complete, yet
 * has no blob at their locator — but it was published before they joined, so it
 * must not be read as a removal (else the community's rail icon vanishes
 * seconds after every join, while chat stays fully usable — a liveness-only
 * bug). Only a rotation published at/after the join can exclude me (CORD-06).
 *
 * `joinedAtMs` is the member's own Community-List `added_at`; `rotatedAtMs` is
 * {@link rotationPublishedAtMs}. Clock skew only ever fails toward KEEPING the
 * icon (a slightly-early real exclusion), which is safe: key rotation, not the
 * rail, enforces post-removal secrecy.
 */
export function rotationExcludesMe(rotatedAtMs: number, joinedAtMs: number): boolean {
  return rotatedAtMs >= joinedAtMs;
}


/**
 * Race convergence (CORD-06 §3): among authorized candidates at the same
 * continuity point, the lexicographically lowest NEW KEY wins. Callers holding
 * multiple adopted candidates keep both keys but converge the chain on the
 * winner; the heal is DOWN-ONLY (a held epoch re-converges solely to a
 * strictly lower sibling).
 */
export function lowerKeyWins(a: Uint8Array, b: Uint8Array): Uint8Array {
  return bytesToHex(a) <= bytesToHex(b) ? a : b;
}

/** Mint the fresh key for a rotation. */
export function mintRotationKey(): Uint8Array {
  return random32();
}

/** Compute my locator for a rotation (public inputs only — bunker-friendly). */
export function myLocator(rotatorHex: string, myHex: string, scopeIdHex: string, newEpoch: bigint): string {
  const hexToBytes32 = (h: string) => {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
  return bytesToHex(
    recipientLocator(hexToBytes32(rotatorHex), hexToBytes32(myHex), hexToBytes32(scopeIdHex), newEpoch),
  );
}

export { ZERO32_HEX as ROOT_SCOPE_HEX };
