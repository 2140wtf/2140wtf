/**
 * Relay socket-reopen signal.
 *
 * NostrProvider watches every pool relay's underlying WebSocket and announces
 * here whenever a socket (re)opens. A reconnected socket is a fresh,
 * unauthenticated session: NRelay1 re-issues its standing subscriptions on it,
 * but on an auth-gating relay that re-issued REQ races the NIP-42 handshake
 * and can be swallowed or CLOSED — leaving a long-lived consumer (the wire's
 * standing ingestion, WireSync) blocked on a subscription that will never
 * speak again. Listeners use this signal to tear their current round down and
 * re-REQ on the fresh socket (each fresh REQ gets its own auth-retry from the
 * pool), so a reconnect heals in ~a second instead of wedging until relaunch.
 *
 * Plain module bus (same pattern as wire/bus.ts): no React, no coalescing —
 * socket opens are rare and each one matters.
 */

type ReopenListener = (relayUrl: string) => void;

const listeners = new Set<ReopenListener>();

/** Announce that this relay's socket just (re)opened. */
export function emitRelayReopened(relayUrl: string): void {
  for (const listener of listeners) {
    try {
      listener(relayUrl);
    } catch {
      // A listener must never break the signal for the others.
    }
  }
}

/** Subscribe to socket-reopen announcements. Returns an unsubscribe. */
export function onRelayReopened(listener: ReopenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper: drop all listeners. */
export function resetRelayReopened(): void {
  listeners.clear();
}
