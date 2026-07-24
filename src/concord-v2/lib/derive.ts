/**
 * Concord V2 derivations — CORD-02 Appendix A (frozen).
 *
 * Everything Concord addresses on the wire derives from a Community secret
 * through one of the shapes below. Changing any labeled byte re-addresses every
 * prior event, so treat this file as wire format.
 *
 * Construction (A.1): `HKDF-SHA256(ikm=secret, salt=∅, info, L=32)` where
 *   `info = utf8(label) || 0x00 || id[32] || epoch_be[8]?`
 * The id is always present (all-zeroes where a label has no meaningful id);
 * the epoch is the only omittable field. The scalar_normalize retry counter
 * (A.3) appends after whatever fields are present, starting at byte 0.
 */

import { schnorr } from "@noble/curves/secp256k1.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { getConversationKey } from "nostr-tools/nip44";

// ── Labels (A.6, frozen) ─────────────────────────────────────────────────────

const LABEL_CHANNEL = "concord/channel";
const LABEL_CONTROL = "concord/control";
const LABEL_REKEY_PSEUDONYM = "concord/rekey-pseudonym";
const LABEL_BASE_REKEY_PSEUDONYM = "concord/base-rekey-pseudonym";
const LABEL_RECIPIENT_PSEUDONYM = "concord/recipient-pseudonym";
const LABEL_GUESTBOOK = "concord/guestbook";
const LABEL_VOICE_SIGNER = "concord/voice-signer";
const LABEL_VOICE_MEDIA = "concord/voice-media";
const LABEL_VOICE_SENDER = "concord/voice-sender";
const LABEL_DISSOLVED = "concord/dissolved";
const LABEL_GRANT = "concord/grant";
const LABEL_BANLIST = "concord/banlist";
const LABEL_INVITE_LINKS = "concord/invite-links";
const LABEL_INVITE_KEY = "concord/invite-key";

/** The community_id commitment prefix (A.4) — plain SHA-256, NOT the hkdf shape. */
const LABEL_COMMUNITY = "concord/community";
/** The epoch-key commitment prefix (A.5). */
const LABEL_EPOCH_COMMITMENT = "concord/epoch-key-commitment";

const ZERO32 = new Uint8Array(32);
const ASCII = new TextEncoder();

// ── Small helpers ────────────────────────────────────────────────────────────

/** 32 cryptographically-random bytes. */
export function random32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Lowercase hex of raw bytes. */
export { bytesToHex, hexToBytes };

/** Parse a 64-char hex string to 32 bytes, throwing on malformed input. */
export function hex32(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`invalid 64-char hex (got ${hex.length} chars)`);
  }
  return hexToBytes(hex.toLowerCase());
}

function assert32(name: string, b: Uint8Array): void {
  if (b.length !== 32) throw new Error(`${name} must be 32 bytes, got ${b.length}`);
}

function toEpoch(epoch: number | bigint): bigint {
  return typeof epoch === "bigint" ? epoch : BigInt(epoch);
}

function u64be(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, false);
  return out;
}

// ── A.1: the frozen info layout ──────────────────────────────────────────────

/** `utf8(label) || 0x00 || id[32] || epoch_be[8]?` — epoch omitted when undefined. */
function buildInfo(label: string, id32: Uint8Array, epoch?: bigint): Uint8Array {
  assert32("id", id32);
  const labelBytes = ASCII.encode(label);
  const hasEpoch = epoch !== undefined;
  const out = new Uint8Array(labelBytes.length + 1 + 32 + (hasEpoch ? 8 : 0));
  let o = 0;
  out.set(labelBytes, o);
  o += labelBytes.length;
  out[o] = 0x00;
  o += 1;
  out.set(id32, o);
  o += 32;
  if (hasEpoch) new DataView(out.buffer).setBigUint64(o, epoch, false);
  return out;
}

/** HKDF-SHA256, zero-length salt, 32-byte output. */
function hkdf32(ikm: Uint8Array, info: Uint8Array): Uint8Array {
  return hkdf(sha256, ikm, new Uint8Array(0), info, 32);
}

