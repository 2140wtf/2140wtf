import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useNostrPublish } from "@/hooks/useNostrPublish";
import { useToast } from "@/hooks/useToast";
import {
  buildPublicCalendarEventTags,
  type CalendarEvent,
  type CalendarEventInput,
  KIND_DELETE,
  relayRejectionMessage,
} from "@/lib/nip29";

import type { NostrEvent } from "@nostrify/nostrify";

/**
 * Create/update/delete mutations for PUBLIC NIP-52 calendar events (kinds
 * 31922/31923, no group `h` tag). Published to the author's normal write
 * relays so every events client (plektos, coracle, …) can discover them.
 * Addressable: updating re-publishes with the same `d` identifier.
 */
export function usePublicCalendarEvents() {
  const queryClient = useQueryClient();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();

  const invalidate = () => {
    // The events feed is a useFeed query over kinds 31922/31923 — invalidate
    // broadly so the new/updated event surfaces without a reload.
    queryClient.invalidateQueries({ queryKey: ["feed"] });
    queryClient.invalidateQueries({ queryKey: ["nostr"] });
  };

  const save = useMutation({
    mutationFn: async ({ input, prev }: { input: CalendarEventInput; prev?: NostrEvent }) => {
      return publishEvent({
        kind: input.kind,
        content: input.description ?? "",
        tags: buildPublicCalendarEventTags(input),
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
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (event: CalendarEvent) => {
      return publishEvent({
        kind: KIND_DELETE,
        content: "",
        tags: [
          ["e", event.event.id],
          ["a", `${event.kind}:${event.event.pubkey}:${event.identifier}`],
          ["k", String(event.kind)],
        ],
      });
    },
    onError: (err) => {
      toast({
        title: "Couldn't delete event",
        description: relayRejectionMessage(err),
        variant: "destructive",
      });
    },
    onSettled: invalidate,
  });

  return {
    /** Create a new event, or update an existing one (pass its raw event as `prev`). */
    save: (input: CalendarEventInput, prev?: NostrEvent) => save.mutateAsync({ input, prev }),
    isSaving: save.isPending,
    /** Delete an event (NIP-09 kind 5). */
    remove: (event: CalendarEvent) => remove.mutateAsync(event),
    isRemoving: remove.isPending,
  };
}
