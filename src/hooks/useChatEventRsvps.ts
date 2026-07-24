import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { useToast } from "@/hooks/useToast";
import {
  buildRsvpTags,
  KIND_CALENDAR_RSVP,
  parseRsvpStatus,
  relayRejectionMessage,
  type RsvpStatus,
} from "@/lib/nip29";

import type { NostrEvent } from "@nostrify/nostrify";

export interface EventRsvps {
  /** Pubkeys grouped by their latest RSVP status. */
  accepted: string[];
  declined: string[];
  tentative: string[];
  /** The current user's latest status, if they've RSVP'd. */
  mine?: RsvpStatus;
}

const EMPTY: EventRsvps = { accepted: [], declined: [], tentative: [] };

/**
 * RSVPs (NIP-52 kind 31925) for one calendar event, scoped to its group. Reads
 * every member's RSVP from the group's host relay, keeping each author's latest
 * status, and exposes a mutation to set the current user's RSVP. The RSVP is
 * addressable (stable `d` derived from the event coordinate) so re-RSVPing
 * replaces the prior one.
 */
export function useEventRsvps(params: {
  relayUrl: string | undefined;
  groupId: string | undefined;
  eventCoord: string | undefined;
  eventId?: string;
  eventAuthor?: string;
}) {
  const { relayUrl, groupId, eventCoord, eventId, eventAuthor } = params;
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();

  const queryKey = ["nip29", "rsvps", relayUrl, eventCoord, user?.pubkey ?? ""];

  const query = useQuery<EventRsvps>({
    queryKey,
    queryFn: async ({ signal }) => {
      const events = await nostr.relay(relayUrl!).query(
        [{ kinds: [KIND_CALENDAR_RSVP], "#a": [eventCoord!], "#h": [groupId!], limit: 500 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
      );

      // Keep each author's newest RSVP.
      const latest = new Map<string, NostrEvent>();
      for (const event of events) {
        const existing = latest.get(event.pubkey);
        if (!existing || existing.created_at < event.created_at) latest.set(event.pubkey, event);
      }

      const out: EventRsvps = { accepted: [], declined: [], tentative: [] };
      for (const event of latest.values()) {
        const status = parseRsvpStatus(event);
        if (!status) continue;
        out[status].push(event.pubkey);
        if (user && event.pubkey === user.pubkey) out.mine = status;
      }
      return out;
    },
    enabled: Boolean(relayUrl && groupId && eventCoord),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const rsvp = useMutation({
    mutationFn: async (status: RsvpStatus) => {
      return publishEvent({
        kind: KIND_CALENDAR_RSVP,
        content: "",
        tags: buildRsvpTags({ groupId: groupId!, eventCoord: eventCoord!, eventId, eventAuthor, status }),
        relay: relayUrl,
      });
    },
    onMutate: async (status) => {
      // Optimistically reflect the new status.
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<EventRsvps>(queryKey) ?? EMPTY;
      if (user) {
        const strip = (list: string[]) => list.filter((p) => p !== user.pubkey);
        const next: EventRsvps = {
          accepted: strip(prev.accepted),
          declined: strip(prev.declined),
          tentative: strip(prev.tentative),
          mine: status,
        };
        next[status] = [...next[status], user.pubkey];
        queryClient.setQueryData<EventRsvps>(queryKey, next);
      }
      return { prev };
    },
    onError: (err, _status, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast({
        title: "RSVP failed",
        description: relayRejectionMessage(err),
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const data = query.data ?? EMPTY;

  return {
    accepted: data.accepted,
    declined: data.declined,
    tentative: data.tentative,
    /** The current user's status, if any. */
    myStatus: data.mine,
    isLoading: query.isLoading,
    setRsvp: (status: RsvpStatus) => rsvp.mutateAsync(status),
    isSettingRsvp: rsvp.isPending,
  };
}
