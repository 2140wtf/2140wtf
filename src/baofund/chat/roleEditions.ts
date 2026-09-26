// src/chat/roleEditions.ts
//
// User roles - kind 3308 `vsk:1` role editions (docs/USER-ROLES-3308-SPEC.md).
//
// Wire model: a role edition is a PUBLIC STORED kind-3308 event on the room's
// relay set (same relay policy as the guestbook pair - spec §4). It is NOT an
// encrypted room envelope: the fold reads it with raw relay queries, and the
// relay can see (but not forge - client-side schnorr verification below) the
// role structure. This is the tier-honesty trade the spec makes: roles are
// unsupported in ephemeral/shielded rooms, where a stored public artifact
// would contradict the privacy tier (§4/§5, §7 test 5).
//
// Authority (spec §3, §8 D2): the room FOUNDER key signs freely; a pubkey
// currently holding `pin-role` in the top edition may publish too, but only
// membership-only restatements (structure rule, §2). FROST court keys are v1
// and fold as foreign in v0. The founder key for a provisioned room is the
// room's `governance` pubkey (the API provisions rooms under it - the same
// key whose redaction lists are already trusted fail-closed).
//
// Fork discipline (spec §5 - the B1 lesson): 3308 is in Nostr's
// addressable/replaceable range, so fold identity is CLIENT-side. Two valid
// editions at the same `created_at` are a fork: the room freezes (same
// `chain_forked`-style frozen verdict as the campaign ledger), nothing after
// the fork auto-applies, and the UI shows the banner until the founder
// republishes at a later timestamp. Replacement (same room, newer
// created_at) is the normal update path - full-set restatement makes it safe.
//
// Catalog (spec §8 D1): roleIds are NOT free text. v0 ships one catalog
// (`catv:1`); unknown catalog versions fold fail-closed - roles render `?`
// and enforce NOTHING (B4's rule applied to semantics, §7 test 8).
//
// B8 separation: nothing in this module may feed ledger folds or escrow
// gates. Roles are social-surface only; financial eligibility is
// registrar/court capability (fundEscrowGates.ts in the isolated fund API -
// §7 test 7 asserts the gate's input has no role surface at all).

import {
  finalizeEvent,
  verifyEvent,
  type NostrEvent,
} from '@/baofund/community/crypto.js';

// ─── Catalog (spec §8 D1) ─────────────────────────────────────────────────

export const ROLE_KIND = 3308;
export const ROLE_CATALOG_VERSION = 1;

/** Closed perm vocabulary (spec §2). `pin-role` = who may publish vsk:1
 *  editions; `role-grant` is reserved for v1 chat-level role requests - v0
 *  edition publication is gated on `pin-role` only (spec §2/§6). */
export const PERM_VOCABULARY = [
  'pin',
  'kick',
  'ban',
  'role-grant',
  'delete-message',
  'pin-role',
] as const;
export type Perm = (typeof PERM_VOCABULARY)[number];

export interface RoleDef {
  id: string;
  rank: number; // lower = more powerful (display-only tie-break)
  perms: readonly Perm[];
}

/** The `catv:1` catalog. Only the founder holds `pin-role` by default; it
 *  may be granted via an edition's perm tags (spec §8 D1). Dropping a member
 *  or perm = omit it from the next full restatement - there is deliberately
 *  no delete tag (omission is deletion). */
export const ROLE_CATALOG_V1: readonly RoleDef[] = [
  { id: 'moderator', rank: 1, perms: ['pin', 'kick', 'ban', 'delete-message', 'role-grant'] },
  { id: 'curator', rank: 2, perms: ['pin', 'delete-message'] },
  { id: 'greeter', rank: 3, perms: [] },
];

export const ROLE_CATALOGS: ReadonlyMap<number, readonly RoleDef[]> = new Map([
  [ROLE_CATALOG_VERSION, ROLE_CATALOG_V1],
]);

