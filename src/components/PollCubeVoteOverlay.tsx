import { useCallback } from 'react';
import { X } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { PollContent } from '@/components/PollContent';
import { PollsViewContext } from '@/lib/pollsViewContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface PollCubeVoteOverlayProps {
  event: NostrEvent;
  onClose: () => void;
  className?: string;
}

/**
 * Text overlay that layers a poll's question and options in front of its cube.
 *
 * Renders the standard list-view poll UI so both regular (kind 1068) and zap
 * (kind 6969) polls get their native voting controls while the cube stays
 * visible underneath.
 */
export function PollCubeVoteOverlay({ event, onClose, className }: PollCubeVoteOverlayProps) {
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.currentTarget === e.target) onClose();
    },
    [onClose],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'absolute inset-0 z-30 flex flex-col rounded-xl overflow-hidden',
        'bg-background/95 backdrop-blur-sm border border-border shadow-lg',
        className,
      )}
      onClick={handleBackdropClick}
    >
      <div className="flex items-center justify-between px-3 h-11 border-b border-border shrink-0">
        <span className="text-sm font-semibold">
          {event.kind === 6969 ? 'Zap to vote' : 'Vote'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 -mr-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4" onClick={(e) => e.stopPropagation()}>
          <PollsViewContext.Provider value="list">
            <PollContent event={event} />
          </PollsViewContext.Provider>
        </div>
      </ScrollArea>
    </div>
  );
}
