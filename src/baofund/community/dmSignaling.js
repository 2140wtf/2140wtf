/**
 * dmSignaling — 1:1 call signaling payloads riding the DM lane.
 *
 * ADR (ADR-dm-calls.md § Proposed shape 1-2): call-offer / accept / decline /
 * busy / end are ordinary DM payloads on the SAME NIP-17 lane (no new public
 * kind). Payload shape, padded by the lane:
 *
 *   { v: 1, t: 'bao-call-v1', op, callId, iat, exp, rn }
 *
 *   - callId: caller-minted 32-hex (16 random bytes); the transcript-binding
 *     `callNonceHex` (ADR §2) is derived from the same mint.
 *   - iat/exp: signal validity (exp - iat bounded); the recipient drops
 *     expired signals without side effects.
 *   - rn: opaque ring nonce forwarded verbatim (ring/answer correlation).
 *
 * The schema is strict on the way IN (parseCallSignal returns null on any
 * deviation — hostile room/DM content is untrusted data) and normal on the
 * way OUT (buildCallSignal validates the caller's own inputs loudly).
 */
import { bytesToHex, defaultRng, systemClock } from './crypto.js';
export const DM_CALL_TAG = 'bao-call-v1';
export const DM_CALL_OPS = ['offer', 'accept', 'decline', 'busy', 'end'];
/** Outer bounds a signal may claim (defensive parse caps). */
export const DM_CALL_MAX_TTL_SEC = 3600;
const CALL_ID_RE = /^[0-9a-f]{32}$/;
const RN_RE = /^[0-9a-zA-Z_-]{0,64}$/;
/** Mint a caller-side call id (16 random bytes, hex). */
export function newCallId(rng = defaultRng) {
    return bytesToHex(rng(16));
}
export function buildCallSignal(op, opts) {
    if (!DM_CALL_OPS.includes(op))
        throw new Error(`dmSignaling: unknown op ${String(op)}`);
    if (!CALL_ID_RE.test(opts.callId))
        throw new Error('dmSignaling: callId must be 32 hex chars');
    const rn = opts.rn ?? '';
    if (!RN_RE.test(rn))
        throw new Error('dmSignaling: rn must be 0..64 of [0-9a-zA-Z_-]');
    const ttl = opts.ttlSec ?? 120;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > DM_CALL_MAX_TTL_SEC) {
        throw new Error(`dmSignaling: ttlSec must be an integer 1..${DM_CALL_MAX_TTL_SEC}`);
    }
    const now = (opts.clock ?? systemClock).nowSec();
    const iat = opts.iat ?? now;
    if (!Number.isSafeInteger(iat) || iat <= 0)
        throw new Error('dmSignaling: iat must be a positive integer');
    return { v: 1, t: DM_CALL_TAG, op, callId: opts.callId, iat, exp: iat + ttl, rn };
}
/**
 * Strict parse for payloads arriving over the DM lane. Returns null when any
 * KNOWN field deviates (wrong version/tag/op, malformed ids, out-of-range
 * times) — signaling is untrusted content until proven. Unknown extra fields
 * are dropped, never echoed into the result (the parser is the only source
 * of typed signal objects downstream).
 */
export function parseCallSignal(payload) {
    if (typeof payload !== 'object' || payload === null)
        return null;
    const p = payload;
    if (p.v !== 1 || p.t !== DM_CALL_TAG)
        return null;
    if (typeof p.op !== 'string' || !DM_CALL_OPS.includes(p.op))
        return null;
    if (typeof p.callId !== 'string' || !CALL_ID_RE.test(p.callId))
        return null;
    if (typeof p.iat !== 'number' || !Number.isSafeInteger(p.iat) || p.iat <= 0)
        return null;
    if (typeof p.exp !== 'number' || !Number.isSafeInteger(p.exp) || p.exp <= p.iat)
        return null;
    if (p.exp - p.iat > DM_CALL_MAX_TTL_SEC)
        return null;
    if (typeof p.rn !== 'string' || !RN_RE.test(p.rn))
        return null;
    return { v: 1, t: DM_CALL_TAG, op: p.op, callId: p.callId, iat: p.iat, exp: p.exp, rn: p.rn };
}
/** ADR: expired signals are dropped with no side effects. */
export function isCallSignalExpired(signal, clock = systemClock) {
    return signal.exp < clock.nowSec();
}
