import { CalendarClock, CalendarDays, Clock, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { EventDetailDialog } from "@/components/chat/CalendarEventCard";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isUpcoming } from "@/hooks/useCalendarEvents";
import { type CalendarEvent, formatCalendarEventWhen, KIND_CALENDAR_TIME } from "@/lib/nip29";
import { cn } from "@/lib/utils";

/** One row in the events bar: a clickable preview + optional delete. */
function EventRow({
  event,
  canModerate,
  onOpen,
  onDelete,
}: {
  event: CalendarEvent;
  canModerate: boolean;
  onOpen: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
}) {
  const past = !isUpcoming(event);
  return (
    <div className="group/event flex items-start gap-2 min-w-0 rounded-md px-2 py-1.5 hover:bg-secondary/60">
      <div className={cn("mt-0.5 shrink-0 text-amber-500", past && "text-muted-foreground")}>
        {event.kind === KIND_CALENDAR_TIME ? <Clock className="size-4" /> : <CalendarDays className="size-4" />}
      </div>
      <button
        type="button"
        onClick={() => onOpen(event)}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
      >
        <span className={cn("text-[12px] font-semibold text-foreground truncate max-w-full", past && "text-muted-foreground")}>
          {event.title}
        </span>
        <span className="text-[11px] text-muted-foreground truncate max-w-full">
          {formatCalendarEventWhen(event)}
        </span>
      </button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 touch:h-9 shrink-0 px-2 touch:px-3 text-[11px] text-muted-foreground hover:text-primary"
        onClick={() => onOpen(event)}
      >
        RSVP
      </Button>
      {canModerate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete event"
              className="size-6 touch:size-10 shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover/event:opacity-100 touch:opacity-100 focus-visible:opacity-100 transition-opacity"
              onClick={() => onDelete(event)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete event</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface CalendarEventsBarProps {
  open: boolean;
  events: CalendarEvent[];
  relayUrl: string;
  groupId: string;
  canModerate: boolean;
  onClose: () => void;
  onCreate: () => void;
  onDelete: (event: CalendarEvent) => void;
}

/**
 * A bar that slides open below the channel header to browse a group's calendar
 * events. Mirrors PinnedMessagesBar: animates open/closed, lists upcoming
 * events first, opens a detail/RSVP dialog per row, and lets admins/mods create
 * and delete.
 */
export function CalendarEventsBar({
  open,
  events,
  relayUrl,
  groupId,
  canModerate,
  onClose,
  onCreate,
  onDelete,
}: CalendarEventsBarProps) {
  const [detail, setDetail] = useState<CalendarEvent | undefined>(undefined);

  // Upcoming first (soonest first, already sorted), then past (most recent first).
  const upcoming = events.filter((e) => isUpcoming(e));
  const past = events.filter((e) => !isUpcoming(e)).reverse();
  const ordered = [...upcoming, ...past];

  const expanded = open;

  return (
    <>
      <div
        className={cn(
          "shrink-0 mx-2 overflow-hidden transition-all duration-300 ease-in-out",
          expanded ? "mt-2 max-h-80 opacity-100" : "mt-0 max-h-0 opacity-0",
        )}
        aria-hidden={!expanded}
      >
        <div className="clip-corner-lg bg-chrome px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              <CalendarClock className="size-3 text-amber-500" />
              Events
            </span>
            <div className="flex items-center gap-1">
              {canModerate && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 touch:h-9 gap-1 px-2 touch:px-3 text-[11px] text-muted-foreground hover:text-primary"
                  onClick={onCreate}
                >
                  <Plus className="size-3.5" />
                  New event
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close events"
                className="size-6 touch:size-10 text-muted-foreground"
                onClick={onClose}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-0.5 pr-0.5">
            {ordered.length === 0 ? (
              <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                No events scheduled{canModerate ? " — create one above." : "."}
              </p>
            ) : (
              ordered.map((event) => (
                <EventRow
                  key={`${event.kind}:${event.event.pubkey}:${event.identifier}`}
                  event={event}
                  canModerate={canModerate}
                  onOpen={setDetail}
                  onDelete={onDelete}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <EventDetailDialog
        relayUrl={relayUrl}
        groupId={groupId}
        event={detail}
        open={Boolean(detail)}
        onOpenChange={(o) => { if (!o) setDetail(undefined); }}
      />
    </>
  );
}
