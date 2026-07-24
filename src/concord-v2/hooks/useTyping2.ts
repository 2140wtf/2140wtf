import { useNostr } from "@nostrify/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { KIND_SEAL_ENCRYPTED, KIND_TYPING, KIND_WRAP_EPHEMERAL } from "@/concord-v2/lib/kinds";
import { buildRumor, channelBindingTags, checkChannelBinding, openWrap, sealRumor, wrapSeal } from "@/concord-v2/lib/stream";
import type { ChannelV2, CommunityV2 } from "@/concord-v2/lib/types";

import type { NostrEvent } from "@nostrify/nostrify";

/** How long a typing signal is considered live. */
const TYPING_WINDOW_MS = 8000;
/** Minimum gap between published signals. */
const TYPING_THROTTLE_MS = 4000;

/**
 * Live "who is typing" for a V2 channel — the one EPHEMERAL action: a kind
 * 23311 rumor in a kind-21059 wrap at the channel's current address (CORD-02
 * Appendix B). Relays never store any layer, so this is subscription-only: a
 * live `req()` per relay feeds a decaying in-memory map.
 */
export function useTyping2(community: CommunityV2 | undefined, channel: ChannelV2 | undefined): string[] {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const [typers, setTypers] = useState<string[]>([]);
  const seen = useRef(new Map<string, number>());

  const channelIdHex = channel?.idHex ?? null;
  const currentPk = channel?.current.group.pk;

  useEffect(() => {
    seen.current = new Map();
    setTypers([]);
    if (!community || !channel || !channelIdHex || !currentPk) return;
    const controller = new AbortController();
    const group = channel.current.group;
    const epoch = channel.current.epoch;

    const recompute = () => {
      const now = Date.now();
      const live: string[] = [];
      for (const [pk, ms] of seen.current) {
        if (now - ms <= TYPING_WINDOW_MS) live.push(pk);
        else seen.current.delete(pk);
      }
      setTypers((prev) =>
        prev.length === live.length && prev.every((p, i) => p === live[i]) ? prev : live,
      );
    };

    const apply = (event: NostrEvent) => {
      try {
        const opened = openWrap(event, group);
        if (opened.kind !== KIND_TYPING) return;
        checkChannelBinding(opened, channelIdHex, epoch);
        if (user && opened.author === user.pubkey) return;
        if (Date.now() - opened.ms > TYPING_WINDOW_MS) return;
        const prev = seen.current.get(opened.author) ?? 0;
        if (opened.ms > prev) seen.current.set(opened.author, opened.ms);
        recompute();
      } catch {
        // not ours / malformed
      }
    };

    for (const url of community.relays) {
      void (async () => {
        try {
          for await (const msg of nostr.relay(url).req(
            [{ kinds: [KIND_WRAP_EPHEMERAL], authors: [currentPk] }],
            { signal: controller.signal },
          )) {
            if (msg[0] === "EVENT") apply(msg[2] as NostrEvent);
          }
        } catch {
          // subscription ended
        }
      })();
    }

    const decay = setInterval(recompute, TYPING_WINDOW_MS / 2);
    return () => {
      controller.abort();
      clearInterval(decay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nostr, community?.idHex, channelIdHex, currentPk, user?.pubkey]);

  return typers;
}

/** A throttled publisher for the current user's typing signal. */
export function useTypingPublisher2(community: CommunityV2 | undefined, channel: ChannelV2 | undefined) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const lastSent = useRef(0);

  return useCallback(() => {
    if (!user || !community || !channel) return;
    const now = Date.now();
    if (now - lastSent.current < TYPING_THROTTLE_MS) return;
    lastSent.current = now;

    void (async () => {
      try {
        const rumor = buildRumor({
          kind: KIND_TYPING,
          content: "",
          tags: channelBindingTags(channel.idHex, channel.current.epoch),
          pubkey: user.pubkey,
          ms: now,
        });
        const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, channel.current.group, user.signer);
        const wrap = wrapSeal(seal, channel.current.group, { ephemeral: true });
        await Promise.allSettled(
          community.relays.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(6000) })),
        );
      } catch {
        // best-effort; typing is ephemeral
      }
    })();
  }, [nostr, user, community, channel]);
}
