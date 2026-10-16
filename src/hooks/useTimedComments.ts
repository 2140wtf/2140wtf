import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useComments } from '@/hooks/useComments';
import { getCommentPosition, type TimedComment } from '@/lib/timedComments';

/**
 * Returns the timed (position-anchored) comments on an audio/video event,
 * sorted by playback position.
 *
 * Reuses the standard comment query so the timeline shares one cache with the
 * comment sheet, then keeps only kind 1111 comments carrying a valid
 * `position` tag. Replies are included when they carry a position (a reply
 * can be anchored to a moment just like a top-level comment).
 */
export function useTimedComments(root: NostrEvent | undefined) {
  const { data, isLoading, dataUpdatedAt } = useComments(root, 500);

  const comments = useMemo<TimedComment[]>(() => {
    // `dataUpdatedAt === 0` means the query never resolved — show nothing
    // rather than a stale/empty timeline from an unrelated render pass.
    if (dataUpdatedAt === 0) return [];
    const all = data?.allComments ?? [];
    const seen = new Set<string>();
    const timed: TimedComment[] = [];
    for (const event of all) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      const position = getCommentPosition(event);
      if (position === undefined) continue;
      timed.push({ event, position });
    }
    return timed.sort((a, b) => a.position - b.position);
  }, [data?.allComments, dataUpdatedAt]);

  return { comments, isLoading };
}
