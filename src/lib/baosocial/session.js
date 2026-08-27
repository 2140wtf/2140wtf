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
import { systemClock, defaultRng, bytesToHex, hexToBytes, generateSecretKey, deriveEpochKeys, ratchetEpoch, deriveScrollWrapperKey, scrollScope, privacyPolicyFor, } from './crypto.js';
import { encodeEphemeralEvent, encodeEnvelopeEvent, decodeEphemeralEvent, P2_EPOCH_WINDOW } from './envelope.js';
import { giftWrapEnvelope } from './shield.js';
import { mergeScrolls } from './merge.js';
import { decodeRedactionListEvent } from './redaction.js';
import { EPHEMERAL_MESSAGE, SCROLL_SEGMENT, REDACTION_LIST } from './kinds.js';
import { ReceiptTracker } from './receipts.js';
import { buildMention, isMentioned } from './mention.js';
import { buildReply, buildReaction, parseReaction, buildCodeBlock } from './message.js';
import { buildBotManifest, parseBotManifest } from './botCommands.js';
import { aggregateScroll } from './aggregate.js';
import { dedupKey } from './envelope.js';
import { parseTyping } from './typing.js';
import { buildRetract } from './retract.js';
import { DEFAULT_FLUSH_MS } from './post.js';
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEX64 = /^[0-9a-f]{64}$/;
/** Capture the FULL join state as a JSON-ready object (see SerializedSession). */
export function serializeJoinedRoom(joined) {
    return {
        v: 1,
        roomId: joined.roomId,
        epoch: joined.epoch,
        encKey: bytesToHex(joined.encKey),
        routingId: joined.routingId,
        scribes: [...joined.scribes],
        governance: joined.governance,
        authorSecretKey: bytesToHex(joined.authorSecretKey),
        ...(joined.chainKey ? { chainKey: bytesToHex(joined.chainKey) } : {}),
        ...(joined.shieldPub ? { shieldPub: joined.shieldPub } : {}),
        ...(joined.previousEncKey && joined.previousEpoch !== undefined
            ? { previousEncKey: bytesToHex(joined.previousEncKey), previousEpoch: joined.previousEpoch }
            : {}),
        retiredAuthorSecretKeys: joined.retiredAuthorSecretKeys.map(bytesToHex),
        privacy: joined.privacy,
    };
}
function requireHex(value, field) {
    if (typeof value !== 'string' || !HEX64.test(value))
        throw new Error(`serialized session: bad ${field}`);
    return hexToBytes(value);
}
/**
 * Restore a JoinedRoom from serializeJoinedRoom output (object or JSON
 * string). Throws on malformed input — fail-closed: a half-restored session
 * would silently decrypt nothing. Restores P2 ratchet state so the member
 * follows future epoch advances and retains grace-window decryption.
 */
export function restoreJoinedRoom(input) {
    let s;
    try {
        s = typeof input === 'string' ? JSON.parse(input) : input;
    }
    catch {
        throw new Error('serialized session: not valid JSON');
    }
    if (!s || typeof s !== 'object')
        throw new Error('serialized session: not an object');
    if (s.v !== 1)
        throw new Error(`serialized session: unsupported version ${String(s.v)}`);
    if (typeof s.roomId !== 'string' || !s.roomId)
        throw new Error('serialized session: bad roomId');
    if (!Number.isSafeInteger(s.epoch) || s.epoch < 0)
        throw new Error('serialized session: bad epoch');
    if (typeof s.routingId !== 'string' || !HEX64.test(s.routingId))
        throw new Error('serialized session: bad routingId');
    if (!Array.isArray(s.scribes) || !s.scribes.every((k) => typeof k === 'string' && HEX64.test(k))) {
        throw new Error('serialized session: bad scribes');
    }
    if (typeof s.governance !== 'string' || !HEX64.test(s.governance))
        throw new Error('serialized session: bad governance');
    const retired = s.retiredAuthorSecretKeys ?? [];
    if (!Array.isArray(retired))
        throw new Error('serialized session: bad retiredAuthorSecretKeys');
    return {
        roomId: s.roomId,
        epoch: s.epoch,
        encKey: requireHex(s.encKey, 'encKey'),
        routingId: s.routingId,
        scribes: [...s.scribes],
        governance: s.governance,
        authorSecretKey: requireHex(s.authorSecretKey, 'authorSecretKey'),
        ...(s.chainKey !== undefined ? { chainKey: requireHex(s.chainKey, 'chainKey') } : {}),
        ...(s.shieldPub !== undefined && (typeof s.shieldPub !== 'string' || !HEX64.test(s.shieldPub)
            ? (() => { throw new Error('serialized session: bad shieldPub'); })()
            : { shieldPub: s.shieldPub })),
        ...(s.previousEncKey !== undefined && s.previousEpoch !== undefined
            ? { previousEncKey: requireHex(s.previousEncKey, 'previousEncKey'), previousEpoch: s.previousEpoch }
            : {}),
        retiredAuthorSecretKeys: retired.map((k) => requireHex(k, 'retiredAuthorSecretKeys entry')),
        privacy: privacyPolicyFor(s.privacy),
    };
}
// ─── Room session — post, subscribe, read ──────────────────────────────────
/**
 * RoomSession — the primary abstraction for a client inside a room.
 * provides the user-facing API: post, reply, react, retract, subscribe,
 * and read. The reliable post loop delegates to post.ts.
 */
