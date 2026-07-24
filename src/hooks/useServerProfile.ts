import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import {
  buildServerProfileTags,
  KIND_LABEL,
  parseServerProfile,
  SERVER_PROFILE_NAMESPACE,
  type ServerProfile,
} from "@/lib/nip29";

/** Query key for a user's per-server self-profile on one relay. */
function serverProfileKey(relayUrl: string | undefined, pubkey: string | undefined) {
  return ["server-profile", relayUrl ?? "", pubkey ?? ""] as const;
}

/**
 * Read a user's per-server nickname/label for a single relay (server).
 *
 * These are NIP-32 kind-1985 self-labels (see `lib/nip29.ts`). The value is
 * scoped to one relay by *convention enforced in this client*: we query ONLY
 * the target relay and only accept events whose `r` tag matches it, so a
 * nickname set on one server never bleeds into another. (A signed label event
 * is public, so this is a client convention, not a cryptographic guarantee.)
 */
export function useServerProfile(relayUrl: string | undefined, pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<ServerProfile | null>({
    queryKey: serverProfileKey(relayUrl, pubkey),
    enabled: Boolean(relayUrl && pubkey),
    queryFn: async ({ signal }) => {
      const events = await nostr.relay(relayUrl!).query(
        [{
          kinds: [KIND_LABEL],
          authors: [pubkey!],
          "#L": [SERVER_PROFILE_NAMESPACE],
          "#r": [relayUrl!],
        }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
      );

      // Newest matching self-label wins.
      const newest = events
        .map((event) => ({ event, profile: parseServerProfile(event, pubkey!, relayUrl!) }))
        .filter((x) => x.profile)
        .sort((a, b) => b.event.created_at - a.event.created_at)[0];

      return newest?.profile ?? null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * Publish/replace the current user's per-server nickname + label for a relay.
 * Passing empty strings clears the corresponding field. The event is published
 * ONLY to the target relay (never fanned out to app relays), keeping the value
 * confined to its server.
 */
export function useUpdateServerProfile(relayUrl: string | undefined) {
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profile: { nickname?: string; label?: string; color?: string }) => {
      if (!user) throw new Error("You must be logged in to set a server nickname.");
      if (!relayUrl) throw new Error("No server selected.");

      const tags = buildServerProfileTags(user.pubkey, relayUrl, profile);

      await publish({ kind: KIND_LABEL, content: "", tags, relay: relayUrl });

      const next: ServerProfile = {
        relay: relayUrl,
        nickname: profile.nickname?.trim() || undefined,
        label: profile.label?.trim() || undefined,
        color: profile.color?.trim() || undefined,
      };
      return next;
    },
    onSuccess: (next) => {
      if (!user) return;
      queryClient.setQueryData(serverProfileKey(relayUrl, user.pubkey), next);
    },
  });
}
