import { Pin, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuthor } from "@/hooks/useAuthor";
import { useEvent } from "@/hooks/useEvent";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { cn } from "@/lib/utils";

/** One row in the pinned-messages bar: a clickable preview + optional unpin. */
function PinnedRow({
  eventId,
  relayUrl,
  canModerate,
  onJump,
  onUnpin,
}: {
  eventId: string;
  relayUrl: string;
  canModerate: boolean;
  onJump: (id: string) => void;
  onUnpin: (id: string) => void;
}) {
  const { data: event } = useEvent(eventId, [relayUrl]);
  const author = useAuthor(event?.pubkey);
  const scopedName = useScopedDisplayName(event?.pubkey, author.data?.metadata);
  const displayName = event ? scopedName : "";
  const preview = event
    ? event.content.replace(/https?:\/\/\S+/g, "📎").trim() || "📎"
    : "Pinned message";

  return (
    <div className="group/pin flex items-start gap-2 min-w-0 rounded-md px-2 py-1.5 hover:bg-secondary/60">
      <button
        type="button"
        onClick={() => onJump(eventId)}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
      >
        {event && (
          <span className="text-[11px] font-semibold text-primary truncate max-w-full">
            {displayName}
          </span>
        )}
        <span className="text-[12px] text-muted-foreground line-clamp-2 break-words">
          {preview}
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 touch:h-9 shrink-0 px-2 touch:px-3 text-[11px] text-muted-foreground hover:text-primary"
            onClick={() => onJump(eventId)}
          >
            Jump
          </Button>
        </TooltipTrigger>
        <TooltipContent>Jump to message</TooltipContent>
      </Tooltip>
      {canModerate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Unpin message"
              className="size-6 touch:size-10 shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover/pin:opacity-100 touch:opacity-100 focus-visible:opacity-100 transition-opacity"
              onClick={() => onUnpin(eventId)}
            >
              <X className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Unpin</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface PinnedMessagesBarProps {
  open: boolean;
  pinnedIds: string[];
  relayUrl: string;
  canModerate: boolean;
  /** Scroll a message into view in the timeline (provided by GroupChat). */
  onJump: (id: string) => void;
  onUnpin: (id: string) => void;
  onClose: () => void;
}

/**
 * A bar that slides open below the channel header to browse the group's pinned
 * messages. Each row links to jump to the message; admins/mods can unpin.
 * Animates its height open/closed; collapses to zero when there's nothing to
 * show.
 */
export function PinnedMessagesBar({
  open,
  pinnedIds,
  relayUrl,
  canModerate,
  onJump,
  onUnpin,
  onClose,
}: PinnedMessagesBarProps) {
  const expanded = open && pinnedIds.length > 0;

  return (
    <div
      className={cn(
        "shrink-0 mx-2 overflow-hidden transition-all duration-300 ease-in-out",
        expanded ? "mt-2 max-h-72 opacity-100" : "mt-0 max-h-0 opacity-0",
      )}
      aria-hidden={!expanded}
    >
      <div className="clip-corner-lg bg-chrome px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            <Pin className="size-3 text-amber-500" />
            Pinned messages
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close pinned messages"
            className="size-6 touch:size-10 text-muted-foreground"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
          {pinnedIds.map((id) => (
            <PinnedRow
              key={id}
              eventId={id}
              relayUrl={relayUrl}
              canModerate={canModerate}
              onJump={onJump}
              onUnpin={onUnpin}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
