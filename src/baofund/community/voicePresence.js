/**
 * voicePresence — real-time voice call presence (ADR-voice-invisible-rooms
 * v10.2 §4.1; NO kind/envelope/segment change).
 *
 * A voice presence signal is an ORDINARY ephemeral envelope whose payload is
 * `{ v:1, type:'voice-presence', op:'joined'|'left'|'heartbeat', identity,
 * ms, ... }`. It rides the room's encrypted ephemeral stream like every §7
 * structure — the relay learns nothing new (same kind, same routing tag, same
 * padding bucket).
 *
 * It is a roster/display signal ONLY: it never grants a media key, and clients
 * MUST exclude it from conversation views (aggregate timeline, unread counts,
 * previews) — see aggregate.ts / unread.ts / peek.ts.
 *
 *  - `identity`: broker-issued opaque value, lowercase hex, >= 16 bytes.
 *  - `ms`: sender-declared clock for display/ordering hints. Fold order is
 *    receive order and staleness is measured from local receipt, so `ms` is
 *    never the authority (ADR §4.1).
 *  - `muted`/`publishing`: meaningful on joined/heartbeat, self-reported.
 *  - `hand`: reserved for the post-pilot hand-raise UI; ignored by the pilot.
 */
const MAX_VOICE_PRESENCE_BYTES = 512;
const IDENTITY_RE = /^(?:[0-9a-f]{2}){16,}$/;
const OPTIONAL_BOOLEAN_FIELDS = ['hand', 'muted', 'publishing'];
export const VOICE_PRESENCE_TYPE = 'voice-presence';
export const VOICE_PRESENCE_OPS = ['joined', 'left', 'heartbeat'];
function assertIdentity(identity) {
    if (typeof identity !== 'string' || !IDENTITY_RE.test(identity)) {
        throw new Error('identity must be lowercase hex of at least 16 bytes');
    }
}
/** Build a voice-presence payload (encrypted in-envelope). Strict on input. */
export function buildVoicePresence(input) {
    if (!VOICE_PRESENCE_OPS.includes(input.op)) {
        throw new Error(`op must be one of ${VOICE_PRESENCE_OPS.join('|')}`);
    }
    assertIdentity(input.identity);
    const ms = input.ms ?? Date.now();
    if (!Number.isSafeInteger(ms) || ms < 0)
        throw new Error('ms must be a non-negative safe integer');
    for (const field of OPTIONAL_BOOLEAN_FIELDS) {
        if (input[field] !== undefined && typeof input[field] !== 'boolean') {
            throw new Error(`${field} must be boolean`);
        }
    }
    return {
        v: 1,
        type: VOICE_PRESENCE_TYPE,
        op: input.op,
        identity: input.identity,
        ms,
        ...(input.hand !== undefined ? { hand: input.hand } : {}),
        ...(input.muted !== undefined ? { muted: input.muted } : {}),
        ...(input.publishing !== undefined ? { publishing: input.publishing } : {}),
    };
}
/** Parse a voice-presence payload, or null when the payload is not one. */
export function parseVoicePresence(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const o = payload;
    if (o.type !== VOICE_PRESENCE_TYPE || o.v !== 1)
        return null;
    if (typeof o.op !== 'string' || !VOICE_PRESENCE_OPS.includes(o.op))
        return null;
    if (typeof o.identity !== 'string' || !IDENTITY_RE.test(o.identity))
        return null;
    if (typeof o.ms !== 'number' || !Number.isSafeInteger(o.ms) || o.ms < 0)
        return null;
    if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_VOICE_PRESENCE_BYTES)
        return null;
    const out = {
        v: 1,
        type: VOICE_PRESENCE_TYPE,
        op: o.op,
        identity: o.identity,
        ms: o.ms,
    };
    for (const field of OPTIONAL_BOOLEAN_FIELDS) {
        const value = o[field];
        if (value !== undefined) {
            if (typeof value !== 'boolean')
                return null;
            out[field] = value;
        }
    }
    return out;
}
