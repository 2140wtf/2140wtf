/**
 * Per-relay NIP-42 sign queue — extracted from NostrProvider (round 27c).
 *
 * Contract (proven by chain-order tests in `authSignQueue.property.test.ts`
 * and `authSignQueue.test.ts`):
 *
 *  - Requests for the SAME key (relay + challenge) collapse onto one
 *    in-flight promise — challenges are single-use nonces, but re-issuing
 *    the identical nonce concurrently must not queue N bunker round-trips.
 *  - Distinct keys for the same relay are serialized as FULL turns: turn N+1
 *    starts only after turn N's `fire` has fully completed (including any
 *    cooldown write). No two signs for one relay are ever concurrent — this
 *    closes the round-27a gap where the chain held only the cooldown wait,
 *    letting sign N+1's wait-check run while sign N was still in flight.
 *  - Each turn's `guard` runs at its fire time (after every earlier turn
 *    completed) and BEFORE any waiting/signing: a queued turn whose challenge
 *    was superseded, or whose signer vanished, fails closed immediately.
 *  - A failed turn never poisons the chain for later turns.
 *  - `reset(relay)` (socket reopen) drops the chain so the next challenge
 *    starts a fresh chain immediately; queued turns still complete — they
 *    fail closed on their own supersession guards. `clear()` does the same
 *    for all relays (account switch).
 */
export class AuthSignQueue<T> {
  private chains = new Map<string, Promise<void>>();
  private inFlight = new Map<string, Promise<T>>();

  /**
   * Collapse concurrent callers asking for the SAME key onto one promise.
   * `create` is invoked only for the first caller; its promise is cleaned
   * out of the map when settled (identity-checked against late writes).
   */
  collapse(key: string, create: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const created = create().finally(() => {
      if (this.inFlight.get(key) === created) this.inFlight.delete(key);
    });
    this.inFlight.set(key, created);
    return created;
  }

  /** Peek at an existing in-flight promise for `key`, if any. */
  peekInFlight(key: string): Promise<T> | undefined {
    return this.inFlight.get(key);
  }

  /**
   * Enqueue `fire` behind the previous FULL turn for `relay` and return this
   * turn's promise. `guard` runs at the turn's fire time — after every
   * earlier turn completed and before `fire` — and may be async (e.g. await
   * a rate-limit cooldown). Throwing in `guard` fails this turn closed
   * without executing `fire`.
   */
  enqueue(relay: string, fire: () => Promise<T>, guard?: () => void | Promise<void>): Promise<T> {
    const prev = this.chains.get(relay) ?? Promise.resolve();
    const myTurn = prev
      .catch(() => {
        // A failed predecessor must not poison the chain.
      })
      .then(async () => {
        await guard?.();
        return fire();
      });
    // The chain stores the turn's SETTLEMENT, not its value/rejection: the
    // next turn enqueues behind completion (success OR failure) of this one.
    this.chains.set(
      relay,
      myTurn.then(
        () => undefined,
        () => undefined,
      ),
    );
    return myTurn;
  }

  /**
   * Drop one relay's chain state (socket reopen). In-flight map entries for
   * this relay are removed; their promises are NOT cancelled — queued turns
   * still settle, failing closed on their own guards.
   */
  reset(relay: string): void {
    this.chains.delete(relay);
    for (const key of [...this.inFlight.keys()]) {
      if (key.startsWith(`${relay}\n`)) this.inFlight.delete(key);
    }
  }

  /** Drop all state (account switch). Same non-cancelling semantics. */
  clear(): void {
    this.chains.clear();
    this.inFlight.clear();
  }
}
