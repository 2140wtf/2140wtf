import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from '@/baofund/community/crypto.js';
import {
  foldBanEditions,
  parseBanEdition,
  buildBanEditionEvent,
  buildBanLiftEvent,
  isBanned,
  banFrom,
  type BanAuthorityInput,
} from './banEditions';
import type { NostrEvent } from 'nostr-tools/pure';

function authority(overrides: Partial<BanAuthorityInput> = {}): BanAuthorityInput {
  return {
    roomId: 'room-ban-test',
    epoch: 0,
    founder: 'aa'.repeat(64),
    banPermHolders: new Set<string>(),
    ephemeral: false,
    ...overrides,
  };
}

const founderSk = generateSecretKey();
const founderPub = getPublicKey(founderSk);
const modSk = generateSecretKey(); // will hold `ban` via the role fold
const modPub = getPublicKey(modSk);
const targetSk = generateSecretKey();
const targetPub = getPublicKey(targetSk);
const target2Pub = getPublicKey(generateSecretKey());

function banEvent(signerSk: Uint8Array, opts: { roomId?: string; epoch?: number; target: string; reason?: string; createdAt?: number; alt?: string } = { target: targetPub }): NostrEvent {
  return buildBanEditionEvent(signerSk, {
    roomId: opts.roomId ?? 'room-ban-test',
    epoch: opts.epoch ?? 0,
    target: opts.target,
    reason: opts.reason,
    ...(opts.createdAt !== undefined ? { createdAt: opts.createdAt } : {}),
    ...(opts.alt !== undefined ? { alt: opts.alt } : {}),
  });
}

function liftEvent(signerSk: Uint8Array, opts: { target: string; createdAt?: number; roomId?: string; epoch?: number }): NostrEvent {
  return buildBanLiftEvent(signerSk, {
    roomId: opts.roomId ?? 'room-ban-test',
    epoch: opts.epoch ?? 0,
    target: opts.target,
    ...(opts.createdAt !== undefined ? { createdAt: opts.createdAt } : {}),
  });
}

describe('parseBanEdition - surface selection', () => {
  it('parses a founder ban edition with d-addressing and p mirror', () => {
    const event = banEvent(founderSk, { target: targetPub, reason: 'spam' });
    const parsed = parseBanEdition(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.target).toBe(targetPub);
    expect(parsed!.lifted).toBe(false);
    expect(parsed!.roomId).toBe('room-ban-test');
    expect(parsed!.epoch).toBe(0);
  });

  it('returns null for vsk:1 role editions and non-3308 events', () => {
    const roleEdition = buildBanEditionEvent(founderSk, { roomId: 'x', epoch: 0, target: targetPub });
    const tamperedVsk = { ...roleEdition, tags: roleEdition.tags.map((t) => (t[0] === 'vsk' ? ['vsk', '1'] : t)) } as NostrEvent;
    expect(parseBanEdition(tamperedVsk)).toBeNull();
    expect(parseBanEdition({ ...roleEdition, kind: 9 } as NostrEvent)).toBeNull();
  });

  it('rejects a p tag that disagrees with the d tag', () => {
    const event = banEvent(founderSk);
    const disagreeing = { ...event, tags: [...event.tags.filter((t) => t[0] !== 'p'), ['p', 'bb'.repeat(64)]] } as NostrEvent;
    expect(parseBanEdition(disagreeing)).toBeNull();
  });
});

