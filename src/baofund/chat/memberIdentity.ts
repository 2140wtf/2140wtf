// src/chat/memberIdentity.ts
//
// Durable, room-scoped, pseudonymous MEMBER identity for chat - the app-side
// half of the identity fix (audit F7).
//
// Design invariants:
//   * No human attestation, no account binding, no `is this a human` branch.
//     The claim proves KEY CONTROL only, so an agent-only room is a
//     first-class configuration and no room may require personhood.
//   * The login npub never appears on the wire and is never derived from:
//     seed identities derive a per-room child (unlinkable, reproducible on
//     any device); every other login method keeps a random per-room key in
//     local storage (unlinkable, device-scoped).
//   * The claim binds the ephemeral transport burner to the durable member
//     key with two signatures, so it can ride the ordinary encrypted room
//     payload channel without any relay/welcomer change.

import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { KDF_LABELS, deriveSubkey } from '../wallet/keySchedule';
import type { FoldedBanlist } from './banEditions';

export const MEMBER_CLAIM_TYPE = 'bao-fund/member-claim';
export const MEMBER_CLAIM_VERSION = 1;
const CLAIM_DOMAIN = 'bao-fund/member-claim/v1';
const STORE_PREFIX = 'baofund:chat-member';
const HEX64 = /^[0-9a-fA-F]{64}$/;

export interface MemberIdentity {
  /** Durable room-scoped public key (pseudonymous). */
  pubkey: string;
  /** Raw 32-byte key for signing the join claim / control editions. */
  secretKey: Uint8Array;
  /** `derived` = reproducible from the seed on any device; `stored` = a
   *  random per-room key kept in this browser (extension/passkey logins). */
  source: 'derived' | 'stored';
}

export interface MemberClaim {
  type: typeof MEMBER_CLAIM_TYPE;
  v: typeof MEMBER_CLAIM_VERSION;
  roomId: string;
  epoch: number;
  /** Durable member key claimed for this burner. */
  memberPub: string;
  /** Ephemeral transport key that signed the claim (envelope author). */
  burnerPub: string;
  sigMember: string;
  sigBurner: string;
}

const storageKey = (loginPubkey: string, roomId: string): string =>
  `${STORE_PREFIX}:${loginPubkey.toLowerCase()}:${roomId}`;

const pubkeyOf = (secretKey: Uint8Array): string => bytesToHex(schnorr.getPublicKey(secretKey));

function claimDigest(input: { roomId: string; epoch: number; memberPub: string; burnerPub: string }): Uint8Array {
  return sha256(
    utf8ToBytes(`${CLAIM_DOMAIN}\n${input.roomId}\n${input.epoch}\n${input.memberPub}\n${input.burnerPub}`),
  );
}

/**
 * Resolve this account's durable identity for one room.
 *
 * Seed logins derive `deriveSubkey(identity, 'chat-room-identity', roomId)`
 * so the member is the same on every device and unlinkable across rooms.
 * Every other login method (passkey, NIP-07, NIP-46, guest) uses a random
 * per-room key persisted in this browser only - the only option that never
 * needs raw login-key material and never links rooms to the account.
 */
export async function resolveMemberIdentity(input: {
  roomId: string;
  loginPubkey: string;
  /** Hex identity key when signed in via seed; null/absent otherwise. */
  seedHex?: string | null;
}): Promise<MemberIdentity> {
  const { roomId, loginPubkey } = input;
  if (HEX64.test(input.seedHex ?? '')) {
    const master = hexToBytes(input.seedHex as string);
    const secretKey = deriveSubkey(master, KDF_LABELS.chatRoomIdentity, utf8ToBytes(roomId)).slice(0, 32);
    const identity: MemberIdentity = { pubkey: pubkeyOf(secretKey), secretKey, source: 'derived' };
    try {
      localStorage.setItem(
        storageKey(loginPubkey, roomId),
        JSON.stringify({ v: 1, pubkey: identity.pubkey, source: 'derived' }),
      );
    } catch { /* storage unavailable - derived identity still works */ }
    return identity;
  }

  try {
    const raw = localStorage.getItem(storageKey(loginPubkey, roomId));
    if (raw) {
      const parsed = JSON.parse(raw) as { secretKey?: unknown };
      if (typeof parsed.secretKey === 'string' && HEX64.test(parsed.secretKey)) {
        const secretKey = hexToBytes(parsed.secretKey);
        return { pubkey: pubkeyOf(secretKey), secretKey, source: 'stored' };
      }
    }
  } catch { /* fall through to a fresh key */ }

  const secretKey = randomBytes(32);
  try {
    localStorage.setItem(
      storageKey(loginPubkey, roomId),
      JSON.stringify({ v: 1, secretKey: bytesToHex(secretKey), pubkey: pubkeyOf(secretKey), source: 'stored' }),
    );
  } catch { /* memory-only identity this session */ }
  return { pubkey: pubkeyOf(secretKey), secretKey, source: 'stored' };
}