// ── A.3: scalar_normalize ────────────────────────────────────────────────────

/**
 * Reduce an hkdf seed to a valid secp256k1 secret key. If the seed is not a
 * valid scalar, append one incrementing counter byte to the info and retry,
 * the counter starting at 0 (A.3). The reject branch is ~2^-128 rare; the
 * counter keeps it deterministic across implementations.
 */
function hkdfToSecretKey(ikm: Uint8Array, baseInfo: Uint8Array): Uint8Array {
  {
    const seed = hkdf32(ikm, baseInfo);
    if (secp256k1.utils.isValidSecretKey(seed)) return seed;
  }
  for (let counter = 0; counter <= 0xff; counter++) {
    const info = new Uint8Array(baseInfo.length + 1);
    info.set(baseInfo, 0);
    info[baseInfo.length] = counter;
    const seed = hkdf32(ikm, info);
    if (secp256k1.utils.isValidSecretKey(seed)) return seed;
  }
  throw new Error("scalar rejection 257 times running is impossible");
}

// ── A.2: group_key ───────────────────────────────────────────────────────────

/**
 * A plane's stream keypair: the x-only pubkey is the on-wire Stream address
 * (the `authors` filter), the secret key signs its wraps, and the NIP-44
 * self-ECDH conversation key encrypts them.
 */
export interface GroupKey {
  /** secp256k1 secret key (signs the plane's wraps). */
  sk: Uint8Array;
  /** x-only pubkey hex — the Stream address. */
  pk: string;
  /** NIP-44 conversation key (self-ECDH of sk with its own pk). */
  convKey: Uint8Array;
}

function groupKey(label: string, secret: Uint8Array, id: Uint8Array, epoch?: bigint): GroupKey {
  const sk = hkdfToSecretKey(secret, buildInfo(label, id, epoch));
  const pk = bytesToHex(schnorr.getPublicKey(sk));
  const convKey = getConversationKey(sk, pk);
  return { sk, pk, convKey };
}

/**
 * `groupKey` memo. A single derivation costs one HKDF plus TWO secp256k1
 * point multiplications (~ms each on a phone), and the app re-derives every
 * community's full key set on short polls (stream-auth registration each 20s,
 * subscription and wire rebuilds each 60s/2min) — uncached, that alone was
 * seconds of main-thread crypto per poll for multi-community users.
 *
 * Caching is sound because the derivation is a pure function of
 * (label, secret, id, epoch) — CORD-02 Appendix A is frozen — and every
 * consumer treats GroupKeys as read-only (no zeroization exists here).
 * FIFO-bounded: entries are tiny (~200B) and the working set is
 * O(communities × channels × held epochs), far under the cap.
 */
const groupKeyMemo = new Map<string, GroupKey>();
const GROUP_KEY_MEMO_MAX = 8192;

function groupKeyCached(label: string, secret: Uint8Array, id: Uint8Array, epoch?: bigint): GroupKey {
  const memoKey = `${label}|${bytesToHex(secret)}|${bytesToHex(id)}|${epoch ?? ""}`;
  const hit = groupKeyMemo.get(memoKey);
  if (hit) return hit;
  const key = groupKey(label, secret, id, epoch);
  if (groupKeyMemo.size >= GROUP_KEY_MEMO_MAX) {
    groupKeyMemo.delete(groupKeyMemo.keys().next().value as string);
  }
  groupKeyMemo.set(memoKey, key);
  return key;
}

// ── Plane keys (CORD-02 §5, CORD-03 §1, CORD-06 §2) ─────────────────────────

/**
 * A Channel's group key. `secret` is the community_root for a Public Channel
 * (at the root epoch) or the Channel's independent key for a Private one (at
 * its own channel epoch) — CORD-03 §1.
 */
export function channelGroupKey(secret: Uint8Array, channelId: Uint8Array, epoch: number | bigint): GroupKey {
  assert32("secret", secret);
  assert32("channelId", channelId);
  return groupKeyCached(LABEL_CHANNEL, secret, channelId, toEpoch(epoch));
}

