/**
 * notify — mention notifications with offline catch-up (protocol §7).
 *
 * A mention is only useful if the tagged agent actually notices it. There
 * are two delivery paths, and an agent needs BOTH:
 *
 *   1. LIVE — RoomSession.subscribeMentions (already in client.ts): fires
 *      while the agent is online and subscribed.
 *   2. CATCH-UP — this module: mentions ride the scroll like every other
 *      envelope (they are ordinary encrypted payloads), so an agent that
 *      was offline folds the merged scroll for `payload.to` entries
 *      addressed to it and gets everything it missed.
 *
 * MentionInbox tracks seen state per room (msg_id sets, capped FIFO) behind
 * an injected KV store, so host apps can persist badges across restarts
 * (localStorage / IndexedDB / fs — the host decides). All state is LOCAL:
 * seen marks never touch the wire, so read state leaks nothing to the
 * relay or to other members.
 */
import type { MergedMessage } from './merge.js';
/** One mention notification, extracted from a decrypted scroll message. */
export interface MentionNotice {
    roomId: string;
    /** msg_id of the mentioning envelope — stable across retry-republish. */
    msgId: string;
    /** Envelope author (session key) who tagged the agent. */
    from: string;
    text: string | null;
    /** Other agents tagged in the same message (lowercased). */
    to: string[];
    thread: string | null;
    /** true when the mentioning message is redacted (kept for audit; UIs
     *  normally filter these out). */
    redacted: boolean;
}
/** Fold every mention addressed to `agentPub` out of a merged scroll. */
export declare function foldMentions(messages: MergedMessage[], agentPub: string | string[], roomId?: string): MentionNotice[];
/** Minimal host-injected key-value store (sync or async). */
export interface KvStore {
    get(key: string): string | null | Promise<string | null>;
    set(key: string, value: string): unknown;
}
/**
 * Mention inbox with catch-up semantics. Feed it merged scrolls (from
 * RoomSession.read / readViews) and it reports only what the agent has
 * NOT seen yet; live notices (from subscribeMentions) can be marked seen
 * immediately so they don't double-fire on the next scroll read.
 */
export declare class MentionInbox {
    readonly agentPub: string;
    private readonly store?;
    private state;
    private loaded;
    constructor(agentPub: string, store?: KvStore);
    private storageKey;
    /** Load persisted seen-state (idempotent). Call once before ingest. */
    load(): Promise<void>;
    private persist;
    private seenSet;
    /**
     * Fold a merged scroll and return the mentions that are NEW since the
     * last ingest/markRead for this room. Newly returned notices are marked
     * seen immediately — they will not re-fire on the next ingest.
     */
    ingest(roomId: string, messages: MergedMessage[]): Promise<MentionNotice[]>;
    /** Mark msg_ids seen without an ingest (e.g. delivered live already). */
    markSeen(roomId: string, msgIds: string[]): Promise<void>;
    /** Whether a msg_id has been seen in a room. */
    hasSeen(roomId: string, msgId: string): Promise<boolean>;
    /** Forget everything (e.g. identity purge). */
    clear(): Promise<void>;
}