export function roleDef(catv: number, roleId: string): RoleDef | null {
  return ROLE_CATALOGS.get(catv)?.find((r) => r.id === roleId) ?? null;
}

// ─── Parsed edition ───────────────────────────────────────────────────────

/** A structurally-parsed vsk:1 edition. Signature validity is NOT implied -
 *  `signerClassFor` decides authority against the current fold state. */
export interface RoleEdition {
  eventId: string;
  author: string;
  createdAt: number;
  roomId: string;
  epoch: number;
  /** Catalog version tag value; 0 when the tag is absent (spec: default 1 -
   *  an absent tag is explicitly `catv:1`, NOT unknown). */
  catv: number;
  /** Declared role structure, in tag order (id + declared rank). */
  roles: Array<{ id: string; rank?: number }>;
  /** Declared perms per role id, in tag order (vocabulary-filtered). */
  perms: Map<string, Perm[]>;
  /** Declared members per role id, in tag order (64-hex lowercase; invalid
   *  entries are dropped, never thrown - foreign junk must not crash UIs). */
  members: Map<string, string[]>;
}

const HEX64 = /^[0-9a-f]{64}$/;

function tagValues(tags: string[][], name: string): string[][] {
  return tags.filter((t) => t[0] === name).map((t) => t.slice(1));
}

function firstTag(tags: string[][], name: string): string | null {
  const t = tags.find((row) => row[0] === name);
  return t && typeof t[1] === 'string' ? t[1] : null;
}

/** Parse a Nostr event into a RoleEdition. Returns null when the event is
 *  not a kind-3308 vsk:1 role edition at all (wrong kind / missing vsk tag /
 *  missing room tag) - callers treat null as "not our surface". */
export function parseRoleEdition(event: NostrEvent): RoleEdition | null {
  if (event.kind !== ROLE_KIND) return null;
  if (firstTag(event.tags, 'vsk') !== '1') return null;
  const roomId = firstTag(event.tags, 'room');
  if (!roomId) return null;
  const epochRaw = firstTag(event.tags, 'epoch');
  const epoch = epochRaw !== null && /^\d+$/.test(epochRaw) ? Number(epochRaw) : NaN;
  if (!Number.isSafeInteger(epoch)) return null;

  const catvRaw = firstTag(event.tags, 'catv');
  const catv = catvRaw === null ? ROLE_CATALOG_VERSION : /^\d+$/.test(catvRaw) ? Number(catvRaw) : 0;

  const roles: RoleEdition['roles'] = [];
  for (const [id, rank] of tagValues(event.tags, 'role')) {
    if (typeof id !== 'string' || !id) continue;
    const rankNum = typeof rank === 'string' && /^\d+$/.test(rank) ? Number(rank) : undefined;
    roles.push({ id, ...(rankNum !== undefined ? { rank: rankNum } : {}) });
  }

  const perms = new Map<string, Perm[]>();
  for (const [roleId, perm] of tagValues(event.tags, 'perm')) {
    if (typeof roleId !== 'string' || typeof perm !== 'string') continue;
    if (!PERM_VOCABULARY.includes(perm as Perm)) continue; // closed vocabulary
    const list = perms.get(roleId) ?? [];
    if (!list.includes(perm as Perm)) list.push(perm as Perm);
    perms.set(roleId, list);
  }

  const members = new Map<string, string[]>();
  for (const [roleId, pubkey] of tagValues(event.tags, 'member')) {
    if (typeof roleId !== 'string' || typeof pubkey !== 'string') continue;
    const pk = pubkey.toLowerCase();
    if (!HEX64.test(pk)) continue; // invalid member entries are dropped
    const list = members.get(roleId) ?? [];
    if (!list.includes(pk)) list.push(pk);
    members.set(roleId, list);
  }

  return {
    eventId: event.id,
    author: event.pubkey,
    createdAt: event.created_at,
    roomId,
    epoch,
    catv,
    roles,
    perms,
    members,
  };
}

// ─── Signer classes (spec §3, §8 D2) ──────────────────────────────────────