/** The Control Plane's group key (community_root-keyed). */
export function controlGroupKey(communityRoot: Uint8Array, communityId: Uint8Array, epoch: number | bigint): GroupKey {
  assert32("communityRoot", communityRoot);
  assert32("communityId", communityId);
  return groupKeyCached(LABEL_CONTROL, communityRoot, communityId, toEpoch(epoch));
}

/** The Guestbook Plane's group key (community_root-keyed). */
export function guestbookGroupKey(communityRoot: Uint8Array, communityId: Uint8Array, epoch: number | bigint): GroupKey {
  assert32("communityRoot", communityRoot);
  assert32("communityId", communityId);
  return groupKeyCached(LABEL_GUESTBOOK, communityRoot, communityId, toEpoch(epoch));
}

// ── Voice sub-keys (CORD-07) ─────────────────────────────────────────────────

/**
 * A voice Channel's SFU room keypair (CORD-07 §1): `voice_key.pk` IS the SFU
 * room name and `voice_key.sk` signs token grants (§2). `secret`/`epoch` are
 * the same pair that addresses the Channel's Chat Plane — the community_root at
 * the root epoch for a Public Channel, the Channel's own key/epoch for a
 * Private one — so the room rolls exactly when the Channel's key does. The
 * `group_key` shape is reused only for its deterministic keypair; the pk is
 * never a stream address.
 */
export function voiceGroupKey(secret: Uint8Array, channelId: Uint8Array, epoch: number | bigint): GroupKey {
  assert32("secret", secret);
  assert32("channelId", channelId);
  return groupKeyCached(LABEL_VOICE_SIGNER, secret, channelId, toEpoch(epoch));
}

/**
 * A voice Channel's raw 32-byte media-encryption root (CORD-07 §1). Never feeds
 * a cipher directly — every publisher's per-sender frame key derives from it
 * (see {@link voiceSenderKey}).
 */
export function voiceMediaKey(secret: Uint8Array, channelId: Uint8Array, epoch: number | bigint): Uint8Array {
  assert32("secret", secret);
  assert32("channelId", channelId);
  return hkdf32(secret, buildInfo(LABEL_VOICE_MEDIA, channelId, toEpoch(epoch)));
}

/**
 * A publisher's per-sender frame key material (CORD-07 §3):
 * `hkdf(voice_media_key, "concord/voice-sender", sha256(utf8(identity)))` —
 * the epoch field is omitted, `voice_media_key` already carries it. Distinct
 * keys per sender partition the AEAD nonce domains; every member computes
 * every sender's key from the identity the SFU presents, no in-band exchange.
 */
export function voiceSenderKey(mediaKey: Uint8Array, identity: string): Uint8Array {
  assert32("mediaKey", mediaKey);
  return hkdf32(mediaKey, buildInfo(LABEL_VOICE_SENDER, sha256(ASCII.encode(identity))));
}

/** The dissolution tombstone's group key — community_id-keyed, epoch-free (§9). */
export function dissolvedGroupKey(communityId: Uint8Array): GroupKey {
  assert32("communityId", communityId);
  return groupKeyCached(LABEL_DISSOLVED, communityId, ZERO32);
}

/** A private Channel's rekey address for `new_epoch`, keyed by the prior community_root. */
export function channelRekeyGroupKey(
  priorRoot: Uint8Array,
  channelId: Uint8Array,
  newEpoch: number | bigint,
): GroupKey {
  assert32("priorRoot", priorRoot);
  assert32("channelId", channelId);
  return groupKeyCached(LABEL_REKEY_PSEUDONYM, priorRoot, channelId, toEpoch(newEpoch));
}

/** The base-rotation rekey address for `new_epoch`, keyed by the prior community_root. */
export function baseRekeyGroupKey(
  priorRoot: Uint8Array,
  communityId: Uint8Array,
  newEpoch: number | bigint,
): GroupKey {
  assert32("priorRoot", priorRoot);
  assert32("communityId", communityId);
  return groupKeyCached(LABEL_BASE_REKEY_PSEUDONYM, priorRoot, communityId, toEpoch(newEpoch));
}

