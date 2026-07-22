import { useState } from 'react';
import { Zap } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { HostedPollCube, type CubeThemeMode } from '@/components/HostedPollCube';
import { PollCubeVoteOverlay } from '@/components/PollCubeVoteOverlay';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PollCubeCardProps {
  poll: NostrEvent;
  title?: string;
  theme?: CubeThemeMode;
  className?: string;
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
 * A single poll cube on the /polls cube feed.
 *
 * Shows the hosted cube, the poll title, and a context-aware action button
 * ("Vote" or "Zap to Vote") that opens a text overlay with the question and
 * options layered in front of the cube.
 */
export function PollCubeCard({ poll, title, theme = 'light', className }: PollCubeCardProps) {
  const [overlayOpen, setOverlayOpen] = useState(false);

  const displayTitle = title ?? extractTitle(poll);
  const isZapPoll = poll.kind === 6969;
  const buttonLabel = isZapPoll ? 'Zap to Vote' : 'Vote';

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative">
        <HostedPollCube
          pollId={poll.id}
          title={displayTitle}
          event={poll}
          theme={theme}
          className="aspect-square min-h-[420px] max-h-[80vh]"
          showVoteButton={false}
        />
        {overlayOpen && <PollCubeVoteOverlay event={poll} onClose={() => setOverlayOpen(false)} />}
      </div>

      <div className="text-center px-2 space-y-2">
        <p className="text-sm font-bold line-clamp-2 leading-snug">{displayTitle}</p>
        <Button
          size="sm"
          onClick={() => setOverlayOpen(true)}
          className={cn(
            'gap-2',
            isZapPoll && 'bg-amber-500 text-white hover:bg-amber-500/90',
          )}
          title={buttonLabel}
        >
          {isZapPoll && <Zap className="size-4" />}
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}
