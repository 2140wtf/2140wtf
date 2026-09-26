import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from '@/baofund/community/crypto.js';
import {
  ROLE_CATALOG_V1,
  buildRoleEditionTags,
  foldRoleEditions,
  hasPerm,
  parseRoleEdition,
  permsFor,
  roleDef,
  signerClassFor,
  structureMatches,
  type EditionSpec,
} from './roleEditions';

function key() {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

/** Sign an edition at a PINNED created_at (fork tests need deterministic
 *  timestamps; the production builder stamps Date.now()). */
function signEdition(sk: Uint8Array, createdAt: number, spec: EditionSpec): NostrEvent {
  return finalizeEvent(
    { kind: 3308, created_at: createdAt, tags: buildRoleEditionTags(spec), content: '' },
    sk,
  );
}

function modSpec(memberPks: string[], extraPerms: Array<{ roleId: string; perm: EditionSpec['perms'][number]['perm'] }> = []): EditionSpec {
  return {
    roomId: 'test-room',
    epoch: 0,
    roles: [{ id: 'moderator', rank: 1 }],
    perms: [{ roleId: 'moderator', perm: 'role-grant' }, ...extraPerms],
    members: memberPks.map((pubkey) => ({ roleId: 'moderator', pubkey })),
  };
}

const ROOM = { roomId: 'test-room', epoch: 0 };

describe('§7.1 - founder edition folds and resolves the mod badge', () => {
  it('founder-signed edition with one moderator grants catalog perms to the member', () => {
    const founder = key();
    const mod = key();
    const edition = signEdition(founder.sk, 100, modSpec([mod.pk]));
    const folded = foldRoleEditions([edition], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.status).toBe('ok');
    expect(folded.frozen).toBe(false);
    const granted = folded.grants.get(mod.pk);
    expect(granted).toHaveLength(1);
    expect(granted![0]).toMatchObject({ roleId: 'moderator', rank: 1, known: true });
    // Catalog perms for moderator (§8 D1 table), resolvable by the UI badge.
    for (const perm of ['pin', 'kick', 'ban', 'delete-message', 'role-grant'] as const) {
      expect(hasPerm(folded, mod.pk, perm)).toBe(true);
    }
    // The founder (in no role) is a plain member.
    expect(permsFor(folded, founder.pk)).toEqual([]);
    expect(folded.stats).toMatchObject({ seen: 1, valid: 1, foreign: 0 });
  });
});

describe('§7.2 - full-restatement replacement updates the fold', () => {
  it('a later founder edition (adds a second mod) replaces the earlier one', () => {
    const founder = key();
    const mod1 = key();
    const mod2 = key();
    const a = signEdition(founder.sk, 100, modSpec([mod1.pk]));
    const b = signEdition(founder.sk, 200, modSpec([mod1.pk, mod2.pk]));
    const folded = foldRoleEditions([a, b], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.status).toBe('ok');
    expect(folded.edition?.eventId).toBe(b.id);
    expect(folded.grants.has(mod1.pk)).toBe(true);
    expect(folded.grants.has(mod2.pk)).toBe(true);
    expect(folded.stats).toMatchObject({ valid: 2 });
    // Omission is deletion: a restatement WITHOUT mod1 removes them.
    const c = signEdition(founder.sk, 300, modSpec([mod2.pk]));
    const foldedC = foldRoleEditions([a, b, c], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(foldedC.grants.has(mod1.pk)).toBe(false);
    expect(foldedC.grants.has(mod2.pk)).toBe(true);
  });
});

describe('§7.3 - same-timestamp valid editions are a fork; nothing after applies', () => {
  it('freezes on the conflicting pair and never resolves newest-wins', () => {
    const founder = key();
    const mod = key();
    const a = signEdition(founder.sk, 100, modSpec([mod.pk]));
    const conflicting = signEdition(founder.sk, 100, modSpec([mod.pk], [{ roleId: 'moderator', perm: 'pin-role' }]));
    const later = signEdition(founder.sk, 999, modSpec([]));
    const folded = foldRoleEditions([a, conflicting, later], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.status).toBe('fork');
    expect(folded.frozen).toBe(true);
    // Both conflicting ids are recorded; the deterministic id tie-break
    // decides which one is the retained pre-fork state - the fold itself is
    // order-independent, so assert the pair as a set.
    expect([...(folded.forkIds ?? [])].sort()).toEqual([a.id, conflicting.id].sort());
    // The pre-fork state is retained (rendered, marked frozen)…
    expect([a.id, conflicting.id]).toContain(folded.edition?.eventId);
    expect(folded.grants.has(mod.pk)).toBe(true);
    // …and the later edition was NOT auto-applied after the fork.
    expect(folded.stats.valid).toBe(1);
  });
});

describe('§7.4 - foreign and tampered editions are ignored, never an error', () => {
  it('a non-founder edition without pin-role does not touch the fold', () => {
    const founder = key();
    const attacker = key();
    const mod = key();
    const a = signEdition(founder.sk, 100, modSpec([mod.pk]));
    const fake = signEdition(attacker.sk, 150, modSpec([attacker.pk]));
    const folded = foldRoleEditions([a, fake], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.status).toBe('ok');
    expect(folded.edition?.eventId).toBe(a.id);
    expect(folded.grants.has(attacker.pk)).toBe(false);
    expect(folded.stats).toMatchObject({ valid: 1, foreign: 1 });
  });
  it('a tampered founder-signed event fails client-side verification (hostile relay)', () => {
    const founder = key();
    const mod = key();
    const genuine = signEdition(founder.sk, 100, modSpec([mod.pk]));
    const tampered: NostrEvent = { ...genuine, content: 'relay-injected content' };
    expect(signerClassFor(tampered, { founder: founder.pk, top: null })).toBe('foreign');
    const folded = foldRoleEditions([tampered], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.status).toBe('none');
    expect(folded.stats.foreign).toBe(1);
  });
  it('an edition for another epoch is out of scope for this fold', () => {
    const founder = key();
    const spec = { ...modSpec([]), epoch: 5 };
    const other = signEdition(founder.sk, 100, spec);
    const folded = foldRoleEditions([other], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.status).toBe('none');
    expect(folded.stats.seen).toBe(0);
  });
});

describe('§7.5 - ephemeral rooms reject roles entirely (tier honesty)', () => {
  it('ignores even founder-signed editions in the ephemeral tier', () => {
    const founder = key();
    const edition = signEdition(founder.sk, 100, modSpec([]));
    const folded = foldRoleEditions([edition], { ...ROOM, founder: founder.pk, ephemeral: true });
    expect(folded.status).toBe('ignored-ephemeral');
    expect(folded.edition).toBeNull();
    expect(folded.grants.size).toBe(0);
  });
});

describe('§7.6 - pin-role holders can grant; others cannot (fold half)', () => {
  it('an agent granted pin-role publishes an accepted membership restatement; a plain member cannot', () => {
    const founder = key();
    const agent = key();
    const outsider = key();
    const newMod = key();
    // Founder edition grants the agent pin-role (declared perm on moderator).
    const a = signEdition(founder.sk, 100, modSpec([agent.pk], [{ roleId: 'moderator', perm: 'pin-role' }]));
    const top = parseRoleEdition(a)!;
    const initialFold = foldRoleEditions([a], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(hasPerm(initialFold, agent.pk, 'pin-role')).toBe(true);
    // The agent's membership-only restatement is accepted…
    const fromAgent = signEdition(agent.sk, 200, modSpec([agent.pk, newMod.pk], [{ roleId: 'moderator', perm: 'pin-role' }]));
    expect(signerClassFor(fromAgent, { founder: founder.pk, top })).toBe('pin-role-holder');
    const folded = foldRoleEditions([a, fromAgent], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.status).toBe('ok');
    expect(folded.edition?.eventId).toBe(fromAgent.id);
    expect(folded.grants.has(newMod.pk)).toBe(true);
    // …while an outsider with no pin-role folds as foreign.
    const fromOutsider = signEdition(outsider.sk, 300, modSpec([outsider.pk], [{ roleId: 'moderator', perm: 'pin-role' }]));
    const folded2 = foldRoleEditions([a, fromAgent, fromOutsider], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded2.edition?.eventId).toBe(fromAgent.id);
    expect(folded2.grants.has(outsider.pk)).toBe(false);
    expect(folded2.stats.foreign).toBe(1);
  });
});

describe('§7.8 - unknown catalog version folds fail-closed', () => {
  it('unknown catv renders known:false, enforces NOTHING, fold otherwise ok', () => {
    const founder = key();
    const mod = key();
    const spec: EditionSpec = { ...modSpec([mod.pk]), catv: 9 };
    const edition = signEdition(founder.sk, 100, spec);
    const folded = foldRoleEditions([edition], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.status).toBe('ok');
    expect(folded.unknownCatalog).toBe(true);
    const granted = folded.grants.get(mod.pk)!;
    expect(granted[0].known).toBe(false); // renders `?`
    expect(granted[0].perms).toEqual([]); // enforces NOTHING
    for (const perm of ['pin', 'kick', 'ban', 'delete-message', 'role-grant', 'pin-role'] as const) {
      expect(hasPerm(folded, mod.pk, perm)).toBe(false);
    }
    // And an unknown-catalog top authorizes nobody but the founder (D2).
    const later = signEdition(founder.sk, 200, { ...modSpec([mod.pk]), catv: 9 });
    expect(signerClassFor(later, { founder: founder.pk, top: folded.edition })).toBe('founder');
  });
  it('absent catv defaults to 1 (known), per spec', () => {
    const founder = key();
    const tags = buildRoleEditionTags(modSpec([])).filter((t) => t[0] !== 'catv');
    const edition = finalizeEvent({ kind: 3308, created_at: 100, tags, content: '' }, founder.sk);
    const folded = foldRoleEditions([edition], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.unknownCatalog).toBe(false);
    expect(folded.edition?.catv).toBe(1);
  });
});

describe('§7.9 - structure preservation for non-founder editions', () => {
  it('membership-only restatement applies; altering perm/role structure folds as foreign', () => {
    const founder = key();
    const agent = key();
    const newMod = key();
    const a = signEdition(founder.sk, 100, modSpec([agent.pk], [{ roleId: 'moderator', perm: 'pin-role' }]));
    const top = parseRoleEdition(a)!;
    // Same structure, member set changes only → valid.
    const membershipOnly = signEdition(agent.sk, 200, modSpec([agent.pk, newMod.pk], [{ roleId: 'moderator', perm: 'pin-role' }]));
    expect(structureMatches(parseRoleEdition(membershipOnly)!, top)).toBe(true);
    // Perm alteration (drops pin-role from the restatement) → foreign.
    const permAltered = signEdition(agent.sk, 200, modSpec([agent.pk, newMod.pk]));
    expect(structureMatches(parseRoleEdition(permAltered)!, top)).toBe(false);
    expect(signerClassFor(permAltered, { founder: founder.pk, top })).toBe('pin-role-holder');
    const folded = foldRoleEditions([a, membershipOnly, permAltered], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.edition?.eventId).toBe(membershipOnly.id);
    expect(folded.stats.foreign).toBe(1);
    // A founder edition may restructure freely.
    const restructured = signEdition(founder.sk, 300, {
      roomId: 'test-room', epoch: 0,
      roles: [{ id: 'moderator', rank: 1 }, { id: 'curator', rank: 2 }],
      perms: [{ roleId: 'curator', perm: 'pin' }],
      members: [{ roleId: 'curator', pubkey: newMod.pk }],
    });
    const folded2 = foldRoleEditions([a, membershipOnly, restructured], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded2.edition?.eventId).toBe(restructured.id);
    expect(folded2.grants.get(newMod.pk)![0].roleId).toBe('curator');
  });
});

describe('catalog + parser edges', () => {
  it('catv:1 catalog matches the spec §8 D1 table', () => {
    expect(ROLE_CATALOG_V1.map((r) => r.id)).toEqual(['moderator', 'curator', 'greeter']);
    expect(roleDef(1, 'moderator')?.perms).toEqual(['pin', 'kick', 'ban', 'delete-message', 'role-grant']);
    expect(roleDef(1, 'curator')?.perms).toEqual(['pin', 'delete-message']);
    expect(roleDef(1, 'greeter')?.perms).toEqual([]);
    expect(roleDef(1, 'treasurer')).toBeNull();
    expect(roleDef(2, 'moderator')).toBeNull();
  });
  it('malformed member entries are dropped, never thrown', () => {
    const founder = key();
    const tags = buildRoleEditionTags(modSpec([]));
    tags.push(['member', 'moderator', 'not-hex']);
    tags.push(['member', 'moderator', 'zz'.repeat(32)]);
    const edition = finalizeEvent({ kind: 3308, created_at: 100, tags, content: '' }, founder.sk);
    const folded = foldRoleEditions([edition], { ...ROOM, founder: founder.pk, ephemeral: false });
    expect(folded.grants.size).toBe(0);
  });
});
