import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { ToastAction } from "@/components/ui/toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNotifLevels, type NotifLevel } from "@/hooks/useNotifLevels";
import { toast } from "@/hooks/useToast";
import { isRoomActive } from "@/lib/activeRooms";
import { registerNotifySink } from "@/wire/notify";

/**
 * useForegroundNotifications (₿AO chat / Concord V2)
 *
 * Surfaces incoming Concord V2 community messages as in-app toasts while the
 * app is open. The wire's ingest hands every live, fully-decrypted event to
 * the registered sink exactly once ({@link registerNotifySink}), so this hook
 * only decides what to surface — no store reads, no re-derivation.
 * Toast copy is deliberately generic: sender identity, room names, message or
 * task text, and reaction content are never rendered on the ambient surface.
 *
 * Gating (all must pass to notify):
 *   - the conversation's resolved notification level (Discord-style
 *     all/mentions/nothing via `useNotifLevels`, which is also what the
 *     community/channel mutes write) admits this message;
 *   - the channel isn't the one currently on screen (`isRoomActive`);
 *   - it's newer than this session's start AND newer than the last thing we
 *     notified for that room (so a backfill / re-ingest never re-alerts).
 *
 * Only the `c2` plane is handled: DMs (NIP-17/NIP-104) and NIP-29 groups have
 * their own surfaces, and the native app uses its background service instead.
 */

/** Whether a candidate is admitted by a resolved notification level. */
function levelAdmits(level: NotifLevel, mention: boolean): boolean {
  if (level === "nothing") return false;
  if (level === "mentions") return mention;
  return true; // "all"
}

export function useForegroundNotifications(): void {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { concordChannelLevel } = useNotifLevels();

  // Refs so the (stable) sink reads current values without re-registering on
  // every render — a re-register would drop the wire's reference to the sink.
  const ctx = useRef({ concordChannelLevel, navigate });
  ctx.current = { concordChannelLevel, navigate };

  // Session floor: never notify for anything older than the moment the notifier
  // mounted (a fresh login backfilling weeks of history must stay silent).
  const sessionFloor = useRef(Math.floor(Date.now() / 1000));
  // Per-room high-water mark of what we've already notified, so overlapping
  // transports / re-ingests don't double-alert.
  const lastNotified = useRef(new Map<string, number>());

  useEffect(() => {
    if (!user) return;

    const unregister = registerNotifySink((candidates) => {
      const c = ctx.current;

      for (const cand of candidates) {
        if (cand.plane !== "c2") continue; // only Concord V2 communities
        if (cand.createdAt <= sessionFloor.current) continue;
        if (!cand.path || !cand.channelIdHex) continue; // no community route resolved

        // Recover the community id from the route (`/bao/c/<communityId>/<channel>`)
        // to resolve the per-channel level.
        const parts = cand.path.split("/");
        const communityId = parts[3] ? decodeURIComponent(parts[3]) : "";
        if (!communityId) continue;

        // Notification-level gate — this also covers muted communities and
        // muted channels, which are the `nothing` end of the level cascade.
        const level = c.concordChannelLevel("c2", communityId, cand.channelIdHex);
        if (!levelAdmits(level, cand.mention)) continue;

        // On-screen suppression: the room the user is looking at.
        if (isRoomActive(cand.roomKey)) continue;

        // Dedupe against what we've already surfaced for this room.
        const mark = lastNotified.current.get(cand.roomKey) ?? 0;
        if (cand.createdAt <= mark) continue;
        lastNotified.current.set(cand.roomKey, cand.createdAt);

        const path = cand.path;
        toast({
          title: "Encrypted community activity",
          description: cand.reaction
            ? "Someone reacted to your message"
            : cand.mention
              ? "You were mentioned"
              : "New message",
          action: (
            <ToastAction altText="Open encrypted community" onClick={() => c.navigate(path)}>
              Open
            </ToastAction>
          ),
        });
      }
    });

    return unregister;
  }, [user]);
}
