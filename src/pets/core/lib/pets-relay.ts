import type { NPool, NostrFilter, NostrEvent } from '@nostrify/nostrify';

/**
 * Query the user's configured relays for pet events.
 *
 * Pet state (kind 31124), Nostr pet profile (kind 11125), and pet interaction
 * (kind 1124) events are read from the same effective relay pool as the rest of
 * the app, rather than a single dedicated relay.
 */
export function queryPetsRelay(
  nostr: NPool,
  filters: NostrFilter[],
  opts?: { signal?: AbortSignal },
): Promise<NostrEvent[]> {
  const query = nostr.query(filters, opts);
  const signal = opts?.signal;
  if (!signal) return query;

  // Some relay adapters do not settle promptly after their signal aborts.
  // Enforce cancellation at this boundary so a socket cannot hold the UI.
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
  }

  return new Promise<NostrEvent[]>((resolve, reject) => {
    const onAbort = () => reject(
      signal.reason ?? new DOMException('The operation was aborted', 'AbortError'),
    );
    signal.addEventListener('abort', onAbort, { once: true });
    query.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}
