import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { ZAPSTORE_RELAY } from '@/lib/appRelays';
import { useNostrStorage } from '@/hooks/useNostrStorage';
import { useCacheFirstSeed } from '@/hooks/useCacheFirstSeed';

/** Kinds whose canonical home is the Zapstore relay. */
const ZAPSTORE_KINDS = [32267, 30063, 3063];

/** Public relays used only to discover an author's NIP-65 outbox list. */
const OUTBOX_DISCOVERY_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://nos.lol/',
  'wss://purplepag.es/',
];

interface QueryableNostr {
  query: (filters: NostrFilter[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]>;
  relay: (url: string) => {
    query: (filters: NostrFilter[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]>;
  };
}

/**
 * Query relays independently so one relay that never sends EOSE cannot discard
 * events already returned by healthier relays when a grouped query times out.
 */
async function queryRelaySet(
  nostr: QueryableNostr,
  relayUrls: string[],
  filters: NostrFilter[],
  signal: AbortSignal,
): Promise<NostrEvent[]> {
  const urls = [...new Set(relayUrls)].slice(0, 8);
  if (urls.length === 0 || signal.aborted) return [];

  return new Promise<NostrEvent[]>((resolve) => {
    const controller = new AbortController();
    let pending = urls.length;
    let settled = false;

    const finish = (events: NostrEvent[]) => {
      if (settled) return;
      if (events.length > 0) {
        settled = true;
        controller.abort();
        resolve(events);
        return;
      }
      pending -= 1;
      if (pending === 0) {
        settled = true;
        resolve([]);
      }
    };

    signal.addEventListener('abort', () => {
      if (settled) return;
      settled = true;
      controller.abort();
      resolve([]);
    }, { once: true });
    for (const url of urls) {
      void nostr.relay(url).query(filters, {
        signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(3000)]),
      }).then(finish).catch(() => finish([]));
    }
  });
}

/**
 * Extract write relay URLs from a NIP-65 (kind 10002) relay list event.
 * Write relays are where the author publishes their content.
 * Tags with no marker are both read+write; tags with "write" are write-only.
 */
function extractWriteRelays(event: NostrEvent): string[] {
  const relays = new Set<string>();
  for (const [name, url, marker] of event.tags) {
    if (name !== 'r' || marker === 'read' || !url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'wss:') {
        relays.add(parsed.href);
      }
    } catch {
      // skip malformed URLs
    }
  }
  return [...relays];
}

/**
 * Last-resort: fetch the author's NIP-65 relay list and query their write relays
 * for the target event. Returns the event if found, or null.
 */
async function queryAuthorRelays(
  nostr: QueryableNostr,
  authorPubkey: string,
  eventFilter: NostrFilter[],
  signal: AbortSignal,
): Promise<NostrEvent | null> {
  try {
    // Fetch the author's NIP-65 relay list from our connected relays
    const relayListSignal = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
    const relayListFilter: NostrFilter[] = [{ kinds: [10002], authors: [authorPubkey], limit: 1 }];
    let relayListEvents: NostrEvent[] = [];
    try {
      relayListEvents = await nostr.query(relayListFilter, { signal: relayListSignal });
    } catch {
      // A pooled query can reject when one slow relay holds the batch open.
      // Retry independently so results from responsive directory relays survive.
    }

    if (relayListEvents.length === 0) {
      relayListEvents = await queryRelaySet(
        nostr,
        OUTBOX_DISCOVERY_RELAYS,
        relayListFilter,
        AbortSignal.any([signal, AbortSignal.timeout(3000)]),
      );
    }

    if (relayListEvents.length === 0) return null;

    const latestRelayList = relayListEvents.reduce((latest, event) =>
      event.created_at > latest.created_at ? event : latest,
    );
    const writeRelays = extractWriteRelays(latestRelayList).slice(0, 5);
    if (writeRelays.length === 0) return null;

    // Query the author's write relays for the target event
    const authorRelaySignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    const events = await queryRelaySet(nostr, writeRelays, eventFilter, authorRelaySignal);
    return events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
  } catch {
    return null;
  }
}

