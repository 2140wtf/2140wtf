import type { NostrEvent, NostrFilter, NPool } from '@nostrify/nostrify';
import { verifyEvent } from 'nostr-tools';

import { queryPetsRelay } from './pets-relay';

interface FetchFreshPetsEventOptions {
  /** Abort signal merged with the internal 10s timeout. */
  signal?: AbortSignal;
}

/**
 * Fetches the freshest version of a pets-related replaceable/addressable event
 * directly from the user's configured relays and verifies its signature and
 * author.
 *
 * Use this instead of the generic `fetchFreshEvent` for any kind 31124 or 11125
 * read-modify-write so the mutation reads from the same relays it writes to.
 */
export async function fetchFreshPetsEvent(
  nostr: NPool,
  filter: NostrFilter,
  opts: FetchFreshPetsEventOptions = {},
): Promise<NostrEvent | null> {
  const { signal } = opts;
  const timeout = AbortSignal.timeout(10_000);
  const querySignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const events = await queryPetsRelay(nostr, [{ ...filter, limit: 1 }], {
    signal: querySignal,
  });

  const latest = events.length
    ? events.reduce((latest, current) =>
        current.created_at > latest.created_at ? current : latest,
      )
    : null;

  if (!latest) return null;

  // Reject events with invalid signatures or unexpected authors. This prevents
  // a compromised/malicious relay from injecting fake pet state or profiles.
  if (!verifyEvent(latest)) {
    throw new Error('Fetched pets event has an invalid signature.');
  }
  if (filter.authors?.length && !filter.authors.includes(latest.pubkey)) {
    throw new Error('Fetched pets event author does not match the requested pubkey.');
  }

  return latest;
}
