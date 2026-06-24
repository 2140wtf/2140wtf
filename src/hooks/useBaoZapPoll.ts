import { useQuery } from '@tanstack/react-query';
import { NRelay1, type NostrEvent } from '@nostrify/nostrify';

const RELAY = 'wss://relay.bao.network';
const QUERY_TIMEOUT_MS = 10_000;

function getPollTagId(event: NostrEvent): string | undefined {
  return event.tags.find(([name]) => name === 'poll')?.[1];
}

/**
 * Fetch the kind 6969 "zap poll" event associated with a kind 38000 ₿AO market.
 *
 * BAO markets publish a kind 1068 poll and a matching kind 6969 zap poll. The
 * kind 38000 market event carries a `poll` tag pointing at the kind 1068 poll,
 * and the kind 6969 event references the same poll via an `e` tag. This hook
 * resolves that linked zap poll so 2140wtf can render its own "Zap to vote"
 * overlay instead of relying on the cube iframe.
 */
export function useBaoZapPollEvent(marketEvent: NostrEvent | undefined) {
  const pollTagId = marketEvent ? getPollTagId(marketEvent) : undefined;

  return useQuery<NostrEvent | null>({
    queryKey: ['bao-zap-poll', marketEvent?.id, pollTagId],
    queryFn: async ({ signal }) => {
      if (!marketEvent || !pollTagId) return null;

      const relay = new NRelay1(RELAY);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

      if (signal) {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      try {
        const events = await relay.query(
          [
            {
              kinds: [6969],
              authors: [marketEvent.pubkey],
              '#e': [pollTagId],
              limit: 1,
            },
          ],
          { signal: controller.signal },
        );
        return events[0] ?? null;
      } finally {
        clearTimeout(timeoutId);
        relay.close().catch(() => {});
      }
    },
    enabled: !!marketEvent && !!pollTagId,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
