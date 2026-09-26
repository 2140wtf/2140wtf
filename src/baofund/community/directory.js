/**
 * directory — PUBLIC room discovery (plan-unified-hardening-adoption P6b).
 *
 * Design (expert-reviewed, v3):
 *  - ONE stable per-deployment DIRECTORY key: HKDF(master,'bao/role/directory')
 *    — per-room governance keys are random-per-mint and would make rows
 *    unqueryable. Authorization = AUTHORSHIP: the event's pubkey IS the
 *    directory key; strfry verifies the signature like any event. No
 *    payload-embedded second signatures — relays cannot enforce them.
 *  - Kind 39000, parameterized-replaceable, `d = bao-room:<roomId>`.
 *    Clients subscribe { kinds:[39000], authors:[<directoryPub>] } knowing
 *    only the relay URL. Interop note: 39000 collides with NIP-29 group
 *    metadata range — BAO rooms are NOT NIP-29 groups; NIP-29-enforcing
 *    deployments must exempt this kind (spec §11 amendment).
 *  - ALL metadata rides in TAGS; content stays EMPTY. Tags are not payload
 *    shapes ⇒ zero wire-amendment surface under the byte-identical rule,
 *    and relay filters can match name/topic/policy directly.
 *  - Privacy: PUBLIC rooms only, ever. A private room must never appear in
 *    a directory row — its existence is not public information.
 *  - Lifecycle: upsert replaces by (author,d); close = kind-5 delete naming
 *    the row id; rows carry an ~30d expiration lease (NIP-40) refreshed by
 *    a fixed-interval heartbeat so abandoned deployments self-purge where
 *    the relay enforces expiry. Fixed cadence also kills update-timing oracles.
 */
import { ROOM_META } from './kinds.js';
import { deriveRoomRoleKey, getPublicKey, finalizeEvent } from './crypto.js';
export const ROOM_DIR_D_PREFIX = 'bao-room:';
/** Default lease before a directory row expires without a heartbeat. */
export const DIRECTORY_LEASE_SECS = 30 * 24 * 3600;
export function deriveDirectoryPubkey(master) {
    return getPublicKey(deriveRoomRoleKey(master, 'directory', 'deployment'));
}
function leaseTag(nowSec, leaseSecs) {
    return ['expiration', String(nowSec + leaseSecs)];
}
/** Validate + normalize operator-supplied metadata BEFORE it becomes wire material. */
function assertMetadata(room) {
    // Provision mints 16-hex roomIds (provision.ts:193); accept any bounded
    // hex id so every REAL room qualifies — but nothing looser.
    if (!/^[0-9a-f]{8,64}$/.test(room.roomId))
        throw new Error('directory: bad roomId');
    const name = room.name?.trim() ?? '';
    if (name.length < 1 || name.length > 80)
        throw new Error('directory: name must be 1–80 chars');
    if (room.topic !== undefined && String(room.topic).length > 200)
        throw new Error('directory: topic too long');
    if (!['open', 'cap-pow', 'invite'].includes(room.policy))
        throw new Error('directory: bad policy');
}
/**
 * Author the upsert event AS the deployment directory key. Signed by that
 * key alone — verifier checks authorship, nothing embedded.
 */
export function buildRoomDirectoryEvent(directorySecretKey, room, opts = {}) {
    assertMetadata(room);
    const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
    const tags = [
        ['d', ROOM_DIR_D_PREFIX + room.roomId],
        ['name', room.name.trim()],
        ['policy', room.policy],
        ...(room.topic !== undefined && room.topic !== '' ? [['topic', String(room.topic).trim()]] : []),
        leaseTag(nowSec, opts.leaseSecs ?? DIRECTORY_LEASE_SECS),
        ...(opts.replaceId ? [['e', opts.replaceId, '', 'replace']] : []),
    ];
    const template = { kind: ROOM_META, created_at: nowSec, tags, content: '' };
    return finalizeEvent(template, directorySecretKey);
}
/** Kind-5 tombstone closing a room's directory row. */
export function buildRoomDirectoryDelete(directorySecretKey, rowEventId, opts = {}) {
    return finalizeEvent({ kind: 5, created_at: opts.nowSec ?? Math.floor(Date.now() / 1000), tags: [['e', rowEventId]], content: 'room closed' }, directorySecretKey);
}
/**
 * Structural validation ONLY (shape, d-prefix, policy vocabulary).
 * Authorship is enforced by the caller's subscription filter AND by
 * foldDirectory when an expected author is pinned.
 */
