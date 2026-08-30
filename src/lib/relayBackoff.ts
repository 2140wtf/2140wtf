/**
 * Per-relay exponential backoff for reconnect storms (#flapping-relay).
 *
 * Root cause of the old uncapped loop: NRelay1's default reconnect strategy is
 * `new ExponentialBackoff(1000)` with NO cap, and — worse — that instance is
 * created FRESH inside `createSocket()` every time NRelay1 rebuilds its socket.
 * NRelay1 rebuilds sockets routinely (`send()` → `wake()` after the 30s idle
 * timer closed the previous one), so the doubling sequence kept restarting and
 * a hard-down relay (e.g. wss://relay.snort.social/ returning HTTP 503 on the
 * WebSocket upgrade) was retried every ~5–10s for the entire session.
 *
 * The fix works because `NRelay1.createSocket()` reuses `opts.backoff` — the
 * SAME instance — across socket recreations. A stateful instance therefore
 * accumulates CONSECUTIVE failures across reconnects, while websocket-ts calls
 * `reset()` on every successful (re)open, restoring the fast path. Handshake
 * failures (HTTP 503/4xx on upgrade, WebSocket error before open) surface to
 * websocket-ts as a `close` without a prior `open`, which is exactly the
 * "failure event" that advances the backoff.
 *
 * The class structurally implements websocket-ts's `Backoff` interface
 * (`{ retries, current, next(), reset() }`) so it can be passed straight into
 * `NRelay1Opts.backoff`. The interface is re-declared here instead of imported
 * because `websocket-ts` is a transitive dependency, not a direct one.
 */

/**
 * Delay before the first few retries: matches the interval the old loop
 * actually ran at, so a relay that fails ONCE (or twice) still reconnects
 * quickly — the fast path is only left after repeated CONSECUTIVE failures.
 */
export const RELAY_RETRY_BASE_MS = 5_000;

/** Consecutive failures allowed on the fast path before doubling kicks in. */
export const RELAY_BACKOFF_AFTER_FAILURES = 3;

/** Ceiling: a hard-down relay is retried at most every 5 minutes. */
export const RELAY_RETRY_MAX_MS = 5 * 60_000;

/**
 * Delay (ms) before retry N (1-based) of a consecutively-failing relay:
 * 1..3 → 5s (fast path), then 10s, 20s, 40s, 80s, 160s, capped at 5 minutes.
 * Pure so the schedule is unit-testable without any socket machinery.
 */
export function nextDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= RELAY_BACKOFF_AFTER_FAILURES) {
    return RELAY_RETRY_BASE_MS;
  }
  const doubled = RELAY_RETRY_BASE_MS * 2 ** (consecutiveFailures - RELAY_BACKOFF_AFTER_FAILURES);
  return Math.min(doubled, RELAY_RETRY_MAX_MS);
}

/** Minimal structural shape of websocket-ts's `Backoff` (see module docstring). */
interface WebsocketBackoff {
  readonly retries: number;
  readonly current: number;
  next(): number;
  reset(): void;
}

/** Injected so logging follows the caller's convention (the provider uses logSync). */
export type RelayBackoffLog = (message: string) => void;

export interface RelayBackoffOpts {
  /** Relay URL, for human-readable log lines. */
  relayUrl: string;
  /** Transition logger (one line per backoff-tier change / reset, never per attempt). */
  log?: RelayBackoffLog;
}

/**
 * Stateful, capped exponential backoff for ONE relay connection. One instance
 * per relay (created in NostrProvider's pool `open()`); it must NOT be shared
 * between relays, and MUST be the same instance for the lifetime of the relay
 * — that persistence across NRelay1's socket recreations is what makes the
 * backoff actually accumulate instead of restarting every reconnect.
 */
export class RelayBackoff implements WebsocketBackoff {
  #consecutiveFailures = 0;
  /** Delay tier last logged; a transition is logged only when this changes. */
  #lastLoggedDelay = 0;
  #relayUrl: string;
  #log: RelayBackoffLog | undefined;

  constructor(opts: RelayBackoffOpts) {
    this.#relayUrl = opts.relayUrl;
    this.#log = opts.log;
  }

  /** Retries since the last successful open (websocket-ts contract). */
  get retries(): number {
    return this.#consecutiveFailures;
  }

  /** The delay that would be returned right now (websocket-ts contract). */
  get current(): number {
    return nextDelayMs(this.#consecutiveFailures);
  }

  /**
   * Record one more consecutive failure and return the delay before the next
   * attempt. websocket-ts calls this once per close (handshake failure or
   * dropped connection) to schedule the retry.
   */
  next(): number {
    this.#consecutiveFailures += 1;
    const delay = nextDelayMs(this.#consecutiveFailures);
    // Observable once per STATE TRANSITION (fast → doubling → capped), not
    // once per attempt — a stuck relay logs ~3 lines per session, not hundreds.
    if (delay !== this.#lastLoggedDelay) {
      this.#lastLoggedDelay = delay;
      this.#log?.(
        `relay backoff: ${this.#relayUrl} — ${this.#consecutiveFailures} consecutive failure(s), next retry in ${Math.round(delay / 1000)}s`,
      );
    }
    return delay;
  }

  /**
   * Reset to the fast path after a successful open. websocket-ts calls this
   * when a socket (re)opens, so a relay that recovers reconnects quickly on
   * its next blip instead of inheriting the old penalty.
   */
  reset(): void {
    if (this.#consecutiveFailures > 0) {
      this.#log?.(
        `relay backoff: ${this.#relayUrl} — connected after ${this.#consecutiveFailures} failure(s), backoff reset`,
      );
    }
    this.#consecutiveFailures = 0;
    this.#lastLoggedDelay = 0;
  }
}
