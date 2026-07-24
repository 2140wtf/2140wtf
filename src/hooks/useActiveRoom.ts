import { useEffect } from "react";

import { setActiveRooms as setWebActiveRooms } from "@/lib/activeRooms";
import { BaoNotification, isNativeRuntime } from "@/lib/nativeNotifications";

/**
 * Tell the native background notification service which room(s) the WebView is
 * currently showing, so it can suppress redundant notifications for that room
 * (the live `relayEvent`/`concordMessage` feed already paints the message in
 * the timeline).
 *
 * The roomKeys are the service's stable per-conversation identifiers (the same
 * shapes `enqueueRoomMessage` uses on the Java side):
 *   - NIP-29 group: `h:<relayUrl>|<groupId>`
 *   - Concord V1:   `z:<pseudonym>` (one per held epoch)
 *   - Concord V2:   `c2:<channelIdHex>`
 *   - DM:           `dm:<peerPubkey>`
 *
 * Thread-level keys (`<roomKey>:t:<rootId>`) suppress notifications for a
 * specific open thread panel. Mentions still notify even on an active room.
 *
 * The service holds the keys only on its live instance, so killing the app or
 * the service immediately resumes notifications — no persistence, no TTL.
 *
 * Re-publishes on `visibilitychange` so backgrounding the app (document
 * hidden) clears the active set and foregrounding restores it. Native-only for
 * the background SERVICE; on web/desktop it also mirrors the keys into the
 * in-process active-room registry ({@link setWebActiveRooms}) so the page's
 * foreground notifier (`useForegroundNotifications`) suppresses notifications
 * for the conversation on screen the same way.
 *
 * @param roomKeys stable conversation identifiers the WebView is currently
 *                 showing. When empty/undefined, the active set is cleared.
 */
export function useActiveRoom(...roomKeys: Array<string | string[] | undefined>): void {
  const keys = roomKeys
    .flat()
    .map((k) => (typeof k === "string" ? k.trim() : ""))
    .filter((k) => k.length > 0);

  const sig = keys.join("\u0001");

  // Unmount-only cleanup: clear the active set when the component truly
  // unmounts (navigates away from the chat screen). This is a SEPARATE effect
  // with `[]` deps so it does NOT fire on every `sig` change — clearing on
  // every dependency change created a race window where the service briefly
  // had no active keys and let notifications through.
  useEffect(() => {
    return () => {
      setWebActiveRooms([]);
      if (isNativeRuntime()) {
        BaoNotification.setActiveRooms({ roomKeys: [] }).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    const publish = () => {
      const hidden = document.visibilityState === "hidden";
      const next = hidden ? [] : sig.split("\u0001").filter((k) => k.length > 0);
      // In-process (web/desktop foreground notifier) — cheap, always.
      setWebActiveRooms(next);
      // Native background service — only where it exists.
      if (isNativeRuntime()) {
        BaoNotification.setActiveRooms({ roomKeys: next }).catch((err) => {
          console.warn("[active-room] setActiveRooms failed:", err);
        });
      }
    };

    publish();
    document.addEventListener("visibilitychange", publish);
    return () => {
      document.removeEventListener("visibilitychange", publish);
    };
  }, [sig]);
}
