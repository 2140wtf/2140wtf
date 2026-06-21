import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { ZapDialog } from '@/components/ZapDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { cn } from '@/lib/utils';
import { getZapPollOptions } from '@/lib/zapPoll';
import type { NostrEvent } from '@nostrify/nostrify';

interface ZapPollVoteButtonProps {
  event: NostrEvent;
  compact?: boolean;
}

/**
 * Action-bar button for kind 6969 "zap to vote" polls.
 *
 * Opens an option selector, then launches the normal ZapDialog pre-filled
 * with the selected `poll_option` so the payment is recorded as a vote.
 */
export function ZapPollVoteButton({ event, compact }: ZapPollVoteButtonProps) {
  const { user } = useCurrentUser();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [zapDialogOpen, setZapDialogOpen] = useState(false);

  const options = useMemo(() => getZapPollOptions(event.tags), [event.tags]);

  // Only meaningful for logged-in users looking at a zap poll with options.
  if (!user || event.kind !== 6969 || options.length === 0) {
    return null;
  }

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectorOpen(true);
  };

  const handleConfirm = () => {
    if (!selectedOption) return;
    setSelectorOpen(false);
    setZapDialogOpen(true);
  };

  const handleSelectorOpenChange = (open: boolean) => {
    setSelectorOpen(open);
    if (!open) setSelectedOption(null);
  };

  const handleZapDialogOpenChange = (open: boolean) => {
    setZapDialogOpen(open);
    if (!open) setSelectedOption(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          'flex items-center gap-1.5 rounded-full transition-colors',
          'text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10',
          compact ? 'p-1.5 sm:p-2' : 'p-2',
        )}
        title="Zap to vote"
      >
        <Zap className={compact ? 'size-[18px] sm:size-5' : 'size-5'} />
        <span
          className={cn(
            'text-sm font-medium hidden',
            compact ? 'lg:inline' : 'sm:inline',
          )}
        >
          Zap to vote
        </span>
      </button>

      <Dialog open={selectorOpen} onOpenChange={handleSelectorOpenChange}>
        <DialogContent className="max-w-[420px] rounded-2xl p-0 gap-0 border-border overflow-hidden [&>button]:hidden">
          <DialogHeader className="px-4 h-12 border-b border-border flex flex-row items-center justify-between">
            <DialogTitle className="text-base font-semibold">Zap to vote</DialogTitle>
          </DialogHeader>

          <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
            {options.map((opt) => {
              const isSelected = selectedOption === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedOption(opt.id)}
                  className={cn(
                    'w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors',
                    isSelected
                      ? 'border-amber-500 bg-amber-500/10 font-semibold'
                      : 'border-border hover:bg-secondary/40',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="p-4 border-t border-border">
            <Button
              onClick={handleConfirm}
              disabled={!selectedOption}
              className="w-full inline-flex items-center gap-2 bg-amber-500 text-white hover:bg-amber-500/90 disabled:opacity-50"
            >
              <Zap className="size-4" />
              Zap to vote
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {selectedOption && (
        <ZapDialog
          target={event}
          open={zapDialogOpen}
          onOpenChange={handleZapDialogOpenChange}
          pollOption={selectedOption}
        />
      )}
    </>
  );
}
