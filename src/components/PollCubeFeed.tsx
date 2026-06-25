import { useMemo, useState } from "react";
import type { NostrEvent } from '@nostrify/nostrify';

import { HostedPollCube, type CubeThemeMode } from '@/components/HostedPollCube';
import { usePollFeed } from '@/hooks/usePollFeed';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const POLL_KIND = 1068;
const ZAP_POLL_KIND = 6969;
const INITIAL_LIMIT = 200;
const LOAD_MORE_INCREMENT = 100;

interface PollCubeFeedProps {
  filter?: 'all' | 'zap' | 'regular';
  searchQuery?: string;
  className?: string;
  theme?: CubeThemeMode;
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
export function PollCubeFeed({ filter = 'all', searchQuery = '', className, theme = 'light' }: PollCubeFeedProps) {
  const [limit, setLimit] = useState(INITIAL_LIMIT);

  const kinds = useMemo(() => {
    if (filter === 'zap') return [ZAP_POLL_KIND];
    if (filter === 'regular') return [POLL_KIND];
    return [POLL_KIND, ZAP_POLL_KIND];
  }, [filter]);

  const { data: polls, isLoading } = usePollFeed({ kinds, limit });

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
            <HostedPollCube pollId={poll.id} title={extractTitle(poll)} event={poll} theme={theme} className="aspect-square min-h-[420px] max-h-[80vh]" />
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
