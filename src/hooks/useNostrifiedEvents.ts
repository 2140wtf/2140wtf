import { useCallback, useEffect, useRef } from 'react';
import { SimplePool, verifyEvent, nip19, type Event, type Filter } from 'nostr-tools';
import { useAppContext } from '@/hooks/useAppContext';

interface NostrifiedFilter {
  kinds: number[];
  authors?: string[];
  limit?: number;
  since?: number;
  until?: number;
  '#d'?: string[];
  '#p'?: string[];
  '#t'?: string[];
  '#e'?: string[];
}

interface QueryOptions {
  /** Max age of returned events in seconds (default 24h). */
  maxAgeSec?: number;
  /** Max milliseconds to wait for relay responses (default 8000). */
  maxWait?: number;
  /** Relay URLs to query; defaults to app read relays. */
  relays?: string[];
}

interface SubscribeOptions {
  /** Relay URLs to subscribe on; defaults to app read relays. */
  relays?: string[];
  /** Max total events before the subscription auto-closes (default 500). */
  maxEvents?: number;
  /** Max lifetime of the subscription in ms (default 30000). */
  maxLifetimeMs?: number;
  /** Max events per second before rate-limiting closes the sub (default 50). */
  maxEventsPerSecond?: number;
  /** Called when the subscription closes or is stopped. */
  onClose?: () => void;
  /** Called when the subscription is closed due to rate/time/event limits. */
  onLimit?: (reason: 'rate' | 'time' | 'events') => void;
}

function normalizePubkey(input: string): string | null {
  if (typeof input !== 'string') return null;
  const hex = input.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return hex;
  try {
    const { type, data } = nip19.decode(input.trim());
    if (type === 'npub' && typeof data === 'string' && /^[0-9a-f]{64}$/.test(data)) return data;
  } catch {
    // ignore
  }
  return null;
}

function isValidEvent(ev: Event, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = 86400): boolean {
  try {
    if (!verifyEvent(ev)) return false;
  } catch {
    return false;
  }
  if (ev.created_at > nowSec + 300) return false;
  if (ev.created_at < nowSec - maxAgeSec) return false;
  return true;
}

function toFilter(filters: NostrifiedFilter): Filter {
  const filter: Filter = { kinds: filters.kinds };
  if (filters.authors) filter.authors = filters.authors;
  if (filters.limit !== undefined) filter.limit = filters.limit;
  if (filters.since !== undefined) filter.since = filters.since;
  if (filters.until !== undefined) filter.until = filters.until;
  if (filters['#d']) filter['#d'] = filters['#d'];
  if (filters['#p']) filter['#p'] = filters['#p'];
  if (filters['#t']) filter['#t'] = filters['#t'];
  if (filters['#e']) filter['#e'] = filters['#e'];
  return filter;
}

/**
 * Lightweight Nostr event fetcher ported from the nostrified-mockup approach.
 *
 * - Uses `nostr-tools` SimplePool with `querySync`.
 * - Validates signatures and freshness.
 * - Deduplicates by event id.
 * - Provides a bounded live subscription with rate/event/lifetime limits.
 *
 * The pool is created lazily and closed when the component unmounts.
 */
export function useNostrifiedEvents() {
  const { config } = useAppContext();
  const poolRef = useRef<SimplePool | null>(null);

  const getRelays = useCallback((overrides?: string[]) => {
    if (overrides && overrides.length > 0) return overrides;
    return (config.relayMetadata?.relays ?? [])
      .filter((r) => r.read !== false)
      .map((r) => r.url)
      .filter(Boolean);
  }, [config.relayMetadata]);

  const getPool = useCallback(() => {
    if (!poolRef.current) {
      poolRef.current = new SimplePool();
    }
    return poolRef.current;
  }, []);

  useEffect(() => {
    return () => {
      poolRef.current?.close(getRelays());
      poolRef.current = null;
    };
  }, [getRelays]);

  const query = useCallback(async (
    filters: NostrifiedFilter,
    options: QueryOptions = {},
  ): Promise<Event[]> => {
    const pool = getPool();
    const relays = getRelays(options.relays);
    if (relays.length === 0) return [];

    if (!Array.isArray(filters.kinds) || filters.kinds.length === 0) {
      console.error('[useNostrifiedEvents] query rejected: invalid kinds');
      return [];
    }

    const maxAgeSec = options.maxAgeSec ?? 86400;
    const maxWait = options.maxWait ?? 8000;

    const requestedLimit = filters.limit ?? 200;
    const cappedLimit = Math.min(Math.max(requestedLimit, 1), 500);
    const capped: NostrifiedFilter = { ...filters, limit: cappedLimit };

    if (capped.authors) {
      capped.authors = capped.authors.map(normalizePubkey).filter((x): x is string => typeof x === 'string');
      if (capped.authors.length === 0) {
        console.error('[useNostrifiedEvents] query rejected: all authors invalid');
        return [];
      }
    }

    if (capped['#p']) {
      capped['#p'] = capped['#p'].map(normalizePubkey).filter((x): x is string => typeof x === 'string');
      if (capped['#p'].length === 0) delete (capped as NostrifiedFilter)['#p'];
    }

    try {
      const events = await pool.querySync(relays, toFilter(capped), { maxWait });
      const now = Math.floor(Date.now() / 1000);
      const seen = new Set<string>();
      return events.filter((ev) => {
        if (!isValidEvent(ev, now, maxAgeSec)) return false;
        if (seen.has(ev.id)) return false;
        seen.add(ev.id);
        return true;
      });
    } catch (err) {
      console.error('[useNostrifiedEvents] query failed:', err);
      return [];
    }
  }, [getPool, getRelays]);

  const subscribe = useCallback((
    filters: NostrifiedFilter,
    onEvent: (event: Event) => void,
    options: SubscribeOptions = {},
  ): (() => void) => {
    const pool = getPool();
    const relays = getRelays(options.relays);
    if (relays.length === 0) return () => {};

    const maxEvents = options.maxEvents ?? 500;
    const maxLifetimeMs = options.maxLifetimeMs ?? 30000;
    const maxEventsPerSecond = options.maxEventsPerSecond ?? 50;

    let closed = false;
    let eventCount = 0;
    const rateWindow: number[] = [];
    const seen = new Set<string>();

    const doClose = (reason?: 'rate' | 'time' | 'events') => {
      if (closed) return;
      closed = true;
      cleanup();
      options.onClose?.();
      if (reason) options.onLimit?.(reason);
    };

    const lifetimeTimer = setTimeout(() => doClose('time'), maxLifetimeMs);

    const sub = pool.subscribeMany(relays, toFilter(filters), {
      onevent: (ev: Event) => {
        if (closed) return;
        if (seen.has(ev.id)) return;

        const now = Date.now();
        rateWindow.push(now);
        while (rateWindow.length > 0 && rateWindow[0] < now - 1000) {
          rateWindow.shift();
        }
        if (rateWindow.length > maxEventsPerSecond) {
          doClose('rate');
          return;
        }

        seen.add(ev.id);
        eventCount++;
        onEvent(ev);

        if (eventCount >= maxEvents) {
          doClose('events');
        }
      },
      onclose: () => {
        if (!closed) doClose();
      },
    });

    const cleanup = () => {
      clearTimeout(lifetimeTimer);
      try { sub.close(); } catch { /* ignore */ }
    };

    return cleanup;
  }, [getPool, getRelays]);

  return { query, subscribe };
}