export class RoomSession {
    constructor(conn, joined, clock = systemClock, rng = defaultRng) {
        this.conn = conn;
        this.joined = joined;
        this.clock = clock;
        this.rng = rng;
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
        this.liveHandlers = null;
        this.liveUnsub = null;
    }
    ctx() {
        return {
            roomId: this.joined.roomId,
            epoch: this.joined.epoch,
            encKey: this.joined.encKey,
            routingId: this.joined.routingId,
        };
    }
    publishEvent(event) {
        return this.publishEventInternal(event);
    }
    /** Publish path: direct for config-A rooms; NIP-59 gift-wrap to the shield
     *  for config-B rooms (§7, P5) — the relay never sees the routing tag or
     *  the sender on shielded rooms. */
    async publishEventInternal(event) {
        if (this.joined.shieldPub) {
            const wrap = giftWrapEnvelope(event, this.joined.shieldPub, this.joined.authorSecretKey, {
                rng: this.rng,
                clock: this.clock,
                policy: this.joined.privacy,
            });
            await this.conn.publish(wrap);
            return;
        }
        await this.conn.publish(event);
    }
    /** Publish one ephemeral message. Returns the envelope for receipt tracking. */
    async post(payload) {
        const { event, envelope } = encodeEphemeralEvent(this.joined.authorSecretKey, payload, this.ctx(), this.clock, this.rng, this.joined.privacy);
        await this.publishEventInternal(event);
        return envelope;
    }
    /**
     * Retry-until-scrolled (§3): republish an already-posted envelope (same
     * msg_id — scribe dedup makes this safe) until it lands in the scroll.
     * The envelope is RE-STAMPED to the session's current epoch (§8): after a
     * ratchet the original epoch falls outside the acceptance window, and the
     * same logical message (same msg_id) must ride the new epoch to be
     * readable by the room as it is NOW.
     */
    async republish(envelope) {
        const restamped = { ...envelope, epoch: this.joined.epoch };
        await this.publishEventInternal(encodeEnvelopeEvent(this.joined.authorSecretKey, restamped, this.ctx(), this.clock, this.rng, this.joined.privacy));
    }
    subscribeLive(onEnvelope) {
        if (!this.liveHandlers) {
            this.liveHandlers = new Set();
            this.liveUnsub = this.conn.subscribe({ kinds: [EPHEMERAL_MESSAGE], '#r': [this.joined.routingId] }, (event) => {
                const deliver = (env) => {
                    // Per-handler isolation: one throwing consumer must not starve the
                    // others (nor trip the previous-epoch fallback below).
                    for (const handler of [...(this.liveHandlers ?? [])]) {
                        try {
                            handler(env, event);
                        }
                        catch {
                            // consumer bug — never fatal to the stream
                        }
                    }
                };
                try {
                    const env = decodeEphemeralEvent(event, this.ctx(), P2_EPOCH_WINDOW);
                    this.maybeFollowEpochAdvance(env);
                    deliver(env);
                }
                catch {
                    // Current-epoch key didn't fit — try the previous epoch's key
                    // (in-flight envelopes from just before the roll, §3.1 grace).
                    if (this.joined.previousEncKey && this.joined.previousEpoch !== undefined) {
                        try {
                            deliver(decodeEphemeralEvent(event, { roomId: this.joined.roomId, epoch: this.joined.previousEpoch, encKey: this.joined.previousEncKey, routingId: this.joined.routingId }, 0));
                        }
                        catch {
                            // Not ours to decrypt / malformed — ignore.
                        }
                    }
                }
            });
        }
        this.liveHandlers.add(onEnvelope);
        return () => {
            this.liveHandlers?.delete(onEnvelope);
            if (this.liveHandlers && this.liveHandlers.size === 0) {
                this.liveUnsub?.();
                this.liveHandlers = null;
                this.liveUnsub = null;
            }
        };
    }
    /**
     * Follow an in-room epoch-advance notice (§8 fresh-join ratchet): the
     *  welcomer ratchets the epoch before wrapping to a `history:'fresh'`
     *  joiner, and tells existing members INSIDE the room (encrypted to the
     *  epoch they hold). The notice carries no secret authority: members
     *  verify the disclosed chain key equals their OWN ratchet output — only
     *  a current key holder can produce it, and a forged notice fails the
     *  check and is ignored (delivered to the app for logging, never applied).
     */
    maybeFollowEpochAdvance(env) {
        const p = env.payload;
        if (!p || typeof p !== 'object')
            return false;
        const adv = p.epochAdvance;
        if (!adv || typeof adv !== 'object')
            return false;
        const { epoch, chainKey } = adv;
        if (!Number.isSafeInteger(epoch) || typeof chainKey !== 'string' || !/^[0-9a-f]{64}$/.test(chainKey))
            return false;
        if (!this.joined.chainKey)
            return false;
        if (epoch !== this.joined.epoch + 1)
            return false;
        const expected = ratchetEpoch(deriveEpochKeys(this.joined.chainKey, this.joined.epoch));
        if (bytesToHex(expected.chainKey) !== chainKey)
            return false; // forged notice
        this.advanceEpoch();
        return true;
    }
    /**
     * Publish a message addressed to one or more agents (§7). The recipients
     * ride INSIDE the encrypted payload (`payload.to`), so the relay cannot
     * tell who is being addressed — the mention is only visible to room
     * members who can decrypt (and to the recipient via subscribeMentions).
     */
    async mention(to, opts = {}) {
        return this.post(buildMention({ to, ...opts }));
    }
    /**
     * Reply to a parent envelope by msg_id (§7). The anchor rides INSIDE the
     * encrypted payload (`payload.replyTo`) — the relay never learns the
     * conversation topology. Anchors use msg_id, not the outer event id,
     * because msg_id survives retry-until-scrolled republication (§3).
     */
    async reply(replyTo, text, opts = {}) {
        return this.post(buildReply({ replyTo, text, ...opts }));
    }
    /**
     * React to an envelope by msg_id (§7). The reaction rides INSIDE the
     * encrypted payload (`payload.reaction`/`payload.target`) — the relay
     * never learns engagement patterns. Clients fold by (target, emoji,
     * author), latest envelope wins.
     */
    async react(target, emoji) {
        return this.post(buildReaction(emoji, target));
    }
    /** Retract this author's reaction to an envelope (toggle semantics). */
    async unreact(target, emoji) {
        return this.post(buildReaction(emoji, target, { remove: true }));
    }
    /**
     * Post a syntax-highlightable code block (§7). Source rides INSIDE the
     * encrypted payload (`payload.code`) — the relay never learns what code
     * is being discussed. Old clients see only the optional caption.
     */
    async postCodeBlock(source, opts = {}) {
        return this.post(buildCodeBlock(source, opts));
    }
    /**
     * Live-subscribe to reactions on a given target msg_id in this room.
     * Decrypted payloads are filtered for `payload.target === msgId`.
     * Returns an unsubscribe function.
     */
    subscribeReactions(msgId, onReaction) {
        const target = msgId.toLowerCase();
        return this.subscribeLive((envelope, event) => {
            const reaction = parseReaction(envelope.payload);
            if (!reaction || reaction.target !== target)
                return;
            onReaction({ ...reaction, envelope, event, roomId: this.joined.roomId, from: envelope.author });
        });
    }
    /**
     * Publish this bot's command manifest as an encrypted room payload (§7).
     * Only room members can discover the interface — the relay sees
     * ciphertext, unlike a public manifest event. Republish to update.
     */
    async publishBotManifest(commands) {
        return this.post(buildBotManifest(commands));
    }
    /**
     * Live-subscribe to bot manifests posted in this room. Decrypted payloads
     * are filtered for `payload.botManifest`; invalid manifests are dropped
     * silently (an invalid manifest has no usable interface).
     */
    subscribeBotManifests(onManifest) {
        return this.subscribeLive((envelope, event) => {
            const manifest = parseBotManifest(envelope.payload);
            if (!manifest)
                return;
            onManifest({ manifest, envelope, event, roomId: this.joined.roomId, from: envelope.author });
        });
    }
    /**
     * Live-subscribe to messages that MENTION the given agent pubkey in this
     * room. Every decrypted ephemeral is filtered for `payload.to` containing
     * `agentPub`. Works in public AND shielded rooms (the mention is never
     * relay-visible). Returns an unsubscribe function.
     */
    subscribeMentions(agentPub, onMention) {
        // An agent owns MULTIPLE key domains: the durable identity pubkey AND
        // this room's author key. Senders target whichever their @handle
        // resolution produced (roster authors are room-author keys), so a
        // single-key match silently dropped mentions across that boundary.
        const pubs = (Array.isArray(agentPub) ? agentPub : [agentPub]).map((x) => x.toLowerCase());
        return this.subscribeLive((envelope, event) => {
            if (!pubs.some((pub) => isMentioned(envelope.payload, pub)))
                return;
            const payload = (envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {});
            onMention({
                envelope,
                event,
                roomId: this.joined.roomId,
                from: envelope.author,
                text: typeof payload.text === 'string' ? payload.text : null,
                to: Array.isArray(payload.to) ? payload.to.filter((x) => typeof x === 'string').map((s) => s.toLowerCase()) : [],
                thread: typeof payload.thread === 'string' ? payload.thread : null,
                payload,
            });
        });
    }
    /**
     * Retract one of YOUR messages by msg_id (§7 payload convention, B4).
     * The scroll is append-only, so this publishes a tombstone envelope —
     * every member's fold excludes the original from all views. Only your
     * own messages retract; moderator removal stays on the governance list.
     */
    async retract(msgId) {
        return this.post(buildRetract(msgId));
    }
    /**
     * Live-subscribe to typing indicators (§7 payload convention). Purely
     * ephemeral — typing signals never enter the scroll. Returns an
     * unsubscribe function.
     */
    subscribeTyping(onTyping) {
        return this.subscribeLive((envelope, event) => {
            const t = parseTyping(envelope.payload);
            if (!t)
                return;
            onTyping({ from: envelope.author, active: t.active, envelope, event });
        });
    }
    /**
     * Ratchet forward one epoch (spec §8): k_{n+1} = HKDF(k_n, "bao/epoch").
     * Requires a chainKey-bearing wrap (P2). The previous epoch's encKey is
     * retained for the roll-over grace window; older keys are dropped
     * (join-forward: history belongs to those who lived it). The stream
     * (author) key does NOT rotate on a plain ratchet — only on re-key.
     */
    advanceEpoch() {
        if (!this.joined.chainKey)
            throw new Error('no chain key — session was joined with a P1 (static-key) wrap');
        const next = ratchetEpoch(deriveEpochKeys(this.joined.chainKey, this.joined.epoch));
        this.joined.previousEncKey = this.joined.encKey;
        this.joined.previousEpoch = this.joined.epoch;
        this.joined.chainKey = next.chainKey;
        this.joined.encKey = next.encKey;
        this.joined.epoch = next.epoch;
        return next;
    }
    /**
     * Apply a re-key (spec §8 exclusion): a fresh seed wrapped to remaining
     * members. Resets the ratchet state to the new chain key/epoch and
     * rotates the stream key — the retired key is kept for kind-5 deletion
     * ownership over the member's own old messages (spec §2).
     */
    applyRekey(newChainKey, newEpoch) {
        // Epoch monotonicity: a stale/older re-key wrap must never roll
        // ratchet state backward (review finding 6).
        if (newEpoch <= this.joined.epoch)
            return;
        this.joined.retiredAuthorSecretKeys.push(this.joined.authorSecretKey);
        this.joined.authorSecretKey = generateSecretKey();
        const keys = deriveEpochKeys(newChainKey, newEpoch);
        this.joined.previousEncKey = this.joined.encKey;
        this.joined.previousEpoch = this.joined.epoch;
        this.joined.chainKey = keys.chainKey;
        this.joined.encKey = keys.encKey;
        this.joined.epoch = newEpoch;
    }
    /** One-call fold of the merged scroll into consumer views (§3.3):
     *  timeline, threads, reaction tallies, review states, manifest registry. */
    async readViews() {
        return aggregateScroll(await this.read());
    }
    /**
     * Reliable post (§3 retry-until-scrolled, final-boss B2): publish, then
     * poll the scroll and REPUBLISH the same msg_id until it lands or the
     * resend budget is exhausted. Scribe dedup makes republishing safe; the
     * envelope is re-stamped to the current epoch on every resend (§8).
     *
     * Every embedding app previously re-implemented this loop by hand
     * (demo outbox, agent CLI) — now it is one call with status callbacks.
     */
    async postReliable(payload, opts = {}) {
        const timeoutMs = 3 * (opts.flushDeadlineMs ?? DEFAULT_FLUSH_MS);
        const maxResends = opts.maxResends ?? 3;
        const sleep = opts.sleep ?? defaultSleep;
        const tracker = new ReceiptTracker({ flushDeadlineMs: opts.flushDeadlineMs ?? DEFAULT_FLUSH_MS });
        const envelope = await this.post(payload);
        const tracked = tracker.track(envelope);
        opts.onStatus?.('pending', tracked);
        for (let attempt = 0;; attempt++) {
            await sleep(timeoutMs);
            const result = await this.read();
            const scrollKeys = new Set(result.messages.map((m) => dedupKey(m.envelope)));
            // Synthetic per-scribe coverage from the merge result: full-scroll keys
            // confirm inclusion; a scribe whose coverage lacks the key contributes
            // no censorship verdict here (that requires ≥2 post-send segments per
            // scribe — power users drive ReceiptTracker directly for that).
            const coverage = new Map([...result.coverage.entries()].map(([scribe, keys]) => [scribe, { segments: [{ keys, createdAt: Math.floor(Date.now() / 1000) }] }]));
            tracker.observe(coverage, scrollKeys);
            if (tracked.state === 'confirmed') {
                opts.onStatus?.('confirmed', tracked);
                return tracked;
            }
            if (attempt >= maxResends) {
                if (tracked.state === 'pending')
                    tracked.state = 'timeout'; // budget exhausted
                opts.onStatus?.(tracked.state === 'censored' ? 'censored' : 'timeout', tracked);
                return tracked;
            }
            await this.republish(envelope); // same msg_id; re-stamped to current epoch
            tracker.track(envelope); // restarts the receipt window on the tracked entry
        }
    }
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
    async read(opts = {}) {
        const allMessages = [];
        const allRejected = [];
        const allWarnings = [];
        const allCoverage = new Map();
        const seenKeys = new Set();
        for (let hop = 0; hop < 8; hop++) {
            const result = await this.readCurrentEpoch(opts.sinceSec);
            for (const m of result.messages) {
                const key = `${m.envelope.author}:${m.envelope.msg_id}`;
                if (seenKeys.has(key))
                    continue;
                seenKeys.add(key);
                allMessages.push(m);
            }
            allRejected.push(...result.rejected);
            allWarnings.push(...result.chainWarnings);
            for (const [key, scribes] of result.coverage) {
                const set = allCoverage.get(key) ?? new Set();
                for (const s of scribes)
                    set.add(s);
                allCoverage.set(key, set);
            }
            let advanced = false;
            for (const m of result.messages) {
                if (this.maybeFollowEpochAdvance(m.envelope))
                    advanced = true;
            }
            if (!advanced)
                break;
        }
        return { messages: allMessages, rejected: allRejected, coverage: allCoverage, chainWarnings: allWarnings };
    }
    /**
     * Read the scroll at the CURRENT epoch: fetch all listed scribes'
     *  segments (by author, §3.2), plus the redaction list, and union-merge.
     */
    async readCurrentEpoch(sinceSec) {
        const segCtx = {
            roomId: this.joined.roomId,
            encKey: this.joined.encKey, // content key; the container wrapper key is derived internally
            segKey: deriveScrollWrapperKey(this.joined.encKey),
            routingId: this.joined.routingId,
            epoch: this.joined.epoch,
        };
        const segmentEvents = [];
        for (const scribe of this.joined.scribes) {
            // `since` is advisory — relays may ignore it; correctness never
            // depends on it (full merge still happens over what IS returned).
            segmentEvents.push(...(await this.conn.query(sinceSec !== undefined ? { kinds: [SCROLL_SEGMENT], authors: [scribe], since: sinceSec } : { kinds: [SCROLL_SEGMENT], authors: [scribe] })));
        }
        const scope = scrollScope(segCtx.segKey, this.joined.roomId);
        const redactEvents = await this.conn.query({
            kinds: [REDACTION_LIST],
            '#d': [`bao-redact:${scope}`],
        });
        // Rule 4: the redaction list is a replaceable state document — the
        // LATEST governance-authored version wins, never arrival order (a
        // lagging relay serving a stale list must not resurrect redactions).
        let redactions = [];
        const validLists = redactEvents
            .map((ev) => {
            try {
                return { ev, entries: decodeRedactionListEvent(ev, { roomId: this.joined.roomId, encKey: this.joined.encKey, scope }, this.joined.governance) };
            }
            catch {
                return null;
            }
        })
            .filter((x) => x !== null)
            .sort((a, b) => b.ev.created_at - a.ev.created_at || (a.ev.id > b.ev.id ? 1 : -1));
        if (validLists[0])
            redactions = validLists[0].entries;
        return mergeScrolls(segmentEvents, { scribes: this.joined.scribes, ctx: segCtx, redactions });
    }
}
