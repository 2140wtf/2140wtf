import { NRelay1, type NostrEvent, type NostrFilter } from '@nostrify/nostrify';

import { extractReadRelays } from '@/lib/inboxRelays';

/** Canonical BAO Court relay used as a fallback/public bulletin board. */
export const BAO_COURT_RELAY = 'wss://relay.bao.network';

/** Maximum number of recipient inbox relays to fan out to. */
const MAX_INBOX_RELAYS = 10;

/**
 * Fetch a user's NIP-65 read relays (their inbox relays).
 * Falls back to an empty array if the user has no relay list.
 */
export async function fetchInboxRelays(
  nostr: { query: (filters: NostrFilter[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]> },
  pubkey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const events = await nostr.query(
    [{ kinds: [10002], authors: [pubkey], limit: 1 }],
    { signal },
  );
  const relayList = events[0];
  if (!relayList) return [];
  return extractReadRelays(relayList);
}

/**
 * Publish a pre-signed NIP-59 gift wrap (kind 1059) to a recipient's inbox
 * relays plus the BAO Court relay fallback.
 *
 * This is fire-and-forget: failures are logged but not thrown, so a single
 * unreachable inbox relay does not block the ceremony.
 */
export async function publishProtocolWrap(
  nostr: { query: (filters: NostrFilter[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]>; group: (urls: string[]) => { event: (event: NostrEvent, opts?: { signal?: AbortSignal }) => Promise<void> }; event: (event: NostrEvent, opts?: { signal?: AbortSignal }) => Promise<void> },
  wrap: NostrEvent,
  recipientPubkey: string,
): Promise<void> {
  const inboxRelays = await fetchInboxRelays(nostr, recipientPubkey, AbortSignal.timeout(5000));
  const urls = [...new Set([...inboxRelays, BAO_COURT_RELAY])].slice(0, MAX_INBOX_RELAYS);

  try {
    if (urls.length > 0) {
      await nostr.group(urls).event(wrap, { signal: AbortSignal.timeout(5000) });
    } else {
      await nostr.event(wrap, { signal: AbortSignal.timeout(5000) });
    }
  } catch (error) {
    // Best-effort delivery: log and continue. The BAO Court relay fallback
    // means most recipients can still fetch the wrap from there.
    console.warn('Failed to deliver protocol gift wrap:', error);
  }
}

/**
 * Open a dedicated BAO Court relay connection.
 * Callers own the lifecycle and must close the relay when done.
 */
export function openBaoCourtRelay(): NRelay1 {
  return new NRelay1(BAO_COURT_RELAY);
}