export type SignerClass = 'founder' | 'pin-role-holder' | 'foreign';

/** Does the top edition authorize `pubkey` to publish editions? The founder
 *  always passes; otherwise the pubkey must be a member of a role whose
 *  DECLARED perms (in the top edition) include `pin-role`. Unknown-catalog
 *  tops authorize nobody but the founder (fail-closed, D1). */
function pinRoleHolders(top: RoleEdition): Set<string> {
  const holders = new Set<string>();
  if (top.catv === 0 || !ROLE_CATALOGS.has(top.catv)) return holders; // fail closed
  for (const [roleId, members] of top.members) {
    if ((top.perms.get(roleId) ?? []).includes('pin-role')) {
      for (const pk of members) holders.add(pk);
    }
  }
  return holders;
}

/** Effective perms for `pubkey` under edition `ed` - catalog perms for known
 *  roles ∪ declared perms; unknown roles (unknown catv) enforce NOTHING. */
export function permsUnder(ed: RoleEdition, pubkey: string): Perm[] {
  if (ed.catv === 0 || !ROLE_CATALOGS.has(ed.catv)) return [];
  const out = new Set<Perm>();
  const catalog = ROLE_CATALOGS.get(ed.catv)!;
  for (const [roleId, members] of ed.members) {
    if (!members.includes(pubkey)) continue;
    const def = catalog.find((r) => r.id === roleId);
    for (const p of def?.perms ?? []) out.add(p);
    for (const p of ed.perms.get(roleId) ?? []) out.add(p);
  }
  return [...out];
}

/** Classify `event`'s signer against the room founder and the CURRENT top
 *  edition (null before any valid edition). Verifies the schnorr signature
 *  and event id client-side - a hostile relay must not be able to fabricate
 *  a roster. The shallow copy defeats nostr-tools' verified-object cache so
 *  every call re-checks (crypto.ts explicitly warns about that cache). */
export function signerClassFor(
  event: NostrEvent,
  opts: { founder: string; top: RoleEdition | null },
): SignerClass {
  const parsed = parseRoleEdition(event);
  if (!parsed) return 'foreign';
  if (!verifyEvent({ ...event })) return 'foreign';
  if (event.pubkey === opts.founder) return 'founder';
  if (!opts.top) return 'foreign'; // first edition can only come from the founder (D2)
  if (pinRoleHolders(opts.top).has(event.pubkey)) return 'pin-role-holder';
  return 'foreign';
}

/** Structure-preservation rule (spec §2, D2): a non-founder edition MUST
 *  restate the `catv` + `role` + `perm` structure verbatim - only `member`
 *  tags may differ. Founder editions may restructure freely. */
export function structureMatches(candidate: RoleEdition, top: RoleEdition): boolean {
  if (candidate.catv !== top.catv) return false;
  if (candidate.roles.length !== top.roles.length) return false;
  for (let i = 0; i < top.roles.length; i++) {
    if (candidate.roles[i].id !== top.roles[i].id) return false;
    if ((candidate.roles[i].rank ?? null) !== (top.roles[i].rank ?? null)) return false;
  }
  const permKeys = [...top.perms.keys()].sort();
  if (permKeys.length !== candidate.perms.size) return false;
  for (const roleId of permKeys) {
    const a = top.perms.get(roleId) ?? [];
    const b = candidate.perms.get(roleId) ?? [];
    if (a.length !== b.length || a.some((p, i) => b[i] !== p)) return false;
  }
  return true;
}

// ─── The fold (spec §1/§5) ────────────────────────────────────────────────

export interface AssignedRole {
  roleId: string;
  /** Catalog rank when the role is known, else the declared tag rank (may be
   *  null) - display-only. */
  rank: number | null;
  perms: readonly Perm[];
  /** False ⇒ unknown catalog version: render `?`, enforce NOTHING (D1). */
  known: boolean;
}

