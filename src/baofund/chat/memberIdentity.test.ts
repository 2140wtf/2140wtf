// Tests for the durable room-scoped member identity (audit F7).
//
// Invariants under test: derivation is deterministic and per-room; stored
// identities are per-account/per-room and stable; claims prove key control
// only (no human attestation anywhere); bans match the durable member key.

import { beforeEach, describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { buildMemberClaim, collectMemberClaims, isAuthorBanned, resolveMemberIdentity, verifyMemberClaim } from './memberIdentity';
import type { FoldedBanlist } from './banEditions';

const LOGIN_A = '11'.repeat(32);
const LOGIN_B = '22'.repeat(32);
const SEED = 'aa'.repeat(32);
const ROOM_1 = 'room-one';
const ROOM_2 = 'room-two';

const bansWith = (keys: string[]): FoldedBanlist => ({
  status: 'ok',
  banned: new Map(keys.map((k) => [k, { eventId: 'e', author: 'a', createdAt: 1, roomId: ROOM_1, epoch: 0, target: k, lifted: false, members: [k] }])),
  frozenTargets: [],
  forks: new Map(),
  stats: { seen: keys.length, valid: keys.length, foreign: 0 },
});

describe('resolveMemberIdentity', () => {
  beforeEach(() => localStorage.clear());

  it('derives a deterministic, room-scoped key from a seed (same device or not)', async () => {
    const a1 = await resolveMemberIdentity({ roomId: ROOM_1, loginPubkey: LOGIN_A, seedHex: SEED });
    const a2 = await resolveMemberIdentity({ roomId: ROOM_1, loginPubkey: LOGIN_A, seedHex: SEED });
    const b1 = await resolveMemberIdentity({ roomId: ROOM_2, loginPubkey: LOGIN_A, seedHex: SEED });
    const other = await resolveMemberIdentity({ roomId: ROOM_1, loginPubkey: LOGIN_B, seedHex: 'bb'.repeat(32) });
    expect(a1.source).toBe('derived');
    expect(a1.pubkey).toBe(a2.pubkey); // stable across calls (across devices too)
    expect(a1.pubkey).not.toBe(b1.pubkey); // unlinkable across rooms
    expect(a1.pubkey).not.toBe(other.pubkey); // different seed → different member
    // The member key is not the login key and not derivable from it.
    expect(a1.pubkey).not.toBe(getPublicKey(Uint8Array.from(Buffer.from(SEED, 'hex'))));
  });

  it('persists a random per-account/per-room key for non-seed logins', async () => {
    const a1 = await resolveMemberIdentity({ roomId: ROOM_1, loginPubkey: LOGIN_A, seedHex: null });
    const a2 = await resolveMemberIdentity({ roomId: ROOM_1, loginPubkey: LOGIN_A, seedHex: null });
    const room2 = await resolveMemberIdentity({ roomId: ROOM_2, loginPubkey: LOGIN_A, seedHex: null });
    const loginB = await resolveMemberIdentity({ roomId: ROOM_1, loginPubkey: LOGIN_B, seedHex: null });
    expect(a1.source).toBe('stored');
    expect(a2.pubkey).toBe(a1.pubkey); // stable across rejoins on this browser
    expect(room2.pubkey).not.toBe(a1.pubkey); // per-room
    expect(loginB.pubkey).not.toBe(a1.pubkey); // per-account namespace
  });
});

describe('member claims bind burner ↔ durable key (key control only)', () => {
  const memberSk = generateSecretKey();
  const burnerSk = generateSecretKey();
  const memberPub = getPublicKey(memberSk);
  const burnerPub = getPublicKey(burnerSk);
  const claim = buildMemberClaim({ roomId: ROOM_1, epoch: 3, memberSecretKey: memberSk, burnerSecretKey: burnerSk });

  it('verifies a well-formed claim from its burner', () => {
    const verified = verifyMemberClaim(claim, burnerPub);
    expect(verified).not.toBeNull();
    expect(verified!.memberPub).toBe(memberPub.toLowerCase());
  });

  it('rejects a claim relayed under another author, wrong room or tampered signatures', () => {
    expect(verifyMemberClaim(claim, getPublicKey(generateSecretKey()))).toBeNull();
    expect(verifyMemberClaim({ ...claim, roomId: ROOM_2 }, burnerPub)).toBeNull(); // signature binds roomId
    expect(verifyMemberClaim({ ...claim, epoch: 4 }, burnerPub)).toBeNull();
    expect(verifyMemberClaim({ ...claim, memberPub: burnerPub }, burnerPub)).toBeNull();
    expect(verifyMemberClaim({ ...claim, sigMember: claim.sigBurner }, burnerPub)).toBeNull();
    expect(verifyMemberClaim(null, burnerPub)).toBeNull();
  });

  it('collects room-filtered claims and lets a ban match the durable key', () => {
    const other = buildMemberClaim({
      roomId: ROOM_2,
      epoch: 3,
      memberSecretKey: generateSecretKey(),
      burnerSecretKey: generateSecretKey(),
    });
    const map = collectMemberClaims(
      [
        { payload: claim, author: burnerPub },
        { payload: other, author: other.burnerPub },
        { payload: { text: 'not a claim' }, author: burnerPub },
      ],
      ROOM_1,
    );
    expect([...map.keys()]).toEqual([burnerPub.toLowerCase()]);

    // Key banned directly, or via the claimed member key; unclaimed authors
    // only match their own key.
    const stranger = getPublicKey(generateSecretKey()).toLowerCase();
    expect(isAuthorBanned(bansWith([burnerPub.toLowerCase()]), map, burnerPub)).toBe(true);
    expect(isAuthorBanned(bansWith([memberPub.toLowerCase()]), map, burnerPub)).toBe(true);
    expect(isAuthorBanned(bansWith([stranger]), map, burnerPub)).toBe(false);
    expect(isAuthorBanned(bansWith([memberPub.toLowerCase()]), undefined, burnerPub)).toBe(false);
    expect(isAuthorBanned(undefined, map, burnerPub)).toBe(false);
  });
});
