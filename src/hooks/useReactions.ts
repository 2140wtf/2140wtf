import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEventStore } from "@/hooks/useEventStore";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { KIND_DELETE, KIND_REACTION } from "@/lib/nip29";

import type { MessageReactions } from "@/components/chat/transport";
import type { NostrEvent } from "@nostrify/nostrify";

/**
 * A NIP-25 reaction, identified by its display emoji. A `+` or empty content
 * is normalized to 👍 and `-` to 👎; custom NIP-30 emoji keep their
 * `:shortcode:` form and carry the image URL from the reaction's `emoji` tag.
 */
export interface ReactionTally {
  /** The normalized reaction key (emoji, 👍/👎, or `:shortcode:`). */
  key: string;
  /** Custom emoji image URL when the key is a `:shortcode:`. */
  url?: string;
  /** Number of distinct pubkeys that reacted with this key. */
  count: number;
  /** The distinct pubkeys that reacted with this key, in reaction order. */
  pubkeys: string[];
  /** Whether the current user reacted with this key. */
  mine: boolean;
  /** The current user's reaction event id for this key (used to retract it). */
  mineEventId?: string;
}

export interface ReactInput {
  /** The display key being toggled (emoji, 👍/👎, or `:shortcode:`). */
  key: string;
  /** Raw content to publish (e.g. `+`, the emoji, or `:shortcode:`). */
  content: string;
  /** Custom emoji image URL when reacting with a `:shortcode:`. */
  emojiUrl?: string;
  /**
   * When set, remove the user's prior reaction (by its event id) instead of
   * adding a new one — publishes a NIP-09 kind-5 deletion targeting it.
   */
  mineEventId?: string;
}

/**
 * NIP-30 custom-emoji tag for a reaction: when the content is a `:shortcode:`
 * with an image URL, the pill renders the image via an `["emoji", code, url]`
 * tag. Native/unicode reactions carry no extra tag. Shared by NIP-29 group
 * reactions and Concord so both build the tag identically.
 */
export function customEmojiReactionTags(content: string, emojiUrl?: string): string[][] {
  if (emojiUrl && content.startsWith(":") && content.endsWith(":")) {
    return [["emoji", content.slice(1, -1), emojiUrl]];
  }
  return [];
}

/** Normalize a kind 7 reaction's content into a display key. */
export function reactionKey(event: NostrEvent): string {
  return reactionContentKey(event.content);
}

/** Normalize raw reaction content into a display key (`+`/`` → 👍, `-` → 👎). */
export function reactionContentKey(content: string): string {
  if (content === "+" || content === "") return "👍";
  if (content === "-") return "👎";
  return content;
}

