import { useMemo, useState } from "react";
import { NoteCard } from '@/components/NoteCard';
import { usePollFeed } from '@/hooks/usePollFeed';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const POLL_KIND = 1068;
const ZAP_POLL_KIND = 6969;
const INITIAL_LIMIT = 200;
const LOAD_MORE_INCREMENT = 100;

interface PollListFeedProps {
  filter?: 'all' | 'zap' | 'regular';
  searchQuery?: string;
  className?: string;
}

/**
 * Fetch poll events from default relays + BAO poll relays and render them
 * as a standard note list.
 */
export function PollListFeed({ filter = 'all', searchQuery = '', className }: PollListFeedProps) {
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
    return polls.filter((poll) => {
      if (poll.content.toLowerCase().includes(q)) return true;
      return poll.tags.some(([name, , label]) =>
        (name === 'option' || name === 'poll_option') && label?.toLowerCase().includes(q)
      );
    });
  }, [polls, searchQuery]);

  if (isLoading) {
    return (
      <div className={cn('space-y-4 py-4', className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
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
    <div className={cn('space-y-4 py-4', className)}>
      {filteredPolls.map((poll) => (
        <NoteCard key={poll.id} event={poll} />
      ))}
      {canLoadMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimit((prev) => prev + LOAD_MORE_INCREMENT)}
          >
            Load more polls
          </Button>
        </div>
      )}
    </div>
  );
}
