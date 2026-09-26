// src/wallet/nip60/relays.ts
//
// "Relays travel with the user": resolve a user's own relay set from their
// Nostr profile (kind:10002 relay list, with kind:3 and kind:0 fallbacks) so
// the NIP-60 wallet reads/writes THEIRS, not just the BAO relay.
//
// Bootstrap relays are only used to discover the user's list; afterwards all
// wallet traffic goes to the user's relays (BAO relay kept as fallback).

import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools';

/** Fallback set used only to fetch the user's kind:10002 / kind:3 profile.
 *  The fund's own relay first, then public relays for Nostr-profile lookup.
 *  Bootstrap relays NEVER carry wallet or chat content - they answer one
 *  profile query; after discovery all wallet traffic goes to the user's own
 *  relays + the BAO fallback. Relays that have permanently shut down must be
 *  REMOVED here, not tolerated: nostr.band closed in 2025 and every page
 *  load paid its connection timeout in console noise. */
export const BOOTSTRAP_RELAYS = [
  'wss://relay.bao.fund',
  'wss://relay.damus.io',
];

export interface ProfileRelayOptions {
  bootstrap?: string[];
  pool?: SimplePool;
  timeoutMs?: number;
}

function normalizeRelay(url: string): string | null {
  const t = url.trim().toLowerCase();
  if (!/^wss?:\/\//.test(t)) return null;
  try {
    const parsed = new URL(t);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return null;
    return t.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Newest event among a disagreeing relay set. NIP-01 replaceable events
 * should be stored once, but a lagging relay serves a stale version; taking
 * whichever relay answered first (the old `[0]`) could silently bind the
 * wallet to an obsolete relay list.
 */
function newestEvent(events: Event[] | undefined): Event | undefined {
  const ts = (e: Event): number => (Number.isFinite(e.created_at) ? e.created_at : 0);
  return [...(events ?? [])].sort((a, b) => ts(b) - ts(a))[0];
}

function relaysFromEvent(event: Event | undefined): string[] {
  if (!event) return [];
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'r' && typeof tag[1] === 'string') {
      const relay = normalizeRelay(tag[1]);
      if (relay) out.push(relay);
    }
  }
  return out;
}

/**
 * Fetch the user's relay list: kind:10002 (preferred), kind:3 (legacy), and
 * kind:0 kind metadata `relays` field (last resort). Deduped, normalized,
 * BAO relay always appended as fallback.
 */
export async function fetchProfileRelays(
  pubkey: string,
  options: ProfileRelayOptions = {},
): Promise<string[]> {
  const bootstrap = options.bootstrap ?? BOOTSTRAP_RELAYS;
  const pool = options.pool ?? new SimplePool();
  // Bounded discovery: SimplePool keeps retrying dead relays internally; a
  // hard per-query deadline keeps one flapping public relay from stalling
  // wallet restore indefinitely (profile lookup is best-effort - the BAO
  // fallback below guarantees a usable result).
  const timeoutMs = options.timeoutMs ?? 4_000;
  const query = (filter: Filter) =>
    pool.querySync(bootstrap, filter).catch(() => [] as Event[]);
  const withDeadline = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve([] as unknown as T), timeoutMs))]);

  const n10002 = newestEvent(
    await withDeadline(query({ kinds: [10002], authors: [pubkey], limit: 1 } as Filter)),
  );
  let relays = relaysFromEvent(n10002);

  if (relays.length === 0) {
    try {
      const legacy = await withDeadline(query({ kinds: [3], authors: [pubkey], limit: 1 }));
      relays = relaysFromEvent(newestEvent(legacy));
    } catch {
      /* fall through */
    }
  }
  if (relays.length === 0) {
    try {
      const meta = await withDeadline(query({ kinds: [0], authors: [pubkey], limit: 1 }));
      const parsed = JSON.parse(newestEvent(meta)?.content ?? '{}') as { relays?: unknown };
      if (Array.isArray(parsed.relays)) {
        relays = parsed.relays.map((r) => String(r)).flatMap((u) => {
          const n = normalizeRelay(u);
          return n ? [n] : [];
        });
      }
    } catch {
      /* fall through */
    }
  }

  const unique = [...new Set(relays)];
  for (const fallback of options.bootstrap ?? BOOTSTRAP_RELAYS) {
    const n = normalizeRelay(fallback);
    if (n && !unique.includes(n)) unique.push(n);
  }
  return unique;
}
