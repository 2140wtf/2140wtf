import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { KIND_USER_EMOJIS } from "@/lib/selfSyncKinds";

import type { NostrEvent } from "@nostrify/nostrify";

/** NIP-30 emoji set (a shareable pack). */
export const KIND_EMOJI_SET = 30030;

/** The addressable coordinate of an emoji pack: `30030:pubkey:dtag`. */
export function emojiPackCoord(pubkey: string, identifier: string): string {
  return `${KIND_EMOJI_SET}:${pubkey}:${identifier}`;
}

/**
 * Whether the current user's kind 10030 list already references the emoji pack
 * at `coord` (`30030:pubkey:dtag`). Read-only; shares the custom-emoji cache
 * so it invalidates when a pack is added.
 */
export function useHasEmojiPack(coord: string | undefined): boolean {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const { data } = useQuery({
    queryKey: ["emoji-pack-refs", user?.pubkey ?? ""],
    queryFn: async ({ signal }) => {
      if (!user) return [] as string[];
      const events = await nostr.query(
        [{ kinds: [KIND_USER_EMOJIS], authors: [user.pubkey], limit: 1 }],
        { signal },
      );
      const list = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!list) return [] as string[];
      return list.tags.filter((t) => t[0] === "a" && t[1]).map((t) => t[1]);
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  return !!coord && (data?.includes(coord) ?? false);
}

/**
 * Add a NIP-30 emoji pack (kind 30030) to the current user's emoji list
 * (kind 10030) by appending its `["a", "30030:pubkey:dtag"]` coordinate.
 *
 * Kind 10030 is a public NIP-51 list, so no encryption is needed. The freshest
 * list is fetched first so we append rather than overwrite, and the pack's
 * relay hint (if any) is carried on the `a` tag. On success both the emoji-pack
 * ref cache and the merged custom-emoji cache are invalidated so the new pack's
 * emojis become usable immediately.
 */
export function useAddEmojiPack(): UseMutationResult<
  void,
  Error,
  { pubkey: string; identifier: string; relay?: string }
> {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const queryClient = useQueryClient();
  const publish = useNostrPublish();

  return useMutation({
    mutationFn: async ({ pubkey, identifier, relay }) => {
      if (!user) throw new Error("Sign in to add an emoji pack.");

      const coord = emojiPackCoord(pubkey, identifier);

      // Fetch the freshest list so we append rather than clobber it.
      const events = await nostr.group(config.appRelays).query(
        [{ kinds: [KIND_USER_EMOJIS], authors: [user.pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(6000) },
      );
      const prev = events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
      const tags: string[][] = prev ? prev.tags.map((t) => [...t]) : [];

      // Already added? Nothing to do.
      if (tags.some((t) => t[0] === "a" && t[1] === coord)) return;

      tags.push(relay ? ["a", coord, relay] : ["a", coord]);

      await publish.mutateAsync({
        kind: KIND_USER_EMOJIS,
        content: prev?.content ?? "",
        tags,
        prev: prev ?? undefined,
      });

      void queryClient.invalidateQueries({ queryKey: ["emoji-pack-refs"] });
      void queryClient.invalidateQueries({ queryKey: ["custom-emojis"] });
    },
  });
}

/** Extract the `["emoji", shortcode, url]` mappings from a kind 30030 event. */
export function emojiPackEntries(event: NostrEvent): { shortcode: string; url: string }[] {
  return event.tags
    .filter((t) => t[0] === "emoji" && t[1] && t[2])
    .map((t) => ({ shortcode: t[1], url: t[2] }));
}

/** The pack's human name (`title` tag), falling back to its `d` identifier. */
export function emojiPackName(event: NostrEvent): string {
  return (
    event.tags.find((t) => t[0] === "title")?.[1] ||
    event.tags.find((t) => t[0] === "d")?.[1] ||
    "Emoji pack"
  );
}
