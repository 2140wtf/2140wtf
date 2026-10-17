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
import { finalizeEvent, verifyEvent, } from './crypto.js';
import { parseBanEdition } from './banEditions.js';
// ─── Catalog (spec §8 D1) ─────────────────────────────────────────────────
export const ROLE_KIND = 3308;
export const ROLE_CATALOG_VERSION = 1;
/**
 * Bound on a per-room raw control-edition cache (vsk:1 roles + vsk:4 bans
 * share kind 3308). Any relay writer can publish a 3308 addressed to a known
 * room id, so an unbounded re-fold input is a memory/CPU DoS; caches keep
 * only the newest `MAX_CONTROL_EVENTS`, and the folds remain the authority
 * gate (a dropped old edition can only be re-read from the relay).
 */
export const MAX_CONTROL_EVENTS = 200;
/**
 * Cheap pre-cache filter: true when `event` is a structurally valid, SIGNED
 * control edition (vsk:1 role or vsk:4 ban) addressed to `roomId` at `epoch`.
 * The fold still applies every authority rule; this keeps foreign, malformed
 * or unsigned 3308 junk out of the per-room cache and the O(n) re-fold.
 */
export function isControlEditionForRoom(event, roomId, epoch) {
    const parsed = parseRoleEdition(event) ?? parseBanEdition(event);
    if (!parsed || parsed.roomId !== roomId || parsed.epoch !== epoch)
        return false;
    try {
        return verifyEvent({ ...event });
    }
    catch {
        return false;
    }
}
/**
 * Bounded, id-deduped merge for a per-room control-edition cache. Pure so the
 * bound/dedupe rules are testable once and shared by the browser hook and the
 * daemon fold input:
 *   - incoming order is preserved (fold input stays chronological);
 *   - empty/duplicate ids are skipped;
 *   - only the newest `max` entries are retained, and the id set is rebuilt
 *     from the retained window - neither structure can grow without bound
 *     (a flood of unique ids must not grow the SET either).
 */
export function mergeControlEventCache(current, ids, incoming, max = MAX_CONTROL_EVENTS) {
    let events = [...current];
    const nextIds = new Set(ids);
    for (const event of incoming) {
        if (typeof event?.id !== 'string' || event.id.length === 0 || nextIds.has(event.id))
            continue;
        nextIds.add(event.id);
        events.push(event);
    }
    if (events.length > max) {
        events = events.slice(events.length - max);
        return { events, ids: new Set(events.map((e) => e.id)) };
    }
    return { events, ids: nextIds };
}
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
];
/** The `catv:1` catalog. Only the founder holds `pin-role` by default; it
 *  may be granted via an edition's perm tags (spec §8 D1). Dropping a member
 *  or perm = omit it from the next full restatement - there is deliberately
 *  no delete tag (omission is deletion). */
export const ROLE_CATALOG_V1 = [
    { id: 'moderator', rank: 1, perms: ['pin', 'kick', 'ban', 'delete-message', 'role-grant'] },
    { id: 'curator', rank: 2, perms: ['pin', 'delete-message'] },
    { id: 'greeter', rank: 3, perms: [] },
];
export const ROLE_CATALOGS = new Map([
    [ROLE_CATALOG_VERSION, ROLE_CATALOG_V1],
]);
export function roleDef(catv, roleId) {
    return ROLE_CATALOGS.get(catv)?.find((r) => r.id === roleId) ?? null;
}
const HEX64 = /^[0-9a-f]{64}$/;
function tagValues(tags, name) {
    return tags.filter((t) => t[0] === name).map((t) => t.slice(1));
}
function firstTag(tags, name) {
    const t = tags.find((row) => row[0] === name);
    return t && typeof t[1] === 'string' ? t[1] : null;
}
/** Parse a Nostr event into a RoleEdition. Returns null when the event is
 *  not a kind-3308 vsk:1 role edition at all (wrong kind / missing vsk tag /
 *  missing room tag) - callers treat null as "not our surface". */