export interface FoldedRoles {
  /** 'none': no valid edition exists yet (everyone is a plain member).
   *  'ok': a top edition is applied. 'fork': frozen (B1 rule - never
   *  newest-wins). 'ignored-ephemeral': roles unsupported in this tier. */
  status: 'none' | 'ok' | 'fork' | 'ignored-ephemeral';
  /** The applied top edition (null when none / ignored-ephemeral; the last
   *  applied edition when frozen - rendered but marked frozen). */
  edition: RoleEdition | null;
  frozen: boolean;
  /** pubkey → resolved roles from the top edition. Members of an
   *  unknown-catalog edition still appear (known:false) so the UI can render
   *  `?` instead of silently hiding them. */
  grants: Map<string, AssignedRole[]>;
  /** True when the top edition's catv is not in this client's catalog. */
  unknownCatalog: boolean;
  /** The two conflicting edition ids when frozen. */
  forkIds: [string, string] | null;
  stats: { seen: number; valid: number; foreign: number };
}

export interface FoldInput {
  roomId: string;
  /** Current ratchet epoch - editions for other epochs are foreign (§2). */
  epoch: number;
  /** Room founder key (for provisioned rooms: `joined.governance`). */
  founder: string;
  /** Ephemeral/shielded tier ⇒ roles unsupported (§4; §7 test 5). */
  ephemeral: boolean;
}

/** Fold role editions into the room's authoritative role state.
 *
 * Walks candidates chronologically (created_at asc, event id asc as the
 * display tie-break), maintaining the evolving top:
 *   - each candidate must verify client-side and match room+epoch;
 *   - founder editions apply (restructure freely);
 *   - pin-role-holder editions apply only with the structure rule intact;
 *   - anything else is foreign and skipped, never an error;
 *   - a second VALID edition at the same created_at as the top is a FORK:
 *     the fold freezes (last applied state retained, `frozen: true`), and
 *     nothing after the fork is auto-applied.
 */
