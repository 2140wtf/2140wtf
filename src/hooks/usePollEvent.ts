import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { BAO_POLL_RELAYS } from '@/hooks/usePollVotes';

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

/**
 * Fetch a Nostr poll event (kind 1068 or 6969) by id.
 *
 * Queries the configured read relays first, then expands to the BAO poll relay
 * set for the best chance of finding the event.
 */
export function usePollEvent(pollId: string | undefined) {
  const { nostr } = useNostr();
  const { config } = useAppContext();

  return useQuery<NostrEvent | null>({
    queryKey: ['poll-event', pollId],
    queryFn: async ({ signal }) => {
      if (!pollId) return null;

      const filter: NostrFilter = {
        kinds: [1068, 6969],
        ids: [pollId],
        limit: 1,
      };

      const defaultSignal = AbortSignal.any([signal, AbortSignal.timeout(6000)]);
      const defaultResults = await nostr.query([filter], { signal: defaultSignal });
      let event = defaultResults[0];

      if (!event) {
        const readUrls = config.relayMetadata.relays
          .filter((r) => r.read)
          .map((r) => r.url);
        const normalizedRead = new Set(readUrls.map(normalizeUrl));
        const extras = BAO_POLL_RELAYS.filter((url) => !normalizedRead.has(normalizeUrl(url)));

        if (extras.length > 0) {
          try {
            const extraSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
            const extraResults = await nostr.group(extras).query([filter], { signal: extraSignal });
            event = extraResults[0];
          } catch {
            // best-effort
          }
        }
      }

      return event ?? null;
    },
    enabled: !!pollId,
    staleTime: 2 * 60 * 1000,
  });
}