describe('foldBanEditions - authority and deny-only semantics', () => {
  it('founder ban applies; isBanned is deny-only and banFrom anchors to created_at', () => {
    const event = banEvent(founderSk, { target: targetPub });
    const folded = foldBanEditions([event], authority({ founder: founderPub }));
    expect(folded.status).toBe('ok');
    expect(isBanned(folded, targetPub)).toBe(true);
    expect(banFrom(folded, targetPub)).toBe(event.created_at);
    expect(isBanned(folded, target2Pub)).toBe(false);
    expect(folded.stats).toMatchObject({ seen: 1, valid: 1, foreign: 0 });
  });

  it('a ban-perm holder may ban; a plain key may not (foreign, ignored)', () => {
    const holderEvent = banEvent(modSk, { target: targetPub });
    const holderFold = foldBanEditions([holderEvent], authority({ founder: founderPub, banPermHolders: new Set([modPub]) }));
    expect(isBanned(holderFold, targetPub)).toBe(true);

    const plainSk = generateSecretKey();
    const plainEvent = banEvent(plainSk, { target: targetPub });
    const plainFold = foldBanEditions([plainEvent], authority({ founder: founderPub }));
    expect(isBanned(plainFold, targetPub)).toBe(false);
    expect(plainFold.stats.foreign).toBe(1);
  });

  it('a tampered event fails client-side verification (hostile relay cannot fabricate)', () => {
    const event = banEvent(founderSk, { target: targetPub });
    const tampered = { ...event, content: 'tampered after signing' } as NostrEvent;
    const folded = foldBanEditions([tampered], authority({ founder: founderPub }));
    expect(isBanned(folded, targetPub)).toBe(false);
    expect(folded.stats.foreign).toBe(1);
  });
});

describe('foldBanEditions - lifts and per-target resolution', () => {
  it('a lift (empty member restatement) removes the ban - omission is deletion', () => {
    const ban = banEvent(founderSk, { target: targetPub, createdAt: 1_700_000_000 });
    const lift = liftEvent(founderSk, { target: targetPub, createdAt: 1_700_000_010 });
    expect(parseBanEdition(lift)!.lifted).toBe(true);

    const folded = foldBanEditions([ban, lift], authority({ founder: founderPub }));
    expect(isBanned(folded, targetPub)).toBe(false);
    expect(folded.status).toBe('ok');
    expect(folded.stats.valid).toBe(2);
  });

  it('a ban subject cannot lift their own ban, but an independent holder can', () => {
    // Moderator holds `ban`; the founder bans them. Their own lift must be
    // foreign (a removal cannot be reversed by the principal it targets).
    const ban = banEvent(founderSk, { target: modPub, createdAt: 1_700_000_001 });
    const selfLift = liftEvent(modSk, { target: modPub, createdAt: 1_700_000_002 });
    const selfFolded = foldBanEditions(
      [ban, selfLift],
      authority({ founder: founderPub, banPermHolders: new Set([modPub]) }),
    );
    expect(isBanned(selfFolded, modPub)).toBe(true);
    expect(selfFolded.stats.foreign).toBe(1);

    // An independent ban-perm holder can still lift it.
    const otherHolderSk = generateSecretKey();
    const otherHolderPub = getPublicKey(otherHolderSk);
    const lift = liftEvent(otherHolderSk, { target: modPub, createdAt: 1_700_000_003 });
    const folded = foldBanEditions(
      [ban, lift],
      authority({ founder: founderPub, banPermHolders: new Set([otherHolderPub]) }),
    );
    expect(isBanned(folded, modPub)).toBe(false);
  });

  it('a same-second ban+lift leaves the slot frozen with the ban STANDING (conservative)', () => {
    const t0 = 1_700_000_050;
    const ban = banEvent(founderSk, { target: targetPub, createdAt: t0 });
    const lift = liftEvent(founderSk, { target: targetPub, createdAt: t0 });
    const folded = foldBanEditions([ban, lift], authority({ founder: founderPub }));
    expect(isBanned(folded, targetPub)).toBe(true); // deny-only: ambiguity keeps the ban
    expect(folded.frozenTargets).toEqual([targetPub]);
    // Fork evidence is deterministic by event-id ordering, not by semantic
    // ban/lift order; both conflicting signed events must be retained.
    expect(new Set(folded.forks.get(targetPub))).toEqual(new Set([ban.id, lift.id]));
    // A strictly later lift resolves the fork.
    const resolved = foldBanEditions(
      [ban, lift, liftEvent(founderSk, { target: targetPub, createdAt: t0 + 5 })],
      authority({ founder: founderPub }),
    );
    expect(isBanned(resolved, targetPub)).toBe(false);
    expect(resolved.frozenTargets).toEqual([]);
  });

  it('ban → lift → re-ban resolves to the latest word per target', () => {
    const t0 = 1_700_000_000;
    const ban1 = banEvent(founderSk, { target: targetPub, createdAt: t0 });
    const lift = liftEvent(founderSk, { target: targetPub, createdAt: t0 + 10 });
    const ban2 = banEvent(founderSk, { target: targetPub, createdAt: t0 + 20 });
    const folded = foldBanEditions([ban1, lift, ban2], authority({ founder: founderPub }));
    expect(isBanned(folded, targetPub)).toBe(true);
    expect(banFrom(folded, targetPub)).toBe(t0 + 20);
  });

  it('targets are independent - one d slot never affects another (B1)', () => {
    const t0 = 1_700_000_000;
    const banT1 = banEvent(founderSk, { target: targetPub, createdAt: t0 });
    const banT2 = banEvent(founderSk, { target: target2Pub, createdAt: t0 });
    const liftT1 = liftEvent(founderSk, { target: targetPub, createdAt: t0 + 10 });
    const folded = foldBanEditions([banT1, banT2, liftT1], authority({ founder: founderPub }));
    expect(isBanned(folded, targetPub)).toBe(false);
    expect(isBanned(folded, target2Pub)).toBe(true);
  });
});

