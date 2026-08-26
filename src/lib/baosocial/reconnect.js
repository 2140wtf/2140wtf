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
const DEFAULTS = { baseMs: 500, maxMs: 30_000, jitterRatio: 0.2 };
export function backoffDelayMs(attempt, opts = {}) {
    // Per-key ?? (not spread): an explicit `baseMs: undefined` must fall back,
    // not poison the arithmetic into NaN → setTimeout(NaN) hot loop.
    const baseMs = opts.baseMs ?? DEFAULTS.baseMs;
    const maxMs = opts.maxMs ?? DEFAULTS.maxMs;
    const jitterRatio = opts.jitterRatio ?? DEFAULTS.jitterRatio;
    const rng = opts.rng;
    const capped = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
    const jitter = 1 + jitterRatio * (2 * (rng ?? Math.random)() - 1);
    return Math.max(0, Math.round(capped * jitter));
}
export function createLadder(opts = {}) {
    const { maxAttempts = Number.POSITIVE_INFINITY, ...backoff } = opts;
    let attempts = 0;
    return {
        get attempts() {
            return attempts;
        },
        next() {
            if (attempts >= maxAttempts)
                return null;
            return backoffDelayMs(attempts++, backoff);
        },
        reset() {
            attempts = 0;
        },
    };
}
/** Env → options. Invalid/absent values silently fall back to defaults. */
export function reconnectOptsFromEnv(env, prefix = 'BAO_RECONNECT') {
    const num = (name) => {
        const raw = env[`${prefix}_${name}`];
        if (raw === undefined || raw === '')
            return undefined;
        const v = Number(raw);
        return Number.isFinite(v) && v >= 0 ? v : undefined;
    };
    const out = {};
    const baseMs = num('BASE_MS');
    const maxMs = num('MAX_MS');
    const jitterRatio = num('JITTER');
    if (baseMs !== undefined && baseMs > 0)
        out.baseMs = baseMs;
    if (maxMs !== undefined && maxMs > 0)
        out.maxMs = maxMs;
    if (jitterRatio !== undefined && jitterRatio >= 0 && jitterRatio <= 1)
        out.jitterRatio = jitterRatio;
    const maxAttempts = num('MAX_ATTEMPTS');
    if (maxAttempts !== undefined && maxAttempts > 0)
        out.maxAttempts = Math.floor(maxAttempts);
    return out;
}
