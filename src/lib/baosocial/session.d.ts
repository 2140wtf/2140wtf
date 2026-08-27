/**
 * Session — RoomSession class and session persistence.
 *
 * The session module owns the room session lifecycle: post + subscribe
 * operations, epoch ratchets, and serialization for persistence.
 *
 * The session is the primary abstraction for a client living inside a room.
 * It handles encryption/decryption of the stream, epoch advances, and
 * delegates post+retry to post.ts.
 */
import { type NostrEvent, type Clock, type Rng, type PrivacyPolicy } from './crypto.js';
import { type Envelope } from './envelope.js';
import { type MergeResult } from './merge.js';
import { type TrackedMessage, type ReceiptState } from './receipts.js';
import { type Mention } from './mention.js';
import { type ReactionEvent } from './message.js';
import { type BotManifest } from './botCommands.js';
import { type ScrollViews } from './aggregate.js';
import { type TypingEvent } from './typing.js';
import { type JoinedRoom } from './join.js';
/**
 * The JSON-safe, versioned serialization of a JoinedRoom. Apps persist this
 * between page loads / process restarts — the demo previously hand-rolled a
 * lossy subset that dropped chainKey/shieldPub/grace keys, leaving ratcheted
 * members locked out after a refresh. Round-trips exactly.
 */
export interface SerializedSession {
    v: 1;
    roomId: string;
    epoch: number;
    /** hex NIP-44 content key for the current epoch. */
    encKey: string;
    routingId: string;
    scribes: string[];
    governance: string;
    /** hex per-room author (stream) key. SENSITIVE — custody is the app's job. */
    authorSecretKey: string;
    chainKey?: string;
    shieldPub?: string;
    previousEncKey?: string;
    previousEpoch?: number;
    retiredAuthorSecretKeys: string[];
    /** Relay-class privacy policy (§11) — kept so a restored session keeps
     *  jittering ephemeral timestamps identically (absent/present-ignored on
     *  read → default public posture). */
    privacy?: PrivacyPolicy;
}
/** Capture the FULL join state as a JSON-ready object (see SerializedSession). */
export declare function serializeJoinedRoom(joined: JoinedRoom): SerializedSession;
/**
 * Restore a JoinedRoom from serializeJoinedRoom output (object or JSON
 * string). Throws on malformed input — fail-closed: a half-restored session
 * would silently decrypt nothing. Restores P2 ratchet state so the member
 * follows future epoch advances and retains grace-window decryption.
 */
export declare function restoreJoinedRoom(input: SerializedSession | string): JoinedRoom;
/**
 * RoomSession — the primary abstraction for a client inside a room.
 * provides the user-facing API: post, reply, react, retract, subscribe,
 * and read. The reliable post loop delegates to post.ts.
 */
