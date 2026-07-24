/**
 * Foreground-notification feed.
 *
 * The wire's ingest ({@link ingestWireEvents}) is the single choke point every
 * live event flows through — once, on every transport (web socket, APK drain,
 * APK live feed). Rather than have the page's foreground notifier re-read the
 * stores and re-derive "what's new" (racing the very writes ingest just made),
 * ingest hands the notifier the events it just decoded, in-memory and fully
 * decrypted, and the notifier decides what (if anything) to surface.
 *
 * A single sink is registered by `useForegroundNotifications` (web/desktop
 * only). Native has its own background service and does not register. When no
 * sink is registered these are cheap no-ops, so ingest never branches on it.
 */

/** A candidate the notifier may surface, normalized across planes. */
export interface NotifyCandidate {
  /** Which plane the message arrived on. */
  plane: "nip29" | "dm" | "c1" | "c2";
  /** Author pubkey (hex). Empty for planes where it isn't recovered (V1). */
  author: string;
  /** Unix seconds the message was created. */
  createdAt: number;
  /**
   * Whether this event `p`-tags the current user (a mention). DMs are always
   * treated as directed at the user, so this is irrelevant there. Always false
   * for V1 (sealed at ingest — mentions can't be detected without decrypt).
   */
  mention: boolean;
  /**
   * Whether this is a reaction (kind 7) to one of the current user's own
   * messages. Only ever set for a reaction that `p`-tags the user; a reaction
   * to someone else's message is never a candidate. Shapes the notification as
   * "reacted to your message" and gates on the `reactions` pref / level.
   */
  reaction?: boolean;
  /**
   * The reaction emoji / shortcode (normalized: `+`→👍, `-`→👎), for the
   * "Reacted X to your message" body. Set only when `reaction` is true.
   */
  reactionEmoji?: string;
  /** The real event kind (NIP-29 kind, 4 for DM, decrypted rumor kind for c2). */
  kind: number;
  /**
   * Plaintext body when safely available (NIP-29 chat, decrypted c2 rumor).
   * Undefined for encrypted DMs and sealed V1 outers.
   */
  body?: string;
  /**
   * The active-room key for the conversation this belongs to (matches the
   * shapes in activeRooms.ts), so the notifier can suppress an on-screen room.
   * Some planes leave this for the notifier hook to fill in once it resolves
   * the relay/community the event belongs to:
   *   - NIP-29 group: `h:<relayUrl>|<groupId>`
   *   - Concord V1:   `z:<pseudonym>` (per held epoch)
   *   - Concord V2:   `c2:<channelIdHex>`
   *   - DM:           `dm:<peerPubkey>`
   */
  roomKey: string;
  /** The read-state key (matches useReadState key shapes) for unread gating. */
  readKey: string;
  /** In-app router path a tap should navigate to (may be filled by the hook). */
  path: string;
  /** NIP-29 relay URL (for mute gating); set only for `plane === "nip29"`. */
  relayUrl?: string;
  /** NIP-29 group id (for mute gating); set only for `plane === "nip29"`. */
  groupId?: string;
  /** Concord V2 channel id hex; set only for `plane === "c2"`. */
  channelIdHex?: string;
  /** Concord V1 channel id hex; set only for `plane === "c1"`. */
  v1ChannelIdHex?: string;
  /** DM peer pubkey; set only for `plane === "dm"`. */
  peer?: string;
}

export type NotifySink = (candidates: NotifyCandidate[]) => void;

let sink: NotifySink | undefined;

/** Register the foreground notifier's sink. Returns an unregister. */
export function registerNotifySink(next: NotifySink): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = undefined;
  };
}

/** Feed candidates to the registered sink (no-op when none). */
export function feedNotifyCandidates(candidates: NotifyCandidate[]): void {
  if (!sink || candidates.length === 0) return;
  try {
    sink(candidates);
  } catch {
    // The notifier must never break ingest.
  }
}
