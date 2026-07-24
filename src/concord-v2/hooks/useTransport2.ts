import { useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  useChannelTimeline2,
  useMessageActions2,
  useSendMessage2,
  useSendStatus2,
} from "@/concord-v2/hooks/useChannel2";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { customEmojiReactionTags } from "@/hooks/useReactions";
import { KIND_COMMENT, KIND_DELETE, KIND_EDIT, KIND_REACTION, KIND_ZAP } from "@/concord-v2/lib/kinds";
import { markReactionDeleted, type OpenedChat } from "@/concord-v2/lib/chat";
import { channelKey } from "@/concord-v2/hooks/useChannel2";
import { zapRumorTags, type ZapTally } from "@/lib/zaps";
import type { ChannelV2, CommunityV2 } from "@/concord-v2/lib/types";

import { stableZapsFor, toChatMsg } from "@/components/chat/transport";
import type { ChatMsg, ChatTransport, MessageReactions, ReactInput, ReactionTally, ZapPayment } from "@/components/chat/transport";

/** Shared empty tally array, so messages with no reactions keep a stable prop. */
const EMPTY_TALLIES: ReactionTally[] = [];

/** Shared empty reply array, so a thread with no replies keeps a stable reference. */
const EMPTY_REPLIES: ChatMsg[] = [];

/**
 * The thread-root rumor id a message belongs to, or undefined for a top-level
 * message. Threaded replies are NIP-22 kind-1111 comments carrying an uppercase
 * `E` root tag. A kind-9 `q` tag is an INLINE reply (rendered in the timeline,
 * not a thread), so it is NOT a thread root here.
 */
function replyRootOf(m: ChatMsg): string | undefined {
  return m.kind === KIND_COMMENT ? m.tags.find((t) => t[0] === "E")?.[1] : undefined;
}

/** Adapt a decrypted V2 chat event to the shared `ChatMsg` shape. */
export function openedToChatMsg(m: OpenedChat): ChatMsg {
  return toChatMsg({
    id: m.rumorId,
    pubkey: m.author,
    created_at: Math.floor(m.ms / 1000),
    kind: m.kind,
    tags: m.tags,
    content: m.content,
  });
}

/**
 * Build a {@link ChatTransport} for one Concord V2 channel — V2's binding to
 * the SAME chat components NIP-29, DMs, and Concord V1 render through. Only
 * the transport (CORD-01 streams vs relay kind-9 vs V1 `#z` envelopes)
 * differs.
 */
