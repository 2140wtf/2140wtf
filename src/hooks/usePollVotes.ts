import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { useNostrStorage } from '@/hooks/useNostrStorage';

const DEFAULT_LIMIT = 1000;

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

/** Extract relay hints from `e` and `p` tag trailing URLs. */
function getRelayHints(event: NostrEvent): string[] {
  const hints = new Set<string>();
  for (const tag of event.tags) {
    const hint = tag[2];
    if (!hint) continue;
    if (tag[0] !== 'e' && tag[0] !== 'p') continue;
    try {
      const parsed = new URL(hint);
      if (parsed.protocol === 'wss:' || parsed.protocol === 'ws:') {
        hints.add(parsed.href);
      }
    } catch {
      // ignore malformed URLs
    }
  }
  return Array.from(hints);
}

/** Extract write-capable relay URLs from a kind 10002 NIP-65 relay list. */
function extractWriteRelays(event: NostrEvent): string[] {
  const relays = new Set<string>();
  for (const [name, url, marker] of event.tags) {
    if (name !== 'r' || marker === 'read' || !url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'wss:' || parsed.protocol === 'ws:') {
        relays.add(parsed.href);
      }
    } catch {
      // ignore malformed URLs
    }
  }
  return Array.from(relays);
}

function getConfiguredReadUrls(config: ReturnType<typeof useAppContext>['config']): string[] {
  return config.relayMetadata.relays.filter((r) => r.read).map((r) => r.url);
}

function getUntil(event: NostrEvent): number | undefined {
  const endsAt = event.tags.find(([n]) => n === 'endsAt')?.[1];
  if (endsAt) return Number(endsAt);
  const closedAt = event.tags.find(([n]) => n === 'closed_at')?.[1];
  if (closedAt) return Number(closedAt);
  return undefined;
}

/**
 * Fetch votes/receipts for a poll event.
 *
 * Queries the configured read relays first, then expands the search to:
 *   - relay hints embedded in the poll's `e`/`p` tags
 *   - the poll author's NIP-65 write relays
 *
 * This catches votes that were published to the author's preferred relays
 * rather than the user's default read set.
 */
export function usePollVotes(event: NostrEvent, kind: number) {
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { store } = useNostrStorage();

  return useQuery<NostrEvent[]>({
    queryKey: ['poll-votes', event.id, kind],
    queryFn: async ({ signal }) => {
      const filter: NostrFilter = {
        kinds: [kind],
        '#e': [event.id],
        limit: DEFAULT_LIMIT,
      };
      const until = getUntil(event);
      if (until) filter.until = until;

      const querySignal = AbortSignal.any([signal, AbortSignal.timeout(6000)]);

      // 1. Default read relays (batched + cached automatically).
      const defaultResults = await nostr.query([filter], { signal: querySignal });

      // 2. Gather extra relays from hints and the author's NIP-65 list.
      const extraRelays = new Set<string>(getRelayHints(event));

      try {
        const relayListSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
        const relayLists = await nostr.query(
          [{ kinds: [10002], authors: [event.pubkey], limit: 1 }],
          { signal: relayListSignal },
        );
        for (const rl of relayLists) {
          for (const url of extractWriteRelays(rl)) {
            extraRelays.add(url);
          }
        }
      } catch {
        // Relay-list lookup is best-effort.
      }

      const configuredUrls = new Set(getConfiguredReadUrls(config).map(normalizeUrl));
      const uniqueExtras = Array.from(extraRelays).filter((url) => {
        return !configuredUrls.has(normalizeUrl(url));
      });

      // 3. Query the extra relays directly.
      let extraResults: NostrEvent[] = [];
      if (uniqueExtras.length > 0) {
        try {
          const extraSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
          extraResults = await nostr.group(uniqueExtras).query([filter], { signal: extraSignal });
        } catch {
          // Extra-relay query is best-effort.
        }
      }

      // Merge and dedupe by event id, keeping the newest copy.
      const all = new Map<string, NostrEvent>();
      for (const ev of defaultResults) all.set(ev.id, ev);
      for (const ev of extraResults) {
        const existing = all.get(ev.id);
        if (!existing || ev.created_at > existing.created_at) {
          all.set(ev.id, ev);
        }
      }

      const votes = Array.from(all.values());

      // group() bypasses the AppPool cache tap — mirror extras explicitly.
      for (const ev of extraResults) {
        void store.event(ev);
      }

      return votes;
    },
    staleTime: 30_000,
  });
}
