import { Calendar, CalendarDays, Check, Clock, HelpCircle, MapPin, X } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, ChromeDialogContent } from "@/components/ui/dialog";
import { useAuthor } from "@/hooks/useAuthor";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEventRsvps } from "@/hooks/useChatEventRsvps";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { appHashtagUrl } from "@/lib/dittoUrl";
import {
  type CalendarEvent,
  calendarEventCoord,
  formatCalendarEventWhen,
  KIND_CALENDAR_TIME,
  type RsvpStatus,
} from "@/lib/nip29";
import { cn } from "@/lib/utils";

/** A small stacked avatar row for a set of RSVP'd pubkeys. */
function AttendeeAvatars({ pubkeys, max = 5 }: { pubkeys: string[]; max?: number }) {
  const shown = pubkeys.slice(0, max);
  const extra = pubkeys.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((pk) => (
          <AttendeeAvatar key={pk} pubkey={pk} />
        ))}
      </div>
      {extra > 0 && <span className="ml-2 text-xs text-muted-foreground">+{extra}</span>}
    </div>
  );
}

function AttendeeAvatar({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const name = useScopedDisplayName(pubkey, author.data?.metadata);
  return (
    <Avatar className="size-6 ring-2 ring-background">
      <AvatarImage src={author.data?.metadata?.picture} alt={name} />
      <AvatarFallback className="bg-primary/20 text-primary text-[9px]">
        {name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

interface RsvpControlsProps {
  relayUrl: string;
  groupId: string;
  event: CalendarEvent;
}

/** Going / Maybe / Can't-go controls plus the current attendee tallies. */
export function RsvpControls({ relayUrl, groupId, event }: RsvpControlsProps) {
  const { user } = useCurrentUser();
  const coord = calendarEventCoord(event.kind, event.event.pubkey, event.identifier);
  const { accepted, declined, tentative, myStatus, setRsvp, isSettingRsvp } = useEventRsvps({
    relayUrl,
    groupId,
    eventCoord: coord,
    eventId: event.event.id,
    eventAuthor: event.event.pubkey,
  });

  const choose = (status: RsvpStatus) => {
    void setRsvp(status);
  };

  return (
    <div className="space-y-3">
      {user && (
        <div className="grid grid-cols-3 gap-2">
          <RsvpButton
            active={myStatus === "accepted"}
            icon={<Check className="size-4" />}
            label="Going"
            tone="success"
            disabled={isSettingRsvp}
            onClick={() => choose("accepted")}
          />
          <RsvpButton
            active={myStatus === "tentative"}
            icon={<HelpCircle className="size-4" />}
            label="Maybe"
            tone="muted"
            disabled={isSettingRsvp}
            onClick={() => choose("tentative")}
          />
          <RsvpButton
            active={myStatus === "declined"}
            icon={<X className="size-4" />}
            label="Can't go"
            tone="destructive"
            disabled={isSettingRsvp}
            onClick={() => choose("declined")}
          />
        </div>
      )}

      <div className="space-y-2 text-sm">
        {accepted.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{accepted.length} going</span>
            <AttendeeAvatars pubkeys={accepted} />
          </div>
        )}
        {tentative.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{tentative.length} maybe</span>
            <AttendeeAvatars pubkeys={tentative} />
          </div>
        )}
        {declined.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{declined.length} can't go</span>
            <AttendeeAvatars pubkeys={declined} />
          </div>
        )}
        {accepted.length === 0 && tentative.length === 0 && declined.length === 0 && (
          <p className="text-xs text-muted-foreground">No RSVPs yet.</p>
        )}
      </div>
    </div>
  );
}

function RsvpButton({
  active,
  icon,
  label,
  tone,
  disabled,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  tone: "success" | "muted" | "destructive";
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneActive =
    tone === "success"
      ? "bg-success text-success-foreground hover:bg-success/90"
      : tone === "destructive"
        ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
        : "bg-primary text-primary-foreground hover:bg-primary/90";
  const toneIdle =
    tone === "success"
      ? "bg-secondary/60 text-muted-foreground hover:bg-success/15 hover:text-success"
      : tone === "destructive"
        ? "bg-secondary/60 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
        : "bg-secondary/60 text-muted-foreground hover:bg-primary/15 hover:text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-center gap-1.5 clip-corner-lg px-2 py-2 text-xs font-medium transition-colors disabled:opacity-60",
        active ? toneActive : toneIdle,
      )}
    >
      {icon}
      {label}
    </button>
  );
}

interface EventDetailDialogProps {
  relayUrl: string;
  groupId: string;
  event: CalendarEvent | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Full detail view of a single calendar event with RSVP controls. */
export function EventDetailDialog({ relayUrl, groupId, event, open, onOpenChange }: EventDetailDialogProps) {
  const organizer = useAuthor(event?.event.pubkey);
  const organizerName = useScopedDisplayName(event?.event.pubkey, organizer.data?.metadata);

  if (!event) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChromeDialogContent title={event.title}>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center clip-corner-lg bg-primary/15 text-primary">
              {event.kind === KIND_CALENDAR_TIME ? <Clock className="size-5" /> : <CalendarDays className="size-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight break-words">{event.title}</h2>
              <p className="text-xs text-muted-foreground">Organized by {organizerName}</p>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="size-4 shrink-0" />
              <span>{formatCalendarEventWhen(event)}</span>
            </div>
            {event.location && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="size-4 shrink-0" />
                <span className="break-words">{event.location}</span>
              </div>
            )}
          </div>

          {event.description && (
            <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">{event.description}</p>
          )}

          {event.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {event.hashtags.map((t) => (
                <a
                  key={t}
                  href={appHashtagUrl(t)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  #{t}
                </a>
              ))}
            </div>
          )}

          <div className="border-t border-border/60 pt-4">
            <RsvpControls relayUrl={relayUrl} groupId={groupId} event={event} />
          </div>
        </div>
      </ChromeDialogContent>
    </Dialog>
  );
}
