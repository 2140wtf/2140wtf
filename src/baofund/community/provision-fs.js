/**
 * Provision FS — rooms-file I/O (node:fs, node:crypto, node:path).
 *
 * This module has node:fs + node:crypto + node:path imports — it should NOT
 * be imported by browser bundles. Only daemons and server-side code use it.
 *
 * Browser-safe code imports from provision-core.ts instead.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { retentionSpec, parseRetention } from './provision-core.js';
/** Atomically upsert room(s) into a rooms file: tmp + rename so a
 *  hot-reloading daemon never reads a torn file. Existing rooms with the
 *  same roomId are replaced (not duplicated); unknown app fields on existing
 *  entries survive; retention is serialized to the daemon string form. */
export function writeRoomsFile(file, entryOrEntries) {
    const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
    const existing = existsSync(file) ? readRoomsFile(file) : [];
    const kept = new Map(existing.map((r) => [r.roomId, r]));
    for (const e of entries) {
        kept.set(e.roomId, {
            ...(kept.get(e.roomId) ?? {}), // preserve unknown app fields
            ...e,
            retention: retentionSpec(e.retention), // daemon string form on disk
        });
    }
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    // Re-serialize retention to the daemon string form for EVERY room being
    // written — readRoomsFile normalizes to objects on read and a naive
    // rewrite would corrupt pre-existing entries for the daemons.
    const rooms = [...kept.values()].map((r) => ({
        ...r,
        retention: retentionSpec(parseRetention(r.retention)),
    }));
    writeFileSync(tmp, JSON.stringify({ rooms }, null, 2));
    renameSync(tmp, file);
}
/** Tolerant read: missing file → []; structurally invalid file
 *  (not { rooms: [...] }) throws — callers decide keep-current vs fail,
 *  exactly like the daemons' reconcile loop; a single bad/foreign entry is
 *  skipped, never fatal. Retention is normalized to object form. */
export function readRoomsFile(file) {
    if (!existsSync(file))
        return [];
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.rooms))
        throw new Error('rooms file must be { rooms: [...] }');
    const out = [];
    for (const raw of parsed.rooms) {
        const room = raw;
        try {
            if (typeof room.roomId !== 'string' || room.roomId.length === 0)
                throw new Error('missing roomId');
            if (typeof room.routingId !== 'string')
                throw new Error('missing routingId');
            if (typeof room.encKey !== 'string')
                throw new Error('missing encKey');
            out.push({
                ...room,
                retention: parseRetention(room.retention),
                scribes: Array.isArray(room.scribes) ? room.scribes : [],
            });
        }
        catch (err) {
            // One foreign entry never kills a consumer (per-room try/catch).
            continue;
        }
    }
    return out;
}