/** Fetches a single Nostr event by its hex ID, optionally querying relay hints. */
export function useEvent(eventId: string | undefined, relays?: string[], authorHint?: string) {
  const { nostr } = useNostr();
  const { store } = useNostrStorage();

  return useQuery<NostrEvent | null>({
    queryKey: ['event', eventId ?? '', relays ?? [], authorHint ?? ''],
    queryFn: async () => {
      if (!eventId) return null;
      const filter: NostrFilter[] = [{ ids: [eventId], limit: 1 }];

      // 0. Cache-first: an event is immutable for a given id, so a local cache
      //    hit is authoritative — return it and skip the network entirely.
      const [cached] = await store.query(filter);
      if (cached) return cached;

      // 1. Query the user's configured relays first (batched automatically).
      //    Batched results are mirrored into the cache by the AppPool.
      let events: NostrEvent[] = [];
      try {
        events = await nostr.query(filter, { signal: AbortSignal.timeout(5000) });
      } catch {
        // Continue to relay hints and NIP-65 outbox discovery on timeout.
      }
      if (events.length > 0) return events[0];

      // 2. If not found and we have relay hints, try those relays directly
      if (relays && relays.length > 0) {
        try {
          const hintEvents = await queryRelaySet(nostr, relays, filter, AbortSignal.timeout(5000));
          if (hintEvents.length > 0) {
            // group() bypasses the batcher's cache tap — persist explicitly.
            void store.event(hintEvents[0]);
            return hintEvents[0];
          }
        } catch {
          // relay hint query failed — fall through
        }
      }

      // 3. Last resort: if we have the author's pubkey, fetch their NIP-65 relay
      //    list and try their write relays (where they publish content)
      if (authorHint) {
        const found = await queryAuthorRelays(nostr, authorHint, filter, AbortSignal.timeout(10000));
        if (found) {
          void store.event(found);
          return found;
        }
      }

      return null;
    },
    enabled: !!eventId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Coordinates for an addressable event (naddr). */
export interface AddrCoords {
  kind: number;
  pubkey: string;
  identifier: string;
}

/** Whether a kind is addressable (30000-39999) and thus identified by its d-tag. */
function isAddressableKind(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

/** Fetches a single addressable Nostr event by kind + pubkey + d-tag, optionally querying relay hints. */
export function useAddrEvent(addr: AddrCoords | undefined, relays?: string[]) {
  const { nostr } = useNostr();
  const { store } = useNostrStorage();

  // Seed from the local event store so a known addressable/replaceable event
  // renders immediately. Unlike fetch-by-id, an addr coordinate points at a
  // *replaceable* event, so the cached copy may be stale — the network query
  // below always runs and overwrites the seed when it resolves.
  useCacheFirstSeed<NostrEvent | null>({
    queryKey: addr ? ['addr-event', addr.kind, addr.pubkey, addr.identifier] : undefined,
    filter: addr
      ? isAddressableKind(addr.kind)
        ? { kinds: [addr.kind], authors: [addr.pubkey], '#d': [addr.identifier] }
        : { kinds: [addr.kind], authors: [addr.pubkey] }
      : { kinds: [], authors: [] },
    toData: (event) => event,
    getEvent: (data) => data ?? undefined,
  });

  return useQuery<NostrEvent | null>({
    queryKey: ['addr-event', addr?.kind ?? 0, addr?.pubkey ?? '', addr?.identifier ?? ''],
    queryFn: async () => {
      if (!addr) return null;
      // Only addressable events (30000-39999) use the d-tag for identification.
      // Everything else — legacy replaceable kinds (0, 3, etc.) and NIP-01
      // replaceable events (10000-19999) — is identified by kind+author alone.
      // Querying with `#d: [""]` against a non-addressable kind returns nothing,
      // because real replaceable events don't carry an empty `d` tag.
      const isAddressable = isAddressableKind(addr.kind);
      const baseFilter: NostrFilter = { kinds: [addr.kind], authors: [addr.pubkey], limit: 1 };
      if (isAddressable) {
        baseFilter['#d'] = [addr.identifier];
      }
      const filter: NostrFilter[] = [baseFilter];

      // The store query drops the `limit`, matching the addr-pointer shape.
      const cacheFilter: NostrFilter = isAddressable
        ? { kinds: [addr.kind], authors: [addr.pubkey], '#d': [addr.identifier] }
        : { kinds: [addr.kind], authors: [addr.pubkey] };

      // For Zapstore kinds, try the canonical relay first for fastest results
      if (ZAPSTORE_KINDS.includes(addr.kind)) {
        try {
          const zapEvents = await nostr.relay(ZAPSTORE_RELAY).query(filter, { signal: AbortSignal.timeout(5000) });
          if (zapEvents.length > 0) {
            void store.event(zapEvents[0]);
            return zapEvents[0];
          }
        } catch {
          // zapstore relay failed — fall through to normal flow
        }
      }

      // 1. Query the user's configured relays (batched + cached automatically)
      let events: NostrEvent[] = [];
      try {
        events = await nostr.query(filter, { signal: AbortSignal.timeout(5000) });
      } catch {
        // Continue to relay hints and NIP-65 outbox discovery on timeout.
      }
      if (events.length > 0) return events[0];

      // 2. If not found and we have relay hints, try those relays directly
      if (relays && relays.length > 0) {
        try {
          const hintEvents = await queryRelaySet(nostr, relays, filter, AbortSignal.timeout(5000));
          if (hintEvents.length > 0) {
            // group() bypasses the batcher's cache tap — persist explicitly.
            void store.event(hintEvents[0]);
            return hintEvents[0];
          }
        } catch {
          // relay hint query failed — fall through
        }
      }

      // 3. Last resort: fetch the author's NIP-65 relay list and try their
      //    write relays (naddr always includes the author pubkey)
      const found = await queryAuthorRelays(nostr, addr.pubkey, filter, AbortSignal.timeout(10000));
      if (found) {
        void store.event(found);
        return found;
      }

      // Relay miss — fall back to the locally cached copy (a replaceable miss
      // is almost always a transient relay hiccup, not an intentional delete).
      const [cached] = await store.query([cacheFilter]);
      return cached ?? null;
    },
    enabled: !!addr,
    staleTime: 5 * 60 * 1000,
  });
}
