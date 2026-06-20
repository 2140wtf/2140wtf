import { useMemo, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { HostedPollCube } from '@/components/HostedPollCube';
import { useAppContext } from '@/hooks/useAppContext';
import { BAO_POLL_RELAYS } from '@/hooks/usePollVotes';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const POLL_KIND = 1068;
const ZAP_POLL_KIND = 6969;
const INITIAL_LIMIT = 50;
const LOAD_MORE_INCREMENT = 50;

interface PollCubeFeedProps {
  filter?: 'all' | 'zap' | 'regular';
  searchQuery?: string;
  className?: string;
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

function extractTitle(event: NostrEvent): string {
  const lines = event.content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * Fetch poll events from default relays + BAO poll relays and render them
 * as hosted cube embeds.
 */
export function PollCubeFeed({ filter = 'all', searchQuery = '', className }: PollCubeFeedProps) {
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const [limit, setLimit] = useState(INITIAL_LIMIT);

  const kinds = useMemo(() => {
    if (filter === 'zap') return [ZAP_POLL_KIND];
    if (filter === 'regular') return [POLL_KIND];
    return [POLL_KIND, ZAP_POLL_KIND];
  }, [filter]);

  const { data: polls, isLoading } = useQuery<NostrEvent[]>({
    queryKey: ['poll-cube-feed', kinds, filter, limit],
    queryFn: async ({ signal }) => {
      const since = Math.floor(Date.now() / 1000) - 86400 * 90; // last 90 days
      const relayFilter = { kinds, limit, since };

      const readRelays = config.relayMetadata.relays
        .filter((r) => r.read)
        .map((r) => r.url);
      const normalizedRead = new Set(readRelays.map(normalizeUrl));
      const extraRelays = BAO_POLL_RELAYS.filter((url) => !normalizedRead.has(normalizeUrl(url)));

      const querySignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      const defaultResults = await nostr.query([relayFilter], { signal: querySignal });

      let extraResults: NostrEvent[] = [];
      if (extraRelays.length > 0) {
        try {
          const extraSignal = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
          extraResults = await nostr.group(extraRelays).query([relayFilter], { signal: extraSignal });
        } catch {
          // best-effort
        }
      }

      const all = new Map<string, NostrEvent>();
      for (const ev of defaultResults) all.set(ev.id, ev);
      for (const ev of extraResults) all.set(ev.id, ev);

      return Array.from(all.values()).sort((a, b) => b.created_at - a.created_at);
    },
    staleTime: 2 * 60 * 1000,
  });

  const filteredPolls = useMemo(() => {
    if (!polls) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return polls;
    return polls.filter((poll) => extractTitle(poll).toLowerCase().includes(q));
  }, [polls, searchQuery]);

  if (isLoading) {
    return (
      <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-6 py-4', className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[420px] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (filteredPolls.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-20 text-sm text-muted-foreground', className)}>
        No polls found. Check back soon!
      </div>
    );
  }

  const canLoadMore = (polls?.length ?? 0) >= limit;

  return (
    <div className={cn('space-y-6 py-4', className)}>
      <div className="grid grid-cols-1 gap-6">
        {filteredPolls.map((poll) => (
          <div key={poll.id} className="flex flex-col gap-3">
            <HostedPollCube pollId={poll.id} title={extractTitle(poll)} className="aspect-square min-h-[420px] max-h-[80vh]" />
            <div className="text-center px-2">
              <p className="text-sm font-bold line-clamp-2 leading-snug">{extractTitle(poll)}</p>
            </div>
          </div>
        ))}
      </div>
      {canLoadMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimit((prev) => prev + LOAD_MORE_INCREMENT)}
          >
            Load more cubes
          </Button>
        </div>
      )}
    </div>
  );
}
