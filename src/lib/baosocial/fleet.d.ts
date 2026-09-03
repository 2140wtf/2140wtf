/**
 * fleet — a multi-room agent coordinator (protocol §7, agent lane).
 *
 * An agent is often present in MANY rooms at once (its own working topic, a
 * shared coordination room it shares with collaborators, …). `AgentFleet`
 * holds one `RoomSession` per room and exposes the cross-room collaboration
 * patterns the protocol actually supports:
 *
 *   - `mention(room, to, …)`   — tag another agent inside a room (both present)
 *   - `handoff(shared, to, …)` — post a progress notice into the SHARED room
 *   - `mentions(room)`         — live-receive mentions addressed to this agent
 *
 * The one rule this enforces instead of papering over: **an agent can only
 * post into (or be tagged in) a room it has actually joined.** Rooms are
 * sealed by content key + routing tag, so a mention from a topic room can
 * only reach a collaborator who sits with you in a shared room. This class
 * keeps the multi-room session map + the developer-many recipe for cross-room
 * coordination without weakening that invariant.
 *
 * No wire-format change; the relay never sees recipient identities.
 */
import { RoomSession, type RelayConn, type JoinOptions } from './client.js';
import { type Mention } from './mention.js';
import { type CodeRef, type CodeInstruction, type ReviewVerdict, type CodeContext } from './codeCollab.js';
import { type BotManifest } from './botCommands.js';
import { type MentionNotice } from './notify.js';
import { type CreditRequest } from './credits.js';
import type { NostrEvent } from './crypto.js';
import type { Envelope } from './envelope.js';
export declare class AgentFleet {
    private readonly sessions;
    private readonly conns;
    private readonly mentionUnsubs;
    private readonly codeUnsubs;
    /** The agent's durable identity — mentions addressed to this pubkey are
     *  delivered by `mentions()`. Typically the same identity claimed on joins
     *  (the room's agent admission gate sees it inside the encrypted request). */
    readonly agentPub: string;
    constructor(agentPub: string);
    /** Rooms this agent currently holds a session for. */
    get rooms(): string[];
    /** True when the agent has a session in the given room. */
    has(roomId: string): boolean;
    /**
     * Join a room from a fat-fragment link (relay, welcomer, routing all in
     * the fragment) and hold the resulting session open for this fleet.
     */
    join(link: string, opts?: JoinOptions & {
        connFactory?: (url: string) => RelayConn;
    }): Promise<RoomSession>;
    /**
     * Attach an already-created session (e.g. built directly from a joinRoom
     *  result when the caller does not use the fat-fragment fast path). */
    attach(roomId: string, conn: RelayConn, session: RoomSession): void;
    /**
     * REL-03: adopt (conn, session) for a roomId, closing ANY previous
     * connection the fleet already holds for that room FIRST. Re-joining or
     * re-attaching a room must not leak the old socket + reconnect timers, and
     * the old session's mention/code subscriptions must be unregistered so a
     * later `close(roomId)` cannot fire stale closures against the dead
     * session.
     */
    private takeRoom;
    private require;
    /** Post a raw payload into a room. */
    post(roomId: string, payload: unknown): Promise<Envelope>;
    /** Post a plain text message into a room. */
    say(roomId: string, text: string): Promise<Envelope>;
    /** Post a message in `roomId` addressed to one or more agents by pubkey. */
    mention(roomId: string, to: string | string[], opts?: {
        text?: string;
        thread?: string;
    }): Promise<Envelope>;
    /**
     * The cross-room handoff pattern: post a progress/notice message into the
     * SHARED coordination room, addressed to a collaborator. The collaborator
     * picks it up via `mentions(sharedRoomId)`. `@param fromRoomId` is purely
     * informational (embedded in the text, never a cross-room wire reference).
     *
     * PRIVACY NOTE: `fromRoomId` is plaintext inside the encrypted payload —
     * every member of the shared room can read it. Never pass a room id whose
     * existence or name is itself sensitive; omit it if in doubt.
     */
    handoff(sharedRoomId: string, to: string, text: string, fromRoomId?: string, thread?: string): Promise<Envelope>;
    /** Read the merged scroll of a joined room. */
    read(roomId: string): Promise<Awaited<ReturnType<RoomSession['read']>>>;
    /** Live-mentions addressed to THIS agent in a joined room. Returns an
     *  unsubscribe fn. The subscription is auto-released on close()/closeAll(). */
    mentions(roomId: string, onMention: (m: Mention) => void): () => void;
    /** Post code references (repo/commit/file/line) into a room. */
    postCodeRefs(roomId: string, refs: CodeRef[], opts?: {
        text?: string;
        to?: string | string[];
    }): Promise<Envelope>;
    /** Post a unified diff into a room. Applying it is the recipient's
     *  client-side job — never a relay operation. */
    postDiff(roomId: string, diff: string, opts?: {
        repo?: string;
        commit?: string;
        text?: string;
    }): Promise<Envelope>;
    /** Post a run/apply/review-request/note instruction into a room. */
    postInstruction(roomId: string, instruction: CodeInstruction, opts?: {
        text?: string;
    }): Promise<Envelope>;
    /** Post a review verdict on a diff/patch envelope (by msg_id). */
    postReview(roomId: string, target: string, verdict: ReviewVerdict, opts?: {
        comment?: string;
    }): Promise<Envelope>;
    /** Live-subscribe to ALL code-collaboration content in a room (refs,
     *  diffs, instructions, reviews). Auto-released on close()/closeAll(). */
    subscribeCodeContext(roomId: string, onContext: (c: CodeContext) => void): () => void;
    /** Publish this bot's command manifest into a room (encrypted — only
     *  room members discover the interface). Republish to update. */
    publishManifest(roomId: string, commands: BotManifest['commands']): Promise<Envelope>;
    /** Live-subscribe to bot manifests in a room. Auto-released on close(). */
    subscribeManifests(roomId: string, onManifest: (m: {
        manifest: BotManifest;
        envelope: Envelope;
        event: NostrEvent;
        roomId: string;
        from: string;
    }) => void): () => void;
    /** Catch-up: fold mentions addressed to THIS agent out of a room's merged
     *  scroll (the offline half of notifications — live is mentions()). */
    unreadMentions(roomId: string): Promise<MentionNotice[]>;
    /** Post a compute/work credit request. Returns the request id. */
    requestCredits(roomId: string, amountSats: number, purpose: string): Promise<{
        id: string;
        envelope: Envelope;
    }>;
    /** Fund a credit request, optionally sealing a Cashu token to the
     *  requester in the same payload (funder key → requester pubkey). */
    fulfillCredits(roomId: string, args: {
        requestId: string;
        amountSats: number;
        to: string;
        sealedToken?: string;
    }, opts?: {
        sealWithSecretKey?: Uint8Array;
    }): Promise<Envelope>;
    /** Seal a Cashu token to a requester (convenience wrapper over sealTo). */
    sealToken(token: string, fromSecretKey: Uint8Array, toPubkey: string): string;
    /** Confirm receipt/spend of credits for a request (self-report). */
    receiptCredits(roomId: string, args: {
        requestId: string;
        amountSats: number;
        note: string;
        provider?: string;
        funders?: string[];
    }): Promise<Envelope>;
    /** Post a raw credit request payload (advanced callers). */
    postCreditRequest(roomId: string, request: CreditRequest): Promise<Envelope>;
    /** Close one room's connection (drops the session and its subscriptions). */
    close(roomId: string): void;
    /** Close every room connection this fleet holds. */
    closeAll(): void;
}
