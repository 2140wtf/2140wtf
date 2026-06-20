import { BarChart3, Clock, Zap } from 'lucide-react';

import { HostedPollCube } from '@/components/HostedPollCube';
import { NoteContent } from '@/components/NoteContent';
import { cn } from '@/lib/utils';
import type { NostrEvent } from '@nostrify/nostrify';

function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

interface PollContentProps {
  event: NostrEvent;
  expanded?: boolean;
}

/**
 * Render a poll as a BAO-hosted interactive cube.
 *
 * The cube is loaded from BAO's embed endpoint, so it always matches the
 * BAO-branded live cube view (questions, options, votes, BAO logo, etc.).
 */
export function PollContent({ event, expanded = false }: PollContentProps) {
  const isZapPoll = event.kind === 6969;
  const pollType = getTag(event.tags, 'polltype') ?? 'singlechoice';
  const endsAt = getTag(event.tags, 'endsAt');
  const isExpired = endsAt ? Number(endsAt) < Math.floor(Date.now() / 1000) : false;

  return (
    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
      {/* Question */}
      <div className="text-[15px] leading-relaxed font-medium break-words">
        <NoteContent event={event} />
      </div>

      {/* Poll type + expiry badges */}
      <div className="flex items-center gap-2 mt-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
          {isZapPoll ? <Zap className="size-3 text-amber-500" /> : <BarChart3 className="size-3" />}
          {isZapPoll ? 'Zap poll' : pollType === 'multiplechoice' ? 'Multiple choice' : 'Single choice'}
        </span>
        {isExpired && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
            <Clock className="size-3" />
            Ended
          </span>
        )}
      </div>

      {/* BAO hosted cube */}
      <HostedPollCube
        pollId={event.id}
        title={event.content}
        className={cn('mt-3', expanded ? 'h-[420px]' : 'h-[300px]')}
      />
    </div>
  );
}