export function parseRoleEdition(event) {
    if (event.kind !== ROLE_KIND)
        return null;
    if (firstTag(event.tags, 'vsk') !== '1')
        return null;
    const roomId = firstTag(event.tags, 'room');
    if (!roomId)
        return null;
    const epochRaw = firstTag(event.tags, 'epoch');
    const epoch = epochRaw !== null && /^\d+$/.test(epochRaw) ? Number(epochRaw) : NaN;
    if (!Number.isSafeInteger(epoch))
        return null;
    const catvRaw = firstTag(event.tags, 'catv');
    const catv = catvRaw === null ? ROLE_CATALOG_VERSION : /^\d+$/.test(catvRaw) ? Number(catvRaw) : 0;
    const roles = [];
    for (const [id, rank] of tagValues(event.tags, 'role')) {
        if (typeof id !== 'string' || !id)
            continue;
        const rankNum = typeof rank === 'string' && /^\d+$/.test(rank) ? Number(rank) : undefined;
        roles.push({ id, ...(rankNum !== undefined ? { rank: rankNum } : {}) });
    }
    const perms = new Map();
    for (const [roleId, perm] of tagValues(event.tags, 'perm')) {
        if (typeof roleId !== 'string' || typeof perm !== 'string')
            continue;
        if (!PERM_VOCABULARY.includes(perm))
            continue; // closed vocabulary
        const list = perms.get(roleId) ?? [];
        if (!list.includes(perm))
            list.push(perm);
        perms.set(roleId, list);
    }
    const members = new Map();
    for (const [roleId, pubkey] of tagValues(event.tags, 'member')) {
        if (typeof roleId !== 'string' || typeof pubkey !== 'string')
            continue;
        const pk = pubkey.toLowerCase();
        if (!HEX64.test(pk))
            continue; // invalid member entries are dropped
        const list = members.get(roleId) ?? [];
        if (!list.includes(pk))
            list.push(pk);
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
/** Does the top edition authorize `pubkey` to publish editions? The founder
 *  always passes; otherwise the pubkey must be a member of a role whose
 *  DECLARED perms (in the top edition) include `pin-role`. Unknown-catalog
 *  tops authorize nobody but the founder (fail-closed, D1). */
function pinRoleHolders(top) {
    const holders = new Set();
    if (top.catv === 0 || !ROLE_CATALOGS.has(top.catv))
        return holders; // fail closed
    for (const [roleId, members] of top.members) {
        if ((top.perms.get(roleId) ?? []).includes('pin-role')) {
            for (const pk of members)
                holders.add(pk);
        }
    }
    return holders;
}
/** Effective perms for `pubkey` under edition `ed` - catalog perms for known
 *  roles ∪ declared perms; unknown roles (unknown catv) enforce NOTHING. */
export function permsUnder(ed, pubkey) {
    if (ed.catv === 0 || !ROLE_CATALOGS.has(ed.catv))
        return [];
    const out = new Set();
    const catalog = ROLE_CATALOGS.get(ed.catv);
    for (const [roleId, members] of ed.members) {
        if (!members.includes(pubkey))
            continue;
        const def = catalog.find((r) => r.id === roleId);
        for (const p of def?.perms ?? [])
            out.add(p);
        for (const p of ed.perms.get(roleId) ?? [])
            out.add(p);
    }
    return [...out];
}
/** Classify `event`'s signer against the room founder and the CURRENT top
 *  edition (null before any valid edition). Verifies the schnorr signature
 *  and event id client-side - a hostile relay must not be able to fabricate
 *  a roster. The shallow copy defeats nostr-tools' verified-object cache so
 *  every call re-checks (crypto.ts explicitly warns about that cache). */
export function signerClassFor(event, opts) {
    const parsed = parseRoleEdition(event);
    if (!parsed)
        return 'foreign';
    if (!verifyEvent({ ...event }))
        return 'foreign';
    if (event.pubkey === opts.founder)
        return 'founder';
    if (!opts.top)
        return 'foreign'; // first edition can only come from the founder (D2)
    if (pinRoleHolders(opts.top).has(event.pubkey))
        return 'pin-role-holder';
    return 'foreign';
}
/** Structure-preservation rule (spec §2, D2): a non-founder edition MUST
 *  restate the `catv` + `role` + `perm` structure verbatim - only `member`
 *  tags may differ. Founder editions may restructure freely. */
export function structureMatches(candidate, top) {
    if (candidate.catv !== top.catv)
        return false;
    if (candidate.roles.length !== top.roles.length)
        return false;
    for (let i = 0; i < top.roles.length; i++) {
        if (candidate.roles[i].id !== top.roles[i].id)
            return false;
        if ((candidate.roles[i].rank ?? null) !== (top.roles[i].rank ?? null))
            return false;
    }
    const permKeys = [...top.perms.keys()].sort();
    if (permKeys.length !== candidate.perms.size)
        return false;
    for (const roleId of permKeys) {
        const a = top.perms.get(roleId) ?? [];
        const b = candidate.perms.get(roleId) ?? [];
        if (a.length !== b.length || a.some((p, i) => b[i] !== p))
            return false;
    }
    return true;
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
export function foldRoleEditions(events, input) {
    const empty = {
        status: 'none',
        edition: null,
        frozen: false,
        grants: new Map(),
        unknownCatalog: false,
        forkIds: null,
        stats: { seen: 0, valid: 0, foreign: 0 },
    };
    if (input.ephemeral)
        return { ...empty, status: 'ignored-ephemeral' };
    // Dedupe by event id, keep the room+epoch-matching vsk:1 candidates.
    const byId = new Map();
    for (const event of events) {
        const parsed = parseRoleEdition(event);
        if (!parsed || parsed.roomId !== input.roomId || parsed.epoch !== input.epoch)
            continue;
        if (!byId.has(event.id))
            byId.set(event.id, event);
    }
    const candidates = [...byId.values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let top = null;
    let frozen = false;
    let forkIds = null;
    let valid = 0;
    let foreign = 0;
    for (const event of candidates) {
        if (frozen)
            break; // nothing after a fork auto-applies (§5)
        const parsed = parseRoleEdition(event);
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
    if (!top)
        return { ...empty, stats: { seen: candidates.length, valid, foreign } };
    const unknownCatalog = top.catv === 0 || !ROLE_CATALOGS.has(top.catv);
    const grants = new Map();
    const catalog = ROLE_CATALOGS.get(top.catv);
    for (const [roleId, members] of top.members) {
        const def = catalog?.find((r) => r.id === roleId) ?? null;
        const declared = top.perms.get(roleId) ?? [];
        const resolved = {
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
export function permsFor(folded, pubkey) {
    if (!folded.edition)
        return [];
    const out = new Set();
    for (const role of folded.grants.get(pubkey) ?? []) {
        for (const p of role.perms)
            out.add(p);
    }
    return [...out];
}
export function hasPerm(folded, pubkey, perm) {
    return permsFor(folded, pubkey).includes(perm);
}
export function buildRoleEditionTags(spec) {
    const catv = spec.catv ?? ROLE_CATALOG_VERSION;
    const tags = [
        ['vsk', '1'],
        ['room', spec.roomId],
        // Single-char alias: strfry only indexes 1-char tag names, so relay
        // queries run on #r (a #room filter is rejected as "unindexed tag
        // filter"). `room` stays the human/contract-visible tag.
        ['r', spec.roomId],
        ['epoch', String(spec.epoch)],
        ['catv', String(catv)],
    ];
    for (const r of spec.roles)
        tags.push(['role', r.id, String(r.rank)]);
    for (const p of spec.perms)
        tags.push(['perm', p.roleId, p.perm]);
    for (const m of spec.members)
        tags.push(['member', m.roleId, m.pubkey]);
    tags.push(['alt', spec.alt ?? 'role edition']);
    if (spec.prev)
        tags.push(['prev', spec.prev]);
    return tags;
}
/** Build + sign a role edition with `signerSecretKey`. The caller is
 *  responsible for authority - the fold, not the builder, is the gate. */
export function buildRoleEditionEvent(signerSecretKey, spec) {
    return finalizeEvent({ kind: ROLE_KIND, created_at: Math.floor(Date.now() / 1000), tags: buildRoleEditionTags(spec), content: '' }, signerSecretKey);
}
/** Relay filter for a room's role editions (public stored events). Queries
 *  the single-char `r` alias - see buildRoleEditionTags. */
export function roleEditionFilter(roomId) {
    return { kinds: [ROLE_KIND], '#r': [roomId] };
}