/** Build the in-room claim that binds `burnerPub` to the durable member key. */
export function buildMemberClaim(input: {
  roomId: string;
  epoch: number;
  memberSecretKey: Uint8Array;
  burnerSecretKey: Uint8Array;
}): MemberClaim {
  const memberPub = pubkeyOf(input.memberSecretKey);
  const burnerPub = pubkeyOf(input.burnerSecretKey);
  const digest = claimDigest({ roomId: input.roomId, epoch: input.epoch, memberPub, burnerPub });
  return {
    type: MEMBER_CLAIM_TYPE,
    v: MEMBER_CLAIM_VERSION,
    roomId: input.roomId,
    epoch: input.epoch,
    memberPub,
    burnerPub,
    sigMember: bytesToHex(schnorr.sign(digest, input.memberSecretKey)),
    sigBurner: bytesToHex(schnorr.sign(digest, input.burnerSecretKey)),
  };
}

/**
 * Verify a claim payload: shape, key formats, that the ENVELOPE author is the
 * burner it names, and both signatures over the room/epoch-bound digest.
 * Returns the claim or null; never throws.
 */
export function verifyMemberClaim(payload: unknown, envelopeAuthor: string): MemberClaim | null {
  if (!payload || typeof payload !== 'object') return null;
  const c = payload as Partial<MemberClaim>;
  if (c.type !== MEMBER_CLAIM_TYPE || c.v !== MEMBER_CLAIM_VERSION) return null;
  if (typeof c.roomId !== 'string' || c.roomId.length === 0 || c.roomId.length > 256) return null;
  if (!Number.isSafeInteger(c.epoch) || (c.epoch as number) < 0) return null;
  if (typeof c.memberPub !== 'string' || !HEX64.test(c.memberPub)) return null;
  if (typeof c.burnerPub !== 'string' || !HEX64.test(c.burnerPub)) return null;
  if (typeof c.sigMember !== 'string' || typeof c.sigBurner !== 'string') return null;
  if (c.burnerPub.toLowerCase() !== envelopeAuthor.toLowerCase()) return null;
  const digest = claimDigest({
    roomId: c.roomId,
    epoch: c.epoch as number,
    memberPub: c.memberPub.toLowerCase(),
    burnerPub: c.burnerPub.toLowerCase(),
  });
  try {
    const memberOk = schnorr.verify(hexToBytes(c.sigMember), digest, hexToBytes(c.memberPub));
    const burnerOk = schnorr.verify(hexToBytes(c.sigBurner), digest, hexToBytes(c.burnerPub));
    if (!memberOk || !burnerOk) return null;
  } catch {
    return null;
  }
  return {
    type: MEMBER_CLAIM_TYPE,
    v: MEMBER_CLAIM_VERSION,
    roomId: c.roomId,
    epoch: c.epoch as number,
    memberPub: c.memberPub.toLowerCase(),
    burnerPub: c.burnerPub.toLowerCase(),
    sigMember: c.sigMember,
    sigBurner: c.sigBurner,
  };
}

/** Burner → member map builder, room-filtered. Latest verified claim wins. */
export function collectMemberClaims(
  claims: Iterable<{ payload: unknown; author: string }>,
  roomId: string,
): Map<string, string> {
  const byBurner = new Map<string, string>();
  for (const { payload, author } of claims) {
    const claim = verifyMemberClaim(payload, author);
    if (!claim || claim.roomId !== roomId) continue;
    byBurner.set(claim.burnerPub, claim.memberPub);
  }
  return byBurner;
}

/**
 * True when the author is removed: either the transport key itself is on the
 * deny list, or the author's claimed durable member key is. Claimed identity
 * is the reason bans survive rejoin; an unclaimed author only matches their
 * current key.
 */
export function isAuthorBanned(
  bans: FoldedBanlist | undefined,
  memberIds: Map<string, string> | undefined,
  author: string,
): boolean {
  if (!bans || bans.status !== 'ok') return false;
  const key = author.toLowerCase();
  if (bans.banned.has(key)) return true;
  const member = memberIds?.get(key);
  return member ? bans.banned.has(member) : false;
}
