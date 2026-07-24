import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { normalizeRelayUrl } from "@/lib/platform";

/**
 * NIP-17 DM relay list kind. A user publishes the relays where they want to
 * receive direct messages here; other clients read it to know where to send.
 * The list is a plain (unencrypted) replaceable event whose `relay` tags hold
 * the URLs.
 */
export const KIND_DM_RELAYS = 10050;

/** Extract the relay URLs from a kind-10050 event's `relay` tags. */
export function parseDmRelays(event: { tags: string[][] } | undefined): string[] {
  if (!event) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const [name, url] of event.tags) {
    if (name !== "relay" || !url) continue;
    const n = normalizeRelayUrl(url);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    urls.push(n);
  }
  return urls;
}

/**
 * Read and write the user's NIP-17 DM relay list (kind 10050).
 *
 * Used by Settings: when the user opts into "use my own DM relays" we seed the
 * editor from their existing published list (if any) rather than from the app
 * relays, and edits write the list back so it stays the canonical, discoverable
 * source of where their DMs live.
 */
export function useDmRelayList() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const queryKey = ["dm-relay-list", user?.pubkey];

  const query = useQuery<string[]>({
    queryKey,
    enabled: !!user?.pubkey,
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [{ kinds: [KIND_DM_RELAYS], authors: [user!.pubkey], limit: 1 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) },
      );
      const event = events.sort((a, b) => b.created_at - a.created_at)[0];
      return parseDmRelays(event);
    },
    staleTime: 60_000,
  });

  const publish = useMutation({
    mutationFn: async (relays: string[]) => {
      if (!user) throw new Error("Not logged in");
      const urls = relays
        .map((r) => normalizeRelayUrl(r))
        .filter((r): r is string => !!r);
      const tags = urls.map((url) => ["relay", url]);

      const event = await user.signer.signEvent({
        kind: KIND_DM_RELAYS,
        content: "",
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });

      queryClient.setQueryData<string[]>(queryKey, urls);
      await nostr.event(event, { signal: AbortSignal.timeout(8000) });
      return urls;
    },
  });

  return {
    /** The user's published DM relays (empty if they have none). */
    relays: query.data ?? [],
    isLoading: query.isLoading,
    /** Whether a 10050 list with at least one relay exists. */
    hasList: (query.data?.length ?? 0) > 0,
    refetch: query.refetch,
    /** Publish a new kind-10050 DM relay list. */
    publish: publish.mutateAsync,
  };
}

/**
 * Read another user's published kind-10050 DM relay list (NIP-17), so we can
 * deliver DMs to the relays where they actually read. Queried from the app
 * relays (where 10050 lists live), cached for an hour. Returns `[]` when the
 * peer has published no list — callers fall back to their own DM relays.
 *
 * This closes the cross-relay delivery gap: writing only to the *sender's*
 * relays silently fails when the peer doesn't read them. By unioning the peer's
 * published inbox relays into the write set, a message lands somewhere the
 * recipient is actually listening.
 */
export function useDmRelaysFor(peer: string | undefined): string[] {
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const relayKey = config.appRelays.join(",");

  const query = useQuery<string[]>({
    queryKey: ["dm-relay-list", "peer", peer, relayKey],
    enabled: !!peer,
    staleTime: 60 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const events = await nostr.group(config.appRelays).query(
        [{ kinds: [KIND_DM_RELAYS], authors: [peer!], limit: 1 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) },
      );
      const event = events.sort((a, b) => b.created_at - a.created_at)[0];
      return parseDmRelays(event);
    },
  });

  return query.data ?? [];
}