export function foldRoleEditions(events: NostrEvent[], input: FoldInput): FoldedRoles {
  const empty: FoldedRoles = {
    status: 'none',
    edition: null,
    frozen: false,
    grants: new Map(),
    unknownCatalog: false,
    forkIds: null,
    stats: { seen: 0, valid: 0, foreign: 0 },
  };
  if (input.ephemeral) return { ...empty, status: 'ignored-ephemeral' };

  // Dedupe by event id, keep the room+epoch-matching vsk:1 candidates.
  const byId = new Map<string, NostrEvent>();
  for (const event of events) {
    const parsed = parseRoleEdition(event);
    if (!parsed || parsed.roomId !== input.roomId || parsed.epoch !== input.epoch) continue;
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  const candidates = [...byId.values()].sort(
    (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  let top: RoleEdition | null = null;
  let frozen = false;
  let forkIds: [string, string] | null = null;
  let valid = 0;
  let foreign = 0;

  for (const event of candidates) {
    if (frozen) break; // nothing after a fork auto-applies (§5)
    const parsed = parseRoleEdition(event)!;
    const klass = signerClassFor(event, { founder: input.founder, top });
    if (klass === 'founder') {
      if (top && parsed.createdAt === top.createdAt) {
        frozen = true;
        forkIds = [top.eventId, parsed.eventId];
        break;
      }
      top = parsed;
      valid++;
      continue;
    }
    if (klass === 'pin-role-holder') {
      if (!top || !structureMatches(parsed, top)) {
        foreign++; // unauthorized structural change folds as foreign (§2)
        continue;
      }
      if (parsed.createdAt === top.createdAt) {
        frozen = true;
        forkIds = [top.eventId, parsed.eventId];
        break;
      }
      top = parsed;
      valid++;
      continue;
    }
    foreign++;
  }

  if (!top) return { ...empty, stats: { seen: candidates.length, valid, foreign } };

  const unknownCatalog = top.catv === 0 || !ROLE_CATALOGS.has(top.catv);
  const grants = new Map<string, AssignedRole[]>();
  const catalog = ROLE_CATALOGS.get(top.catv);
  for (const [roleId, members] of top.members) {
    const def = catalog?.find((r) => r.id === roleId) ?? null;
    const declared = top.perms.get(roleId) ?? [];
    const resolved: AssignedRole = {
      roleId,
      rank: def ? def.rank : (top.roles.find((r) => r.id === roleId)?.rank ?? null),
      // Unknown catalog ⇒ enforce NOTHING, regardless of declared perms (D1).
      perms: def ? [...new Set([...def.perms, ...declared])] : [],
      known: def !== null,
    };
    for (const pk of members) {
      const list = grants.get(pk) ?? [];
      list.push(resolved);
      grants.set(pk, list);
    }
  }

  return {
    status: frozen ? 'fork' : 'ok',
    edition: top,
    frozen,
    grants,
    unknownCatalog,
    forkIds,
    stats: { seen: candidates.length, valid, foreign },
  };
}

// ─── Enforcement helpers (spec §6) ────────────────────────────────────────

/** Every perm `pubkey` holds under the folded state. Unknown-catalog and
 *  frozen states still answer - with the perms they truthfully carry; the
 *  CALLER decides what a frozen room may do. Unknown roles contribute none. */
export function permsFor(folded: FoldedRoles, pubkey: string): Perm[] {
  if (!folded.edition) return [];
  const out = new Set<Perm>();
  for (const role of folded.grants.get(pubkey) ?? []) {
    for (const p of role.perms) out.add(p);
  }
  return [...out];
}

export function hasPerm(folded: FoldedRoles, pubkey: string, perm: Perm): boolean {
  return permsFor(folded, pubkey).includes(perm);
}

// ─── Publication (spec §2) ────────────────────────────────────────────────

export interface EditionSpec {
  roomId: string;
  epoch: number;
  catv?: number;
  /** Role structure - id + rank, in order. */
  roles: Array<{ id: string; rank: number }>;
  /** Full declared perms per role id (restated every edition). */
  perms: Array<{ roleId: string; perm: Perm }>;
  /** Full member set per role id (restated every edition; omission=deletion). */
  members: Array<{ roleId: string; pubkey: string }>;
  alt?: string;
  prev?: string;
}

export function buildRoleEditionTags(spec: EditionSpec): string[][] {
  const catv = spec.catv ?? ROLE_CATALOG_VERSION;
  const tags: string[][] = [
    ['vsk', '1'],
    ['room', spec.roomId],
    // Single-char alias: strfry only indexes 1-char tag names, so relay
    // queries run on #r (a #room filter is rejected as "unindexed tag
    // filter"). `room` stays the human/contract-visible tag.
    ['r', spec.roomId],
    ['epoch', String(spec.epoch)],
    ['catv', String(catv)],
  ];
  for (const r of spec.roles) tags.push(['role', r.id, String(r.rank)]);
  for (const p of spec.perms) tags.push(['perm', p.roleId, p.perm]);
  for (const m of spec.members) tags.push(['member', m.roleId, m.pubkey]);
  tags.push(['alt', spec.alt ?? 'role edition']);
  if (spec.prev) tags.push(['prev', spec.prev]);
  return tags;
}

/** Build + sign a role edition with `signerSecretKey`. The caller is
 *  responsible for authority - the fold, not the builder, is the gate. */
export function buildRoleEditionEvent(signerSecretKey: Uint8Array, spec: EditionSpec): NostrEvent {
  return finalizeEvent(
    { kind: ROLE_KIND, created_at: Math.floor(Date.now() / 1000), tags: buildRoleEditionTags(spec), content: '' },
    signerSecretKey,
  );
}

/** Relay filter for a room's role editions (public stored events). Queries
 *  the single-char `r` alias - see buildRoleEditionTags. */
export function roleEditionFilter(roomId: string): { kinds: number[]; '#r': string[] } {
  return { kinds: [ROLE_KIND], '#r': [roomId] };
}