describe('foldBanEditions - fork, epoch, tier', () => {
  it('same-timestamp conflicting editions for one target freeze THAT slot (never newest-wins), others keep folding', () => {
    const t0 = 1_700_000_100;
    const a = banEvent(founderSk, { target: targetPub, createdAt: t0 });
    const bDistinct = banEvent(founderSk, { target: targetPub, createdAt: t0, alt: 'conflicting edition' });
    expect(a.id).not.toBe(bDistinct.id);

    const later = banEvent(founderSk, { target: target2Pub, createdAt: t0 + 99 });
    const folded = foldBanEditions([a, bDistinct, later], authority({ founder: founderPub }));
    expect(folded.frozenTargets).toEqual([targetPub]);
    // The applied side is the id-ascending tie-break winner (same rule as
    // the role fold); the second element is the conflicting edition.
    const [appliedId, conflictId] = [a.id, bDistinct.id].sort();
    expect(folded.forks.get(targetPub)).toEqual([appliedId, conflictId]);
    expect(isBanned(folded, targetPub)).toBe(true); // slot frozen at the ban
    expect(isBanned(folded, target2Pub)).toBe(true); // other targets keep folding
    // A strictly later edition for the frozen target resolves it.
    const resolved = foldBanEditions(
      [a, bDistinct, liftEvent(founderSk, { target: targetPub, createdAt: t0 + 5 })],
      authority({ founder: founderPub }),
    );
    expect(resolved.frozenTargets).toEqual([]);
    expect(isBanned(resolved, targetPub)).toBe(false);
  });

  it('editions for another epoch or room are foreign; ephemeral tier yields an empty list', () => {
    const otherEpoch = banEvent(founderSk, { target: targetPub, epoch: 3 });
    const otherRoom = banEvent(founderSk, { target: targetPub, roomId: 'room-other' });
    const folded = foldBanEditions([otherEpoch, otherRoom], authority({ founder: founderPub }));
    expect(folded.status).toBe('none');
    expect(isBanned(folded, targetPub)).toBe(false);

    const ephemeralFold = foldBanEditions([banEvent(founderSk, { target: targetPub })], authority({ ephemeral: true }));
    expect(isBanned(ephemeralFold, targetPub)).toBe(false);
  });
});

