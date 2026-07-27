import { CalendarDays, Clock, Globe, Loader2, MapPin } from "lucide-react";
import { useState } from "react";

import { ChromeDialogContent, Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePublicCalendarEvents } from "@/hooks/usePublicCalendarEvents";
import { toast } from "@/hooks/useToast";
import { useGeocode } from "@/components/roadstr/useGeocode";
import { encodeGeohash } from "@/lib/geohash";
import {
  KIND_CALENDAR_DATE,
  KIND_CALENDAR_TIME,
  randomCalendarId,
  type CalendarEventInput,
} from "@/lib/nip29";

interface CreateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Today's date as YYYY-MM-DD (local), for the date input's default/min. */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Combine a date input value and a time input value into a unix timestamp string. */
function toTimestamp(date: string, time: string): string {
  const ms = new Date(`${date}T${time || "00:00"}`).getTime();
  return String(Math.floor(ms / 1000));
}

/**
 * Public NIP-52 event composer (kinds 31922/31923). Publishes to the author's
 * normal write relays so any events client can discover it. Location is a
 * free-form string; a plain-URL location renders as "online" in clients that
 * distinguish the two.
 */
export function CreateEventDialog({ open, onOpenChange }: CreateEventDialogProps) {
  const { user } = useCurrentUser();
  const { save, isSaving } = usePublicCalendarEvents();

  const [mode, setMode] = useState<"time" | "date">("time");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(todayLocal());
  const [startTime, setStartTime] = useState("18:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  /** Geohash picked from a geocode suggestion; cleared when the user edits the text. */
  const [geohash, setGeohash] = useState<string | undefined>(undefined);
  const [image, setImage] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [description, setDescription] = useState("");

  const geocode = useGeocode();

  const reset = () => {
    setTitle("");
    setStartDate(todayLocal());
    setStartTime("18:00");
    setEndDate("");
    setEndTime("");
    setLocation("");
    setGeohash(undefined);
    setImage("");
    setHashtags("");
    setDescription("");
    geocode.setQuery("");
  };

  const canSubmit = Boolean(user && title.trim() && startDate);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const kind = mode === "time" ? KIND_CALENDAR_TIME : KIND_CALENDAR_DATE;

    const input: CalendarEventInput = {
      identifier: randomCalendarId(),
      kind,
      title: title.trim(),
      start: kind === KIND_CALENDAR_TIME ? toTimestamp(startDate, startTime) : startDate,
      description: description.trim() || undefined,
      image: image.trim() || undefined,
      location: location.trim() || undefined,
      geohash,
      hashtags: hashtags
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean),
    };
    if (kind === KIND_CALENDAR_TIME) {
      if (endDate) input.end = toTimestamp(endDate, endTime);
      input.startTzid = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } else if (endDate) {
      input.end = endDate;
    }

    try {
      await save(input);
      toast({ title: "Event published", description: input.title });
      reset();
      onOpenChange(false);
    } catch {
      // usePublicCalendarEvents already toasts the relay error.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChromeDialogContent title="Create event">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-5 text-primary" />
            <h2 className="chrome-dialog-title font-bold tracking-tight">Create event</h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Pizza day meetup"
              maxLength={140}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Format</Label>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as "time" | "date")}
              className="justify-start"
            >
              <ToggleGroupItem value="time" className="gap-1.5">
                <Clock className="size-3.5" />
                Date &amp; time
              </ToggleGroupItem>
              <ToggleGroupItem value="date" className="gap-1.5">
                <CalendarDays className="size-3.5" />
                All-day
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="event-start-date">Starts</Label>
              <Input
                id="event-start-date"
                type="date"
                value={startDate}
                min={todayLocal()}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            {mode === "time" && (
              <div className="space-y-2">
                <Label htmlFor="event-start-time">Time</Label>
                <Input
                  id="event-start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="event-end-date">Ends (optional)</Label>
              <Input
                id="event-end-date"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            {mode === "time" && endDate && (
              <div className="space-y-2">
                <Label htmlFor="event-end-time">End time</Label>
                <Input
                  id="event-end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-location">Location</Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                id="event-location"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  // Editing the text invalidates a previously picked pin; the
                  // geocoder re-searches unless it's an online link.
                  setGeohash(undefined);
                  geocode.setQuery(e.target.value.trim().startsWith("https://") ? "" : e.target.value);
                }}
                placeholder="Venue, address, or a https:// link for online events"
                className="pl-9"
                maxLength={200}
              />
            </div>
            {location.trim().startsWith("https://") ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Globe className="size-3" /> This will show as an online event.
              </p>
            ) : geohash ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3" /> Pinned to the map.
              </p>
            ) : (
              geocode.results.length > 0 && (
                <div className="rounded-md border bg-popover divide-y divide-border overflow-hidden">
                  {geocode.results.map((r) => (
                    <button
                      key={`${r.lat},${r.lon},${r.name}`}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-secondary/60 transition-colors"
                      onClick={() => {
                        setLocation(r.name);
                        setGeohash(encodeGeohash(r.lat, r.lon, 9));
                        geocode.setQuery("");
                      }}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              )
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-image">Cover image URL (optional)</Label>
            <Input
              id="event-image"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="https://…"
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-tags">Hashtags (optional)</Label>
            <Input
              id="event-tags"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="bitcoin, meetup"
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-description">Description</Label>
            <Textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's happening?"
              rows={4}
              maxLength={5000}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit || isSaving}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : "Publish event"}
            </Button>
          </div>

          {!user && (
            <p className="text-xs text-muted-foreground text-center">
              Sign in to publish events.
            </p>
          )}
        </div>
      </ChromeDialogContent>
    </Dialog>
  );
}