// ── Coordinates (keyless 32-byte locators) ───────────────────────────────────

/** A member's Grant entity coordinate (the edition `eid`). */
export function grantLocator(communityId: Uint8Array, memberXonly: Uint8Array): Uint8Array {
  assert32("communityId", communityId);
  assert32("memberXonly", memberXonly);
  return hkdf32(communityId, buildInfo(LABEL_GRANT, memberXonly));
}

/** The community-wide Banlist coordinate. */
export function banlistLocator(communityId: Uint8Array): Uint8Array {
  assert32("communityId", communityId);
  return hkdf32(communityId, buildInfo(LABEL_BANLIST, ZERO32));
}

/** A creator's invite-link Registry coordinate (CORD-05 §5). */
export function inviteLinksLocator(communityId: Uint8Array, creatorXonly: Uint8Array): Uint8Array {
  assert32("communityId", communityId);
  assert32("creatorXonly", creatorXonly);
  return hkdf32(communityId, buildInfo(LABEL_INVITE_LINKS, creatorXonly));
}

/**
 * A rekey blob's per-recipient locator (CORD-06 §2):
 * `hkdf(rotator_xonly || recipient_xonly, "concord/recipient-pseudonym", scope_id, epoch)`.
 * Derived from PUBLIC inputs on purpose, so a bunker account finds its blob
 * without raw-key access; it lives only inside the encrypted rekey event.
 */
export function recipientLocator(
  rotatorXonly: Uint8Array,
  recipientXonly: Uint8Array,
  scopeId: Uint8Array,
  newEpoch: number | bigint,
): Uint8Array {
  assert32("rotatorXonly", rotatorXonly);
  assert32("recipientXonly", recipientXonly);
  const ikm = new Uint8Array(64);
  ikm.set(rotatorXonly, 0);
  ikm.set(recipientXonly, 32);
  return hkdf32(ikm, buildInfo(LABEL_RECIPIENT_PSEUDONYM, scopeId, toEpoch(newEpoch)));
}

/** The public-invite bundle decrypt key, derived from the link's unlock token. */
export function inviteBundleKey(token: Uint8Array): Uint8Array {
  return hkdf32(token, buildInfo(LABEL_INVITE_KEY, ZERO32));
}

// ── A.4: community_id ────────────────────────────────────────────────────────

/**
 * The self-certifying community identity:
 * `sha256("concord/community" || owner_xonly || owner_salt)`.
 */
export function communityIdOf(ownerXonly: Uint8Array, ownerSalt: Uint8Array): Uint8Array {
  assert32("ownerXonly", ownerXonly);
  assert32("ownerSalt", ownerSalt);
  const label = ASCII.encode(LABEL_COMMUNITY);
  const pre = new Uint8Array(label.length + 64);
  pre.set(label, 0);
  pre.set(ownerXonly, label.length);
  pre.set(ownerSalt, label.length + 32);
  return sha256(pre);
}

/** Verify a claimed (owner, salt) pair reproduces `communityId`. */
export function verifyCommunityId(communityIdHex: string, ownerHex: string, ownerSaltHex: string): boolean {
  try {
    return bytesToHex(communityIdOf(hex32(ownerHex), hex32(ownerSaltHex))) === communityIdHex.toLowerCase();
  } catch {
    return false;
  }
}

// ── A.5: epoch-key commitment ────────────────────────────────────────────────

/** `sha256("concord/epoch-key-commitment" || prev_epoch_be || prev_key)` (CORD-06). */
export function epochKeyCommitment(prevEpoch: number | bigint, prevKey: Uint8Array): Uint8Array {
  assert32("prevKey", prevKey);
  const label = ASCII.encode(LABEL_EPOCH_COMMITMENT);
  const pre = new Uint8Array(label.length + 8 + 32);
  pre.set(label, 0);
  pre.set(u64be(toEpoch(prevEpoch)), label.length);
  pre.set(prevKey, label.length + 8);
  return sha256(pre);
}
