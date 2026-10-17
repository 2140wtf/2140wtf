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
import { type Clock, type Rng } from './crypto.js';
export declare const DM_CALL_TAG = "bao-call-v1";
export declare const DM_CALL_OPS: readonly ["offer", "accept", "decline", "busy", "end"];
export type DmCallOp = (typeof DM_CALL_OPS)[number];
/** Outer bounds a signal may claim (defensive parse caps). */
export declare const DM_CALL_MAX_TTL_SEC = 3600;
export interface DmCallSignal {
    v: 1;
    t: typeof DM_CALL_TAG;
    op: DmCallOp;
    callId: string;
    iat: number;
    exp: number;
    rn: string;
}
/** Mint a caller-side call id (16 random bytes, hex). */
export declare function newCallId(rng?: Rng): string;
export interface BuildCallSignalOptions {
    callId: string;
    /** Defaults to the clock's now. */
    iat?: number;
    /** Validity window in seconds (default 120; capped at 1 h). */
    ttlSec?: number;
    /** Ring nonce; default '' (no ring correlation). */
    rn?: string;
    clock?: Clock;
}
export declare function buildCallSignal(op: DmCallOp, opts: BuildCallSignalOptions): DmCallSignal;
/**
 * Strict parse for payloads arriving over the DM lane. Returns null when any
 * KNOWN field deviates (wrong version/tag/op, malformed ids, out-of-range
 * times) — signaling is untrusted content until proven. Unknown extra fields
 * are dropped, never echoed into the result (the parser is the only source
 * of typed signal objects downstream).
 */
export declare function parseCallSignal(payload: unknown): DmCallSignal | null;
/** ADR: expired signals are dropped with no side effects. */
export declare function isCallSignalExpired(signal: Pick<DmCallSignal, 'exp'>, clock?: Clock): boolean;