export declare class RoomSession {
    private readonly conn;
    readonly joined: JoinedRoom;
    private readonly clock;
    private readonly rng;
    constructor(conn: import('./join.js').RelayConn, joined: JoinedRoom, clock?: Clock, rng?: Rng);
    private ctx;
    publishEvent(event: NostrEvent): Promise<void>;
    /** Publish path: direct for config-A rooms; NIP-59 gift-wrap to the shield
     *  for config-B rooms (§7, P5) — the relay never sees the routing tag or
     *  the sender on shielded rooms. */
    private publishEventInternal;
    /** Publish one ephemeral message. Returns the envelope for receipt tracking. */
    post(payload: unknown): Promise<Envelope>;
    /**
     * Retry-until-scrolled (§3): republish an already-posted envelope (same
     * msg_id — scribe dedup makes this safe) until it lands in the scroll.
     * The envelope is RE-STAMPED to the session's current epoch (§8): after a
     * ratchet the original epoch falls outside the acceptance window, and the
     * same logical message (same msg_id) must ride the new epoch to be
     * readable by the room as it is NOW.
     */
    republish(envelope: Envelope): Promise<void>;
    /** Live subscription to the room's ephemeral stream. P2: envelopes from
     *  the PREVIOUS epoch still decrypt during the roll-over grace window
     *  (P2_EPOCH_WINDOW) when the session has ratcheted.
     *
     *  REF-COUNTED (prod incident 2026-08-26): repeated subscribeLive calls
     *  used to open a NEW relay REQ per call with the unsubscribe discarded —
     *  a long-lived client (browser SPA re-entering rooms, daemons) stacked
     *  dozens of live REQs on one connection until the relay started
     *  rejecting ALL further reads ('too many concurrent REQs'), which
     *  starved every client's post-ack loop. Now one underlying REQ serves
     *  N callbacks; the relay subscription closes only when the LAST
     *  callback unsubscribes. */
    private liveHandlers;
    private liveUnsub;
    subscribeLive(onEnvelope: (env: Envelope, event: NostrEvent) => void): () => void;
    /**
     * Follow an in-room epoch-advance notice (§8 fresh-join ratchet): the
     *  welcomer ratchets the epoch before wrapping to a `history:'fresh'`
     *  joiner, and tells existing members INSIDE the room (encrypted to the
     *  epoch they hold). The notice carries no secret authority: members
     *  verify the disclosed chain key equals their OWN ratchet output — only
     *  a current key holder can produce it, and a forged notice fails the
     *  check and is ignored (delivered to the app for logging, never applied).
     */
    maybeFollowEpochAdvance(env: Envelope): boolean;
    /**
     * Publish a message addressed to one or more agents (§7). The recipients
     * ride INSIDE the encrypted payload (`payload.to`), so the relay cannot
     * tell who is being addressed — the mention is only visible to room
     * members who can decrypt (and to the recipient via subscribeMentions).
     */
    mention(to: string | string[], opts?: {
        text?: string;
        thread?: string;
    }): Promise<Envelope>;
    /**
     * Reply to a parent envelope by msg_id (§7). The anchor rides INSIDE the
     * encrypted payload (`payload.replyTo`) — the relay never learns the
     * conversation topology. Anchors use msg_id, not the outer event id,
     * because msg_id survives retry-until-scrolled republication (§3).
     */
    reply(replyTo: string, text: string, opts?: {
        to?: string | string[];
        thread?: string;
    }): Promise<Envelope>;
    /**
     * React to an envelope by msg_id (§7). The reaction rides INSIDE the
     * encrypted payload (`payload.reaction`/`payload.target`) — the relay
     * never learns engagement patterns. Clients fold by (target, emoji,
     * author), latest envelope wins.
     */
    react(target: string, emoji: string): Promise<Envelope>;
    /** Retract this author's reaction to an envelope (toggle semantics). */
    unreact(target: string, emoji: string): Promise<Envelope>;
    /**
     * Post a syntax-highlightable code block (§7). Source rides INSIDE the
     * encrypted payload (`payload.code`) — the relay never learns what code
     * is being discussed. Old clients see only the optional caption.
     */
    postCodeBlock(source: string, opts?: {
        lang?: string;
        caption?: string;
    }): Promise<Envelope>;
    /**
     * Live-subscribe to reactions on a given target msg_id in this room.
     * Decrypted payloads are filtered for `payload.target === msgId`.
     * Returns an unsubscribe function.
     */
    subscribeReactions(msgId: string, onReaction: (r: ReactionEvent) => void): () => void;
    /**
     * Publish this bot's command manifest as an encrypted room payload (§7).
     * Only room members can discover the interface — the relay sees
     * ciphertext, unlike a public manifest event. Republish to update.
     */
    publishBotManifest(commands: BotManifest['commands']): Promise<Envelope>;
    /**
     * Live-subscribe to bot manifests posted in this room. Decrypted payloads
     * are filtered for `payload.botManifest`; invalid manifests are dropped
     * silently (an invalid manifest has no usable interface).
     */
    subscribeBotManifests(onManifest: (m: {
        manifest: BotManifest;
        envelope: Envelope;
        event: NostrEvent;
        roomId: string;
        from: string;
    }) => void): () => void;
    /**
     * Live-subscribe to messages that MENTION the given agent pubkey in this
     * room. Every decrypted ephemeral is filtered for `payload.to` containing
     * `agentPub`. Works in public AND shielded rooms (the mention is never
     * relay-visible). Returns an unsubscribe function.
     */
    subscribeMentions(agentPub: string | string[], onMention: (m: Mention) => void): () => void;
    /**
     * Retract one of YOUR messages by msg_id (§7 payload convention, B4).
     * The scroll is append-only, so this publishes a tombstone envelope —
     * every member's fold excludes the original from all views. Only your
     * own messages retract; moderator removal stays on the governance list.
     */
    retract(msgId: string): Promise<Envelope>;
    /**
     * Live-subscribe to typing indicators (§7 payload convention). Purely
     * ephemeral — typing signals never enter the scroll. Returns an
     * unsubscribe function.
     */
    subscribeTyping(onTyping: (t: TypingEvent) => void): () => void;
    /**
     * Ratchet forward one epoch (spec §8): k_{n+1} = HKDF(k_n, "bao/epoch").
     * Requires a chainKey-bearing wrap (P2). The previous epoch's encKey is
     * retained for the roll-over grace window; older keys are dropped
     * (join-forward: history belongs to those who lived it). The stream
     * (author) key does NOT rotate on a plain ratchet — only on re-key.
     */
    advanceEpoch(): import('./crypto.js').EpochKeys;
    /**
     * Apply a re-key (spec §8 exclusion): a fresh seed wrapped to remaining
     * members. Resets the ratchet state to the new chain key/epoch and
     * rotates the stream key — the retired key is kept for kind-5 deletion
     * ownership over the member's own old messages (spec §2).
     */
    applyRekey(newChainKey: Uint8Array, newEpoch: number): void;
    /** One-call fold of the merged scroll into consumer views (§3.3):
     *  timeline, threads, reaction tallies, review states, manifest registry. */
    readViews(): Promise<ScrollViews>;
    /**
     * Reliable post (§3 retry-until-scrolled, final-boss B2): publish, then
     * poll the scroll and REPUBLISH the same msg_id until it lands or the
     * resend budget is exhausted. Scribe dedup makes republishing safe; the
     * envelope is re-stamped to the current epoch on every resend (§8).
     *
     * Every embedding app previously re-implemented this loop by hand
     * (demo outbox, agent CLI) — now it is one call with status callbacks.
     */
    postReliable(payload: unknown, opts?: {
        /** Flush deadline of the room — receipt timeout is 3× (§3).
         *  Defaults to the provisioning default (4 s). */
        flushDeadlineMs?: number;
        /** Maximum republish attempts after the first send. Default 3. */
        maxResends?: number;
        /** Status transitions: 'pending' → 'confirmed' | 'timeout'. */
        onStatus?: (state: ReceiptState, tracked: TrackedMessage) => void;
        sleep?: (ms: number) => Promise<void>;
    }): Promise<TrackedMessage>;
    /**
     * Read the scroll, FOLLOWING epoch ratchets (§8): each merge decodes the
     * scopes the session can currently read; epochAdvance notices found in
     * the decoded history are verified against our own ratchet output and
     * applied, then the read repeats at the new epoch — a member who lived
     * through N ratchets re-reads their whole lived chain (within relay
     * retention). A fresh joiner has no past chain keys and stops at their
     * join epoch: history before it is cryptographically unreachable.
     *
     * Fold checkpoint (P6b): `sinceSec` narrows segment/redaction queries to
     * events published after that second — long-lived market-room members
     * pass their persisted cursor to skip re-fetching history. Callers that
     * need the FULL merged scroll (inbox folds) omit it. The cursor is
     * advisory: relays may ignore `since`, correctness never depends on it.
     */
    read(opts?: {
        sinceSec?: number;
    }): Promise<MergeResult>;
    /**
     * Read the scroll at the CURRENT epoch: fetch all listed scribes'
     *  segments (by author, §3.2), plus the redaction list, and union-merge.
     */
    private readCurrentEpoch;
}
