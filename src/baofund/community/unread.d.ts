/**
 * unread — local read-position tracking (§7, NO wire change). Final-boss
 * H1: MentionInbox covered @-mentions only; a standalone chat needs
 * per-room unread counts over ALL messages.
 *
 * Privacy posture matches the rest of the library: read state NEVER touches
 * the wire. The tracker folds scroll positions (msg_id order in the merged
 * scroll) behind an injected KvStore — same pattern as notify.ts — so host
 * apps persist badges across restarts without leaking anything.
 */
import type { MergedMessage } from './merge.js';
import type { KvStore } from './notify.js';
export interface UnreadState {
    /** Last seen message key (`author:msg_id` dedup keys), insertion-ordered. */
    seen: string[];
}
export interface UnreadReport {
    /** Messages after the last read position (oldest first). */
    unread: MergedMessage[];
    count: number;
    /** true when the room had no prior read position (first open). */
    firstRead: boolean;
}
/**
 * Per-agent-per-room unread tracker. Feed merged scrolls; it reports what
 * arrived since the last markRead and persists the read position.
 */
export declare class UnreadTracker {
    private readonly store?;
    private readonly state;
    private loaded;
    constructor(store?: KvStore);
    private storageKey;
    private load;
    private persist;
    /**
     * Fold a scroll: returns every non-redacted message whose dedup key was
     * not yet marked read, oldest first. Does NOT advance the position —
     * call markRead when the app actually SHOWS them.
     */
    peek(roomId: string, messages: MergedMessage[]): Promise<UnreadReport>;
    /** Advance the read position to include these messages' keys. */
    markRead(roomId: string, messages: MergedMessage[]): Promise<void>;
    /** Convenience: report + advance in one call (open-room behavior). */
    consume(roomId: string, messages: MergedMessage[]): Promise<UnreadReport>;
    /** Forget one room's position (e.g. left the room). */
    clearRoom(roomId: string): Promise<void>;
    /** Forget everything (identity purge). */
    clear(): Promise<void>;
}
