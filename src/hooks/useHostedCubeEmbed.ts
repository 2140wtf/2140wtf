import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrFilter } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { BAO_POLL_RELAYS } from '@/hooks/usePollVotes';
import { sanitizeUrl } from '@/lib/sanitizeUrl';

const CUBE_DESIGN_KIND = 33889;

/**
 * Fetch a hosted BAO cube embed URL for a poll.
 *
 * Looks for a kind:33889 cube-design event whose `d` tag equals the poll id.
 * The event's `embed` tag carries the iframe URL.
 */
export function useHostedCubeEmbed(pollId: string | undefined) {
  const { nostr } = useNostr();
  const { config } = useAppContext();

  return useQuery<string | null>({
    queryKey: ['hosted-cube-embed', pollId],
    queryFn: async ({ signal }) => {
      if (!pollId) return null;

      const filter: NostrFilter = {
        kinds: [CUBE_DESIGN_KIND],
        '#d': [pollId],
        limit: 1,
      };

      // Query configured read relays first.
      const readRelays = config.relayMetadata.relays
        .filter((r) => r.read)
        .map((r) => r.url);
      const extraRelays = BAO_POLL_RELAYS.filter(
        (url) => !readRelays.some((r) => r.toLowerCase().replace(/\/+$/, '') === url.toLowerCase().replace(/\/+$/, '')),
      );

      let event;
      try {
        const results = await nostr.query([filter], { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
        event = results[0];
      } catch {
        // fall through to extra relays
      }

      if (!event && extraRelays.length > 0) {
        try {
          const results = await nostr
            .group(extraRelays)
            .query([filter], { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
          event = results[0];
        } catch {
          // best-effort
        }
      }

      if (!event) return null;

      const rawEmbedUrl = event.tags.find(([n]) => n === 'embed')?.[1];
      const embedUrl = sanitizeUrl(rawEmbedUrl);
      return embedUrl ?? null;
    },
    enabled: !!pollId,
    staleTime: 5 * 60 * 1000,
  });
}