// ── NIP-40 kick (expiring deny) - Discord-style timeout (2026-09-15) ──────

describe('foldBanEditions - NIP-40 kick (expiration)', () => {
  const NOW = 1_700_000_000;
  const auth = () => authority({ founder: founderPub, nowSeconds: () => NOW });

  it('keeps a kick in force while unexpired', () => {
    const ev = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub,
      expiration: NOW + 60, // expires in 1 minute - still in force
    });
    const folded = foldBanEditions([ev], auth());
    expect(folded.status).toBe('ok');
    expect(isBanned(folded, targetPub)).toBe(true);
  });

  it('folds an expired kick as a lift (deny lapsed)', () => {
    const ev = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub,
      expiration: NOW - 1, // already lapsed
    });
    const folded = foldBanEditions([ev], auth());
    expect(folded.status).toBe('ok');
    expect(isBanned(folded, targetPub)).toBe(false);
    expect(folded.banned.size).toBe(0);
  });

  it('treats the expiration boundary as expired at exactly now (lapse at ts)', () => {
    const ev = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub, expiration: NOW,
    });
    const folded = foldBanEditions([ev], auth());
    expect(isBanned(folded, targetPub)).toBe(false);
  });

  it('a later edition (re-ban) after an expired kick is in force again', () => {
    const kick = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub, expiration: NOW - 10,
      createdAt: NOW - 20,
    });
    const reban = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub, createdAt: NOW - 5,
    });
    const folded = foldBanEditions([kick, reban], auth());
    expect(isBanned(folded, targetPub)).toBe(true);
  });

  it('a malformed expiration tag is ignored - the deny stands (fail closed)', () => {
    const ev = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub,
    });
    // Splice a garbage expiration into the tags after signing.
    const corrupted: NostrEvent = { ...ev, tags: [...ev.tags, ['expiration', 'not-a-number']] };
    const folded = foldBanEditions([corrupted], auth());
    // id/signature no longer match the mutated tags… the fold verifies
    // client-side, so this event must be rejected as foreign entirely.
    expect(folded.stats.foreign).toBe(1);
    expect(isBanned(folded, targetPub)).toBe(false);
  });

  it('kick then lift within the window lifts immediately', () => {
    const kick = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub, expiration: NOW + 3600,
      createdAt: NOW - 30,
    });
    const lift = buildBanLiftEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub, createdAt: NOW - 10,
    });
    const folded = foldBanEditions([kick, lift], auth());
    expect(isBanned(folded, targetPub)).toBe(false);
  });

  it('an expired kick never lifts an older standing permanent ban (deny-only conservatism)', () => {
    const ban = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub, createdAt: NOW - 100,
    });
    const kick = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub, createdAt: NOW - 50,
      expiration: NOW - 1, // the kick has lapsed…
    });
    const folded = foldBanEditions([ban, kick], auth());
    // …but the permanent ban from before it still stands: only a `ban`-perm
    // lift (or a later ban-perm restatement) grants admission back.
    expect(isBanned(folded, targetPub)).toBe(true);
    expect(banFrom(folded, targetPub)).toBe(NOW - 100);
  });

  it('a later permanent ban still applies after an expired kick', () => {
    const kick = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub, createdAt: NOW - 100,
      expiration: NOW - 1,
    });
    const ban = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub, createdAt: NOW - 50,
    });
    const folded = foldBanEditions([kick, ban], auth());
    expect(isBanned(folded, targetPub)).toBe(true);
    expect(banFrom(folded, targetPub)).toBe(NOW - 50);
  });

  it('wall-clock default: without nowSeconds injection the fold still works', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const ev = buildBanEditionEvent(founderSk, {
      roomId: 'room-ban-test', epoch: 0, target: targetPub, expiration: future,
    });
    const folded = foldBanEditions([ev], authority({ founder: founderPub }));
    expect(isBanned(folded, targetPub)).toBe(true);
  });
});
