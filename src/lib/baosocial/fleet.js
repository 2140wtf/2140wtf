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
import { joinFromLink } from './client.js';
import { buildCodeRefs, buildDiff, buildInstruction, buildReview, extractCodeContext, } from './codeCollab.js';
import { foldMentions } from './notify.js';
import { buildCreditRequest, buildCreditReceipt, newCreditId, sealTo, } from './credits.js';
export class AgentFleet {
    constructor(agentPub) {
        this.sessions = new Map();
        this.conns = new Map();
        this.mentionUnsubs = new Map();
        this.codeUnsubs = new Map();
        if (!/^[0-9a-f]{64}$/i.test(agentPub))
            throw new Error('fleet requires a 64-hex agent pubkey');
        this.agentPub = agentPub.toLowerCase();
    }
    /** Rooms this agent currently holds a session for. */
    get rooms() {
        return [...this.sessions.keys()];
    }
    /** True when the agent has a session in the given room. */
    has(roomId) {
        return this.sessions.has(roomId);
    }
    /**
     * Join a room from a fat-fragment link (relay, welcomer, routing all in
     * the fragment) and hold the resulting session open for this fleet.
     */
    async join(link, opts = {}) {
        const { conn, session, joined } = await joinFromLink(link, opts);
        this.conns.set(joined.roomId, conn);
        this.sessions.set(joined.roomId, session);
        return session;
    }
    /** Attach an already-created session (e.g. built directly from a joinRoom
     *  result when the caller does not use the fat-fragment fast path). */
    attach(roomId, conn, session) {
        this.conns.set(roomId, conn);
        this.sessions.set(roomId, session);
    }
    require(roomId) {
        const s = this.sessions.get(roomId);
        if (!s)
            throw new Error(`fleet ${this.agentPub.slice(0, 8)}… is not a member of room ${roomId} (join it first)`);
        return s;
    }
    /** Post a raw payload into a room. */
    async post(roomId, payload) {
        return this.require(roomId).post(payload);
    }
    /** Post a plain text message into a room. */
    async say(roomId, text) {
        return this.require(roomId).post({ text });
    }
    /** Post a message in `roomId` addressed to one or more agents by pubkey. */
    async mention(roomId, to, opts = {}) {
        return this.require(roomId).mention(to, opts);
    }
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
    async handoff(sharedRoomId, to, text, fromRoomId, thread) {
        const body = fromRoomId && fromRoomId !== sharedRoomId ? `[from ${fromRoomId}] ${text}` : text;
        return this.require(sharedRoomId).mention(to, { text: body, thread });
    }
    /** Read the merged scroll of a joined room. */
    async read(roomId) {
        return this.require(roomId).read();
    }
    /** Live-mentions addressed to THIS agent in a joined room. Returns an
     *  unsubscribe fn. The subscription is auto-released on close()/closeAll(). */
    mentions(roomId, onMention) {
        const unsub = this.require(roomId).subscribeMentions(this.agentPub, onMention);
        let set = this.mentionUnsubs.get(roomId);
        if (!set) {
            set = new Set();
            this.mentionUnsubs.set(roomId, set);
        }
        set.add(unsub);
        return () => {
            unsub();
            set.delete(unsub);
        };
    }
    // ─── Code collaboration (§7) — all content rides INSIDE the encrypted
    // payload; the relay never learns repo names, commits, diffs, or verdicts.
    /** Post code references (repo/commit/file/line) into a room. */
    async postCodeRefs(roomId, refs, opts = {}) {
        return this.require(roomId).post(buildCodeRefs(refs, opts));
    }
    /** Post a unified diff into a room. Applying it is the recipient's
     *  client-side job — never a relay operation. */
    async postDiff(roomId, diff, opts = {}) {
        return this.require(roomId).post(buildDiff(diff, opts));
    }
    /** Post a run/apply/review-request/note instruction into a room. */
    async postInstruction(roomId, instruction, opts = {}) {
        return this.require(roomId).post(buildInstruction(instruction, opts));
    }
    /** Post a review verdict on a diff/patch envelope (by msg_id). */
    async postReview(roomId, target, verdict, opts = {}) {
        return this.require(roomId).post(buildReview(target, verdict, opts));
    }
    /** Live-subscribe to ALL code-collaboration content in a room (refs,
     *  diffs, instructions, reviews). Auto-released on close()/closeAll(). */
    subscribeCodeContext(roomId, onContext) {
        const unsub = this.require(roomId).subscribeLive((envelope, event) => {
            const ctx = extractCodeContext(envelope.payload);
            if (!ctx)
                return;
            onContext({ ...ctx, envelope, event, roomId, from: envelope.author });
        });
        let set = this.codeUnsubs.get(roomId);
        if (!set) {
            set = new Set();
            this.codeUnsubs.set(roomId, set);
        }
        set.add(unsub);
        return () => {
            unsub();
            set.delete(unsub);
        };
    }
    /** Publish this bot's command manifest into a room (encrypted — only
     *  room members discover the interface). Republish to update. */
    async publishManifest(roomId, commands) {
        return this.require(roomId).publishBotManifest(commands);
    }
    /** Live-subscribe to bot manifests in a room. Auto-released on close(). */
    subscribeManifests(roomId, onManifest) {
        const unsub = this.require(roomId).subscribeBotManifests(onManifest);
        let set = this.codeUnsubs.get(roomId);
        if (!set) {
            set = new Set();
            this.codeUnsubs.set(roomId, set);
        }
        set.add(unsub);
        return () => {
            unsub();
            set.delete(unsub);
        };
    }
    /** Catch-up: fold mentions addressed to THIS agent out of a room's merged
     *  scroll (the offline half of notifications — live is mentions()). */
    async unreadMentions(roomId) {
        const { messages } = await this.require(roomId).read();
        return foldMentions(messages, this.agentPub, roomId).filter((n) => !n.redacted);
    }
    // ─── Credits (§7, agent lane) — the room-private funding state machine.
    // Amounts and purposes ride INSIDE the encrypted payload; Cashu tokens
    // travel sealed (nested NIP-44) to the requester in the same payload.
    /** Post a compute/work credit request. Returns the request id. */
    async requestCredits(roomId, amountSats, purpose) {
        const id = newCreditId();
        const envelope = await this.require(roomId).post(buildCreditRequest({ id, amountSats, purpose }));
        return { id, envelope };
    }
    /** Fund a credit request, optionally sealing a Cashu token to the
     *  requester in the same payload (funder key → requester pubkey). */
    async fulfillCredits(roomId, args, opts = {}) {
        const fulfill = {
            op: 'fulfill',
            requestId: args.requestId,
            amountSats: args.amountSats,
            to: args.to,
            ...(args.sealedToken ? { sealedToken: args.sealedToken } : {}),
        };
        void opts; // sealing happens caller-side via sealTo() when the funder key is available
        return this.require(roomId).post({ credit: fulfill });
    }
    /** Seal a Cashu token to a requester (convenience wrapper over sealTo). */
    sealToken(token, fromSecretKey, toPubkey) {
        return sealTo(token, fromSecretKey, toPubkey);
    }
    /** Confirm receipt/spend of credits for a request (self-report). */
    async receiptCredits(roomId, args) {
        const receipt = { op: 'receipt', ...args };
        return this.require(roomId).post(buildCreditReceipt(receipt));
    }
    /** Post a raw credit request payload (advanced callers). */
    async postCreditRequest(roomId, request) {
        return this.require(roomId).post(buildCreditRequest(request));
    }
    /** Close one room's connection (drops the session and its subscriptions). */
    close(roomId) {
        for (const unsub of this.mentionUnsubs.get(roomId) ?? [])
            unsub();
        this.mentionUnsubs.delete(roomId);
        for (const unsub of this.codeUnsubs.get(roomId) ?? [])
            unsub();
        this.codeUnsubs.delete(roomId);
        this.conns.get(roomId)?.close();
        this.conns.delete(roomId);
        this.sessions.delete(roomId);
    }
    /** Close every room connection this fleet holds. */
    closeAll() {
        for (const set of this.mentionUnsubs.values())
            for (const unsub of set)
                unsub();
        this.mentionUnsubs.clear();
        for (const set of this.codeUnsubs.values())
            for (const unsub of set)
                unsub();
        this.codeUnsubs.clear();
        for (const c of this.conns.values())
            c.close();
        this.conns.clear();
        this.sessions.clear();
    }
}
