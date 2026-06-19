import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrFilter } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { BAO_POLL_RELAYS } from '@/hooks/usePollVotes';
import { sanitizeUrl } from '@/lib/sanitizeUrl';

const CUBE_DESIGN_KIND = 33889;

const DEFAULT_CUBE_API_BASES = [
  'https://bao.markets/bao-api/v1',
  'https://relay.bao.network/bao-api/v1',
];

export interface CubeBranding {
  logoUrl?: string | null;
  label?: string;
  accentColor?: string;
  poweredBy?: string | null;
}

export interface CubeWallImage {
  url: string;
  posX: number;
  posY: number;
}

export interface CubeDesign {
  pollId: string;
  creatorPubkey: string;
  designType: 'POLL_ONLY' | 'LIVE_EVENT';
  embedUrl: string;
  cardUrl?: string;
  lightningAddress?: string | null;
  streamUrl?: string | null;
  wallImages?: Record<string, CubeWallImage>;
  branding?: CubeBranding;
  isPaid?: boolean;
  priceSats?: number;
  nostrEventId?: string | null;
}

function defaultEmbedUrl(pollId: string): string {
  return `https://bao.markets/embed/cube/${encodeURIComponent(pollId)}`;
}

async function fetchCubeDesign(
  pollId: string,
  bases: string[],
  signal?: AbortSignal,
): Promise<CubeDesign | null> {
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/cube-designs/${encodeURIComponent(pollId)}`, {
        signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown> | undefined;
      const data = json && typeof json === 'object' ? (json.data ?? json) : null;
      if (data && typeof (data as CubeDesign).embedUrl === 'string') {
        return data as CubeDesign;
      }
    } catch {
      // try next base
    }
  }
  return null;
}

/**
 * Fetch a hosted BAO cube embed URL for a poll.
 *
 * 1. Calls the BAO cube-design API (GET /v1/cube-designs/<pollId>). The API
 *    returns a default BAO-branded design for any poll, even if the creator
 *    never opened the cube designer.
 * 2. Falls back to reading a kind:33889 cube-design event from Nostr relays.
 * 3. Finally falls back to the deterministic embed URL.
 */
export function useHostedCubeEmbed(pollId: string | undefined) {
  const { nostr } = useNostr();
  const { config } = useAppContext();

  const apiBases = config.baoApiUrl
    ? [`${config.baoApiUrl.replace(/\/$/, '')}/v1`]
    : DEFAULT_CUBE_API_BASES;

  return useQuery<CubeDesign | null>({
    queryKey: ['hosted-cube-design', pollId, config.baoApiUrl],
    queryFn: async ({ signal }) => {
      if (!pollId) return null;

      // 1. API-first lookup.
      const design = await fetchCubeDesign(pollId, apiBases, signal);
      if (design) return design;

      // 2. Nostr kind:33889 fallback.
      const filter: NostrFilter = {
        kinds: [CUBE_DESIGN_KIND],
        '#d': [pollId],
        limit: 1,
      };

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

      if (event) {
        const rawEmbedUrl = event.tags.find(([n]) => n === 'embed')?.[1];
        const embedUrl = sanitizeUrl(rawEmbedUrl);
        if (embedUrl) {
          return {
            pollId,
            creatorPubkey: event.pubkey,
            designType: 'POLL_ONLY' as const,
            embedUrl,
          };
        }
      }

      // 3. Deterministic fallback.
      return {
        pollId,
        creatorPubkey: '',
        designType: 'POLL_ONLY' as const,
        embedUrl: defaultEmbedUrl(pollId),
      };
    },
    enabled: !!pollId,
    staleTime: 5 * 60 * 1000,
  });
}
