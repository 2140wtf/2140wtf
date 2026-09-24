/**
 * reconnect — pure backoff scheduling for relay connections (P3).
 *
 * No I/O by design (route.go discipline): the decision is exhaustively
 * testable and readable in one sitting; dialing stays in WsRelayConn.
 *
 * Ladder semantics (expert-reviewed):
 *   delay(n) = clamp(baseMs * 2^n, maxMs) scaled by uniform jitter
 *   ±jitterRatio — a fleet of daemons must not stampede a recovering relay
 *   in lockstep. Exhaustion returns null: callers either keep retrying
 *   forever (CLI default, maxAttempts=Infinity) or go loud and die for
 *   their supervisor (daemons).
 */
export interface BackoffOptions {
    /** Delay before the first retry. Default 500ms. */
    baseMs?: number;
    /** Ceiling. Default 30_000ms. */
    maxMs?: number;
    /** Uniform ± fraction applied AFTER clamping. Default 0.2. */
    jitterRatio?: number;
    /** Uniform [0,1) source — injectable for deterministic tests. */
    rng?: () => number;
}
export interface LadderOptions extends BackoffOptions {
    /** Retry budget. Default Infinity (never give up — CLI posture). */
    maxAttempts?: number;
}
export declare function backoffDelayMs(attempt: number, opts?: BackoffOptions): number;
export interface ReconnectLadder {
    /** Milliseconds to wait before attempt `n`, or null when exhausted. */
    next(): number | null;
    /** Success — forget every failed attempt. */
    reset(): void;
    readonly attempts: number;
}
export declare function createLadder(opts?: LadderOptions): ReconnectLadder;
/** Env → options. Invalid/absent values silently fall back to defaults. */
export declare function reconnectOptsFromEnv(env: NodeJS.ProcessEnv, prefix?: string): LadderOptions;