export function parseRoomDirectoryEvent(ev) {
    if (ev.kind !== ROOM_META)
        return { ok: false, reason: 'not kind 39000' };
    if (ev.content !== '')
        return { ok: false, reason: 'directory rows carry no content' };
    const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? '';
    if (!d.startsWith(ROOM_DIR_D_PREFIX))
        return { ok: false, reason: 'd-tag lacks bao-room: prefix' };
    const roomId = d.slice(ROOM_DIR_D_PREFIX.length);
    if (!/^[0-9a-f]{8,64}$/.test(roomId))
        return { ok: false, reason: 'bad roomId in d-tag' };
    const name = ev.tags.find((t) => t[0] === 'name')?.[1] ?? '';
    if (name.length < 1 || name.length > 80)
        return { ok: false, reason: 'bad name' };
    const policyRaw = ev.tags.find((t) => t[0] === 'policy')?.[1] ?? '';
    if (!['open', 'cap-pow', 'invite'].includes(policyRaw))
        return { ok: false, reason: 'bad policy' };
    const topic = ev.tags.find((t) => t[0] === 'topic')?.[1];
    const expRaw = ev.tags.find((t) => t[0] === 'expiration')?.[1];
    const expiresAt = expRaw !== undefined && /^\d+$/.test(expRaw) ? Number(expRaw) : 0;
    return {
        ok: true,
        entry: { roomId, name, topic: topic || undefined, policy: policyRaw, eventId: ev.id, createdAt: ev.created_at, expiresAt },
    };
}
/**
 * Fold raw relay events into the current directory view.
 *
 * Rule 4 semantics: latest-state-wins per roomId by (created_at,id) —
 * arrival order never matters. Deletes (kind 5 authored by the SAME
 * directory key, e-tagging the row id) remove rows. Expired leases are
 * filtered when nowSec is provided (callers SHOULD pass it; relays that
 * enforce NIP-40 do this server-side, others need the client check).
 *
 * expectedAuthor pins single-deployment trust: rows authored by anything
 * else are rejected (forged/cross-posted), never folded.
 */
export function foldDirectory(events, opts = {}) {
    const expected = opts.expectedAuthor?.toLowerCase();
    const byId = new Map();
    for (const ev of events) {
        if (expected && ev.pubkey.toLowerCase() !== expected)
            continue;
        if (ev.kind === ROOM_META && !byId.has(ev.id))
            byId.set(ev.id, ev);
    }
    // Deletions: kind-5 by the same author e-tagging row ids.
    const deleted = new Set();
    for (const ev of events) {
        if (ev.kind !== 5)
            continue;
        if (expected && ev.pubkey.toLowerCase() !== expected)
            continue;
        for (const t of ev.tags)
            if (t[0] === 'e' && t[1])
                deleted.add(t[1]);
    }
    const latest = new Map();
    for (const ev of byId.values()) {
        if (deleted.has(ev.id))
            continue;
        const parsed = parseRoomDirectoryEvent(ev);
        if (!parsed.ok)
            continue;
        const prev = latest.get(parsed.entry.roomId);
        if (!prev) {
            latest.set(parsed.entry.roomId, { entry: parsed.entry, ev });
            continue;
        }
        const newer = ev.created_at > prev.ev.created_at || (ev.created_at === prev.ev.created_at && ev.id > prev.ev.id);
        if (newer)
            latest.set(parsed.entry.roomId, { entry: parsed.entry, ev });
    }
    const out = new Map();
    for (const [roomId, { entry }] of latest) {
        if (opts.nowSec !== undefined && entry.expiresAt !== 0 && entry.expiresAt <= opts.nowSec)
            continue;
        out.set(roomId, entry);
    }
    return out;
}
/** Hex convenience re-export guard (keeps import list honest for callers). */
