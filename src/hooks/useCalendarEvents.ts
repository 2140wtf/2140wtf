import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useNostrPublish } from "@/hooks/useNostrPublish";
import { useToast } from "@/hooks/useToast";
import {
  buildCalendarEventTags,
  type CalendarEvent,
  type CalendarEventInput,
  KIND_CALENDAR_DATE,
  KIND_CALENDAR_TIME,
  KIND_DELETE,
  parseCalendarEvent,
  relayRejectionMessage,
} from "@/lib/nip29";

import type { NostrEvent } from "@nostrify/nostrify";

/** Sort key for a calendar event: start as an epoch second. */
function startEpoch(e: CalendarEvent): number {
  if (e.kind === KIND_CALENDAR_TIME) return Number(e.start) || 0;
  // Date-based: parse YYYY-MM-DD as UTC midnight.
  const ms = Date.parse(`${e.start}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

/** End of an event in epoch seconds, falling back to its start. */
function endEpoch(e: CalendarEvent): number {
  if (!e.end) return startEpoch(e);
  if (e.kind === KIND_CALENDAR_TIME) return Number(e.end) || startEpoch(e);
  const ms = Date.parse(`${e.end}T00:00:00Z`);
  return Number.isNaN(ms) ? startEpoch(e) : Math.floor(ms / 1000);
}

/** True if the event has not yet ended (upcoming or in progress). */
export function isUpcoming(e: CalendarEvent, now = Math.floor(Date.now() / 1000)): boolean {
  return endEpoch(e) >= now;
}

/**
 * A group's NIP-52 calendar events (kinds 31922/31923). Queries the group's
 * host relay (group traffic stays on one relay) and exposes create/update and
 * delete mutations, gated relay-side to admins/moderators. Events are
 * addressable, so the newest event per (author, kind, `d`) wins; the list is
 * sorted soonest-first.
 */
export function useCalendarEvents(relayUrl: string | undefined, groupId: string | undefined) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();

  const queryKey = ["nip29", "calendar", relayUrl, groupId];

  const query = useQuery<CalendarEvent[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const events = await nostr.relay(relayUrl!).query(
        // `#h` routes the query into the group's DB (relay29 only serves
        // filters carrying an h/e/a/ids selector). Both calendar kinds in one
        // filter.
        [{ kinds: [KIND_CALENDAR_DATE, KIND_CALENDAR_TIME], "#h": [groupId!], limit: 200 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
      );

      // Addressable: keep the newest event per (author, kind, d).
      const newest = new Map<string, NostrEvent>();
      for (const event of events) {
        const d = event.tags.find(([n]) => n === "d")?.[1] ?? "";
        const coord = `${event.kind}:${event.pubkey}:${d}`;
        const existing = newest.get(coord);
        if (!existing || existing.created_at < event.created_at) newest.set(coord, event);
      }

      const parsed: CalendarEvent[] = [];
      for (const event of newest.values()) {
        const c = parseCalendarEvent(event);
        if (c) parsed.push(c);
      }
      parsed.sort((a, b) => startEpoch(a) - startEpoch(b));
      return parsed;
    },
    enabled: Boolean(relayUrl && groupId),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const events = query.data ?? [];

  const save = useMutation({
    mutationFn: async ({ input, prev }: { input: CalendarEventInput; prev?: NostrEvent }) => {
      return publishEvent({
        kind: input.kind,
        content: input.description ?? "",
        tags: buildCalendarEventTags(groupId!, input),
        relay: relayUrl,
        prev,
      });
    },
    onError: (err) => {
      toast({
        title: "Couldn't save event",
        description: relayRejectionMessage(err),
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const remove = useMutation({
    mutationFn: async (event: CalendarEvent) => {
      return publishEvent({
        kind: KIND_DELETE,
        content: "",
        tags: [
          ["e", event.event.id],
          ["k", String(event.kind)],
          ["h", groupId!],
        ],
        relay: relayUrl,
      });
    },
    onError: (err) => {
      toast({
        title: "Couldn't delete event",
        description: relayRejectionMessage(err),
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    events,
    isLoading: query.isLoading,
    /** Create a new event, or update an existing one (pass its raw event as `prev`). */
    save: (input: CalendarEventInput, prev?: NostrEvent) => save.mutateAsync({ input, prev }),
    isSaving: save.isPending,
    /** Delete an event (NIP-09 kind 5, author/moderator only per the relay). */
    remove: (event: CalendarEvent) => remove.mutateAsync(event),
    isRemoving: remove.isPending,
  };
}