/** Tally a flat list of reaction events into per-key tallies for one message. */
function tallyReactions(reactions: NostrEvent[], userPubkey: string | undefined): ReactionTally[] {
  // One reaction per (pubkey, key); the latest event wins.
  const latest = new Map<string, NostrEvent>();
  for (const reaction of reactions) {
    const key = `${reaction.pubkey}:${reactionKey(reaction)}`;
    const existing = latest.get(key);
    if (!existing || reaction.created_at > existing.created_at) {
      latest.set(key, reaction);
    }
  }

  const byKey = new Map<string, ReactionTally>();
  for (const reaction of latest.values()) {
    const key = reactionKey(reaction);
    const url = reaction.tags.find(([n]) => n === "emoji")?.[2];
    const tally = byKey.get(key) ?? { key, url, count: 0, pubkeys: [], mine: false };
    tally.count += 1;
    tally.pubkeys.push(reaction.pubkey);
    if (url && !tally.url) tally.url = url;
    if (userPubkey && reaction.pubkey === userPubkey) {
      tally.mine = true;
      tally.mineEventId = reaction.id;
    }
    byKey.set(key, tally);
  }

  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

/** Shared empty tally array so a message with no reactions keeps a stable prop. */
const EMPTY_TALLIES: ReactionTally[] = [];

function reactionsKey(relayUrl: string | undefined, groupId: string | undefined) {
  return ["nip29", "reactions", relayUrl, groupId] as const;
}

/**
 * Load and toggle NIP-25 reactions (kind 7) for a whole NIP-29 group in ONE
 * batched query, keyed by the ids of the messages currently in view.
 *
 * This replaces the previous per-message `useReactions` fan-out (one relay
 * query + one live subscription PER rendered message — 50 messages meant 50
 * queries). Mirroring Concord's `useConcordReactions`, we fetch every reaction
 * referencing the loaded messages in a single `#e` query, tally them into a
 * `Map<messageId, ReactionTally[]>`, and expose a `reactionsFor(id)` accessor
 * that returns the shared {@link MessageReactions} shape per row.
 *
 * Local-first like {@link useGroupMessages}: the store (NostrBatcher mirrors
 * every reaction the relay ever returned into IndexedDB) is read immediately so
 * reactions paint with the timeline, then a background relay refresh + a single
 * live subscription keep them current.
 */
export function useGroupReactions(
  relayUrl: string | undefined,
  groupId: string | undefined,
  messageIds: string[],
  opts?: {
    /**
     * The react-query cache key holding this room's message list, used to
     * resolve a reaction's target event at click time. Defaults to the NIP-29
     * messages key; Buzz channels pass their own (see useBuzzMessages).
     */
    messagesKey?: readonly unknown[];
  },
): { reactionsFor: (id: string) => MessageReactions } {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const eventStore = useEventStore();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const queryKey = reactionsKey(relayUrl, groupId);

  // The set of message ids to resolve reactions for. Sorted + joined so the
  // effect/query deps are a stable primitive (not a fresh array each render).
  const idsSig = useMemo(() => [...messageIds].sort().join(","), [messageIds]);

  // All reactions in this group, keyed by message id. A single query for the
  // whole visible window instead of one per message.
  const reactionsQuery = useQuery<Map<string, NostrEvent[]>>({
    queryKey,
    queryFn: async ({ signal }) => {
      const ids = idsSig ? idsSig.split(",") : [];
      if (!relayUrl || !groupId || ids.length === 0) return new Map();
      const store = await eventStore;

      // A generous cap so each per-id index cursor stops early instead of being
      // walked to exhaustion (NIndexedDB stops a cursor at `limit` matches), so
      // the scan cost scales with the window, not the whole reaction history.
      const limit = ids.length * 20;

      // 1. LOCAL-FIRST: read mirrored reactions out of IndexedDB immediately.
      const cached = await store.query([{ kinds: [KIND_REACTION], "#e": ids, limit }]);

      // 2. BACKGROUND refresh from the relay (NOT awaited — never gates render).
      void (async () => {
        if (signal.aborted) return;
        try {
          const fresh = await nostr.relay(relayUrl).query(
            [{ kinds: [KIND_REACTION], "#e": ids, limit }],
            { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
          );
          if (signal.aborted || fresh.length === 0) return;
          queryClient.setQueryData<Map<string, NostrEvent[]>>(queryKey, (old) =>
            mergeReactions(old, fresh),
          );
        } catch {
          // Best-effort; the local-first result already rendered.
        }
      })();

      return groupReactionsByTarget(cached);
    },
    enabled: Boolean(relayUrl && groupId) && Boolean(idsSig),
    staleTime: 15_000,
  });

  // One live subscription for the whole group (replaces one-per-message).
  useEffect(() => {
    if (!relayUrl || !groupId || !idsSig) return;
    const ids = idsSig.split(",");
    const controller = new AbortController();

    (async () => {
      try {
        for await (const msg of nostr.relay(relayUrl).req(
          [{ kinds: [KIND_REACTION], "#e": ids, since: Math.floor(Date.now() / 1000) - 5 }],
          { signal: controller.signal },
        )) {
          if (msg[0] !== "EVENT") continue;
          const event = msg[2] as NostrEvent;
          queryClient.setQueryData<Map<string, NostrEvent[]>>(queryKey, (old) =>
            mergeReactions(old, [event]),
          );
        }
      } catch {
        // Subscription ended (abort or relay closed).
      }
    })();

    return () => controller.abort();
    // queryKey is derived from relayUrl + groupId, both already deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nostr, relayUrl, groupId, idsSig, queryClient]);

  const react = useMutation({
    mutationFn: async ({ target, content, emojiUrl, mineEventId }: { target: NostrEvent } & ReactInput) => {
      if (mineEventId) {
        // Removing: publish a NIP-09 kind-5 deletion of the user's prior
        // reaction event. The store self-applies NIP-09 (same-author delete),
        // so the reaction is removed from the local cache immediately; the
        // relay enforces author-only deletion on its side.
        await createEvent({
          kind: KIND_DELETE,
          content: "",
          tags: [
            ["e", mineEventId],
            ["k", String(KIND_REACTION)],
            ["h", groupId!],
          ],
          relay: relayUrl,
        });
      } else {
        const tags: string[][] = [
          ["e", target.id],
          ["p", target.pubkey],
          ["k", String(target.kind)],
          ["h", groupId!],
          ...customEmojiReactionTags(content, emojiUrl),
        ];
        await createEvent({ kind: KIND_REACTION, content, tags, relay: relayUrl });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Per-message tallies, derived once from the batched reaction map.
  const talliesById = useMemo(() => {
    const out = new Map<string, ReactionTally[]>();
    const map = reactionsQuery.data;
    if (!map) return out;
    for (const [targetId, reactions] of map) {
      out.set(targetId, tallyReactions(reactions, user?.pubkey));
    }
    return out;
  }, [reactionsQuery.data, user?.pubkey]);

  // Stable `react` closures + `MessageReactions` objects per id, so a row whose
  // tally didn't change keeps a stable `reactions` prop (preserving React.memo).
  // The mutation's `mutate` identity churns each render, so we hold it in a ref
  // and read it at click time rather than capturing it in the closure.
  const reactRef = useRef(react.mutate);
  reactRef.current = react.mutate;
  const reactCache = useRef(new Map<string, (input: ReactInput) => void>());
  const objCache = useRef(new Map<string, { tallies: ReactionTally[]; value: MessageReactions }>());

  const messagesKey = opts?.messagesKey ?? ["nip29", "messages", relayUrl, groupId];
  const reactionsFor = useCallback(
    (id: string): MessageReactions => {
      const tallies = talliesById.get(id) ?? EMPTY_TALLIES;
      const hit = objCache.current.get(id);
      if (hit && hit.tallies === tallies) return hit.value;
      let fn = reactCache.current.get(id);
      if (!fn) {
        // Resolve the target event from the messages cache lazily at click time.
        const reactFn = (input: ReactInput) => {
          const messages =
            queryClient.getQueryData<NostrEvent[]>(messagesKey) ?? [];
          const target = messages.find((m) => m.id === id);
          if (!target) return;
          reactRef.current({ target, ...input });
        };
        reactCache.current.set(id, (fn = reactFn));
      }
      const value: MessageReactions = { tallies, react: fn };
      objCache.current.set(id, { tallies, value });
      return value;
    },
    // messagesKey is an array literal at the call site; its parts are covered
    // by relayUrl/groupId at every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [talliesById, queryClient, relayUrl, groupId],
  );

  return { reactionsFor };
}

/** Bucket a flat reaction list into `target id → reactions`. */
function groupReactionsByTarget(reactions: NostrEvent[]): Map<string, NostrEvent[]> {
  const out = new Map<string, NostrEvent[]>();
  for (const r of reactions) {
    const target = r.tags.find(([n]) => n === "e")?.[1];
    if (!target) continue;
    const list = out.get(target);
    if (list) list.push(r);
    else out.set(target, [r]);
  }
  return out;
}

/** Merge new reactions into an existing target→reactions map (de-duped by id). */
function mergeReactions(
  old: Map<string, NostrEvent[]> | undefined,
  incoming: NostrEvent[],
): Map<string, NostrEvent[]> {
  const next = new Map<string, NostrEvent[]>();
  if (old) for (const [k, v] of old) next.set(k, [...v]);
  for (const r of incoming) {
    const target = r.tags.find(([n]) => n === "e")?.[1];
    if (!target) continue;
    const list = next.get(target);
    if (!list) {
      next.set(target, [r]);
    } else if (!list.some((e) => e.id === r.id)) {
      list.push(r);
    }
  }
  return next;
}
