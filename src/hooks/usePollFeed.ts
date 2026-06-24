import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { BAO_POLL_RELAYS } from '@/hooks/usePollVotes';

const POLL_KIND = 1068;
const ZAP_POLL_KIND = 6969;

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

function extractEndsAt(event: NostrEvent): number | undefined {
  const endsAt = event.tags.find(([n]) => n === 'endsAt')?.[1];
  if (endsAt) return Number(endsAt);
  const closedAt = event.tags.find(([n]) => n === 'closed_at')?.[1];
  if (closedAt) return Number(closedAt);
  return undefined;
}

function isActivePoll(event: NostrEvent): boolean {
  const endsAt = extractEndsAt(event);
  if (!endsAt || !Number.isFinite(endsAt)) return true;
  return endsAt > Math.floor(Date.now() / 1000);
}

function isBaoMarketPoll(event: NostrEvent): boolean {
  return event.tags.some(([n, v]) => n === 't' && v === 'smj-market');
}

export interface UsePollFeedOptions {
  kinds?: number[];
  /** If true, include polls that have already ended. Default false. */
  includeExpired?: boolean;
  /** How far back to look, in days. Default 180. */
  lookbackDays?: number;
  limit?: number;
}

/**
 * Fetch kind:1068 / kind:6969 polls from the user's read relays plus the
 * extended BAO poll relay set. Filters out BAO prediction-market duplicates
 * and (by default) expired polls.
 */
export function usePollFeed(options: UsePollFeedOptions = {}) {
  const { nostr } = useNostr();
  const { config } = useAppContext();

  const kinds = options.kinds ?? [POLL_KIND, ZAP_POLL_KIND];
  const includeExpired = options.includeExpired ?? false;
  const lookbackDays = options.lookbackDays ?? 180;
  const limit = options.limit ?? 200;

  const readRelays = config.relayMetadata.relays
    .filter((r) => r.read)
    .map((r) => r.url);
  const normalizedRead = new Set(readRelays.map(normalizeUrl));
  const extraRelays = BAO_POLL_RELAYS.filter(
    (url) => !normalizedRead.has(normalizeUrl(url)),
  );

  return useQuery<NostrEvent[]>({
    queryKey: ['poll-feed', kinds, lookbackDays, limit, includeExpired],
    queryFn: async ({ signal }) => {
      const since = Math.floor(Date.now() / 1000) - 86400 * lookbackDays;
      const relayFilter = { kinds, limit, since };

      const querySignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      const defaultResults = await nostr.query([relayFilter], {
        signal: querySignal,
      });

      let extraResults: NostrEvent[] = [];
      if (extraRelays.length > 0) {
        try {
          const extraSignal = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
          extraResults = await nostr
            .group(extraRelays)
            .query([relayFilter], { signal: extraSignal });
        } catch {
          // best-effort: extra relays are not required
        }
      }

      const all = new Map<string, NostrEvent>();
      for (const ev of defaultResults) all.set(ev.id, ev);
      for (const ev of extraResults) all.set(ev.id, ev);

      return Array.from(all.values())
        .filter((ev) => {
          if (isBaoMarketPoll(ev)) return false;
          if (!includeExpired && !isActivePoll(ev)) return false;
          return true;
        })
        .sort((a, b) => b.created_at - a.created_at);
    },
    staleTime: 2 * 60 * 1000,
  });
}