export function useTransport2(
  community: CommunityV2 | undefined,
  channel: ChannelV2 | undefined,
  canWrite: boolean,
  canModerate: boolean,
): {
  transport: ChatTransport;
  reactionsFor: (id: string) => MessageReactions;
  /** The full decoded message list (member enumeration, reply resolution). */
  allMessages: ChatMsg[];
} {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { folded, isLoading, loadOlder, hasMore, isLoadingOlder } = useChannelTimeline2(community, channel);
  const { mutateAsync: send } = useSendMessage2(community, channel);
  const { retry, discard, deleteMessage } = useMessageActions2(community, channel);
  const sendStatus = useSendStatus2(channel);

  // Identity-cached ChatMsg adaptation (unchanged rows keep their reference so
  // React.memo skips them across polls).
  const adaptCache = useRef(new Map<string, { sig: string; msg: ChatMsg }>());
  const messages = useMemo<ChatMsg[]>(() => {
    const cache = adaptCache.current;
    const next = new Map<string, { sig: string; msg: ChatMsg }>();
    const out = folded.messages.map((m) => {
      const sig = `${m.kind}\u0000${m.ms}\u0000${m.content}`;
      const hit = cache.get(m.rumorId);
      const entry = hit && hit.sig === sig ? hit : { sig, msg: openedToChatMsg(m) };
      next.set(m.rumorId, entry);
      return entry.msg;
    });
    adaptCache.current = next;
    return out;
  }, [folded.messages]);

  // Threading: a THREAD reply is a sealed NIP-22 kind-1111 comment carrying an
  // uppercase `E` thread-root tag. Slack-style, thread replies are NOT shown
  // top-level — they're nested under their root in the thread panel. An INLINE
  // reply (kind-9 with a `q` tag) is NOT a thread reply: it renders as an
  // ordinary timeline row with a "replying to …" line, so it's never bucketed
  // here. Split the decoded list into top-level messages (the timeline) and
  // thread replies bucketed by root id (the threads).
  //
  // ORPHAN replies (root not in the loaded window) are kept in repliesByRoot,
  // NOT degraded to top-level. They're reachable from the Threads tab, which
  // shows a tombstone for the missing root. When the root eventually loads
  // (backfill / decode), the reply stays bucketed under it and the tombstone
  // is replaced by the real root message.
  const { topLevel, repliesByRoot } = useMemo(() => {
    const topLevel: ChatMsg[] = [];
    const repliesByRoot = new Map<string, ChatMsg[]>();
    for (const m of messages) {
      const root = replyRootOf(m);
      if (root) {
        const list = repliesByRoot.get(root) ?? [];
        list.push(m);
        repliesByRoot.set(root, list);
      } else {
        topLevel.push(m);
      }
    }
    for (const list of repliesByRoot.values()) list.sort((a, b) => a.created_at - b.created_at);
    return { topLevel, repliesByRoot };
  }, [messages]);

  const replyCountFor = useCallback((id: string) => repliesByRoot.get(id)?.length ?? 0, [repliesByRoot]);
  const threadRepliesFor = useCallback(
    (rootId: string): ChatMsg[] => repliesByRoot.get(rootId) ?? EMPTY_REPLIES,
    [repliesByRoot],
  );
  const sendThreadReply = useCallback(
    async (root: ChatMsg, content: string, tags: string[][]) => {
      // Seal the reply as a NIP-22 kind-1111 comment; the thread pointers are
      // derived from `root` inside `send` (via `replyTo`). Drop the composer's
      // NIP-29 `h` and any `e`/`q` tags (a `q` here would be an inline quote, not
      // the thread link), mirroring the page's `handleSend`.
      const extraTags = tags.filter(([name]) => name !== "h" && name !== "e" && name !== "q");
      await send({
        content,
        replyTo: { id: root.id, kind: root.kind, pubkey: root.pubkey, tags: root.tags },
        extraTags,
      });
    },
    [send],
  );

  // Reaction tallies adapted to the shared shape.
  const talliesById = useMemo(() => {
    const out = new Map<string, ReactionTally[]>();
    for (const [targetId, byEmoji] of folded.reactions) {
      const tallies: ReactionTally[] = [];
      for (const [emoji, entry] of byEmoji) {
        const mine = Boolean(user && entry.reactors.has(user.pubkey));
        tallies.push({
          key: emoji,
          url: entry.url,
          count: entry.reactors.size,
          pubkeys: [...entry.reactors.keys()],
          mine,
          mineEventId: mine ? entry.reactors.get(user!.pubkey) : undefined,
        });
      }
      tallies.sort((a, b) => b.count - a.count);
      out.set(targetId, tallies);
    }
    return out;
  }, [folded.reactions, user]);

  const channelIdHex = channel?.idHex ?? null;

  // Author lookup by rumor id, so a reaction can carry a NIP-25 `p` tag for the
  // reacted-to author (mirroring the NIP-29 path). Invisible to the relay: the
  // tag lives on the NIP-44-encrypted rumor, never promoted to the wrap.
  const authorById = useMemo(() => {
    const out = new Map<string, string>();
    for (const m of messages) out.set(m.id, m.pubkey);
    return out;
  }, [messages]);

  const reactionsFor = useMemo(() => {
    const reactCache = new Map<string, (input: ReactInput) => void>();
    const reactFor = (id: string) => {
      let fn = reactCache.get(id);
      if (!fn) {
        fn = (input: ReactInput) => {
          if (input.mineEventId) {
            // Removing: mark the reaction as deleted IMMEDIATELY so the fold
            // skips it on the next render (before the kind-5 delete rumor is
            // even sealed). Also strip it from the query cache so the fold
            // doesn't see it at all.
            markReactionDeleted(input.mineEventId);
            queryClient.setQueryData<OpenedChat[]>(channelKey(channelIdHex), (old = []) =>
              old.filter((m) => m.rumorId !== input.mineEventId),
            );
            // Seal + publish the kind-5 delete rumor (the store's NIP-09
            // removes it durably; the mark above handles the optimistic case).
            void send({
              content: "",
              kind: KIND_DELETE,
              target: input.mineEventId,
              targetKind: KIND_REACTION,
            }).catch(() => {});
          } else {
            void send({
              content: input.content,
              kind: KIND_REACTION,
              target: id,
              targetPubkey: authorById.get(id),
              extraTags: customEmojiReactionTags(input.content, input.emojiUrl),
            }).catch(() => {});
          }
        };
        reactCache.set(id, fn);
      }
      return fn;
    };
    const objCache = new Map<string, { tallies: ReactionTally[]; value: MessageReactions }>();
    return (id: string): MessageReactions => {
      const tallies = talliesById.get(id) ?? EMPTY_TALLIES;
      const hit = objCache.get(id);
      if (hit && hit.tallies === tallies) return hit.value;
      const value: MessageReactions = { tallies, react: reactFor(id) };
      objCache.set(id, { tallies, value });
      return value;
    };
  }, [talliesById, send, queryClient, channelIdHex, authorById]);

  // CORD.md zap tallies from the fold (only VERIFIED zaps ever reach it).
  const zapTalliesById = useMemo(() => {
    const out = new Map<string, ZapTally>();
    for (const [targetId, entries] of folded.zaps) {
      if (entries.length === 0) continue;
      const zaps = [...entries].sort((a, b) => b.sats - a.sats);
      out.set(targetId, {
        totalSats: zaps.reduce((sum, z) => sum + z.sats, 0),
        count: zaps.length,
        mine: Boolean(user && zaps.some((z) => z.pubkey === user.pubkey)),
        zaps,
      });
    }
    return out;
  }, [folded.zaps, user]);

  const zapsFor = useMemo(() => stableZapsFor((id) => zapTalliesById.get(id)), [zapTalliesById]);

  // Seal the CORD.md zap announcement into the channel: a kind-9735 rumor
  // carrying the payment proof, published through the ordinary send path (the
  // `e` target rides `send`'s target param; binding tags are added there).
  const sendZap = useCallback(
    async (target: ChatMsg, payment: ZapPayment) => {
      if (!payment.preimage) throw new Error("A private zap needs its payment proof.");
      await send({
        content: payment.comment,
        kind: KIND_ZAP,
        target: target.id,
        extraTags: zapRumorTags({
          targetId: target.id,
          targetKind: target.kind,
          recipient: target.pubkey,
          amountMsats: payment.amountMsats,
          bolt11: payment.bolt11,
          preimage: payment.preimage,
          omitTarget: true, // send() adds the e target itself
        }),
      });
    },
    [send],
  );

  // Concord edit: a kind-3302 rumor targeting the original message's rumor
  // id. The fold applies the latest author-matching edit (non-destructive —
  // the original keeps its id, so reactions, replies, and quotes stay intact).
  const editMessage = useCallback(
    async (original: ChatMsg, content: string) => {
      const trimmed = content.trim();
      if (!trimmed || trimmed === original.content.trim()) return;
      await send({
        content: trimmed,
        kind: KIND_EDIT,
        target: original.id,
        targetKind: original.kind,
      });
    },
    [send],
  );

  const transport = useMemo<ChatTransport>(
    () => ({
      messages: topLevel,
      isLoading,
      canWrite,
      canModerate,
      isRumor: true,
      loadOlder,
      hasMore,
      isLoadingOlder,
      sendStatusFor: (id: string) => sendStatus[id],
      retry: (event: ChatMsg) => retry(event.id),
      discard,
      deleteMessage: (event: ChatMsg) => deleteMessage(event.id),
      editMessage,
      replyCountFor,
      reactionsFor,
      zapsFor,
      sendZap,
      threadRepliesFor,
      sendThreadReply,
    }),
    [topLevel, isLoading, canWrite, canModerate, loadOlder, hasMore, isLoadingOlder, sendStatus, retry, discard, deleteMessage, editMessage, replyCountFor, reactionsFor, zapsFor, sendZap, threadRepliesFor, sendThreadReply],
  );

  return { transport, reactionsFor, allMessages: messages };
}
