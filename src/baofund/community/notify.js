import { isMentioned, mentionTargets } from './mention.js';
/** Fold every mention addressed to `agentPub` out of a merged scroll. */
export function foldMentions(messages, agentPub, roomId = '') {
    // See client.subscribeMentions — an agent is matchable on its durable
    // pubkey AND its room-author key; senders may target either domain.
    const pubs = (Array.isArray(agentPub) ? agentPub : [agentPub]).map((x) => x.toLowerCase());
    const out = [];
    for (const m of messages) {
        const p = m.envelope.payload;
        if (!pubs.some((pub) => isMentioned(p, pub)))
            continue;
        const payload = (p && typeof p === 'object' ? p : {});
        out.push({
            roomId,
            msgId: m.envelope.msg_id,
            from: m.envelope.author,
            text: typeof payload.text === 'string' ? payload.text : null,
            to: mentionTargets(p),
            thread: typeof payload.thread === 'string' ? payload.thread : null,
            redacted: m.redacted,
        });
    }
    return out;
}
const SEEN_CAP = 2048;
const KEY_PREFIX = 'bao-inbox-v1:';
/**
 * Mention inbox with catch-up semantics. Feed it merged scrolls (from
 * RoomSession.read / readViews) and it reports only what the agent has
 * NOT seen yet; live notices (from subscribeMentions) can be marked seen
 * immediately so they don't double-fire on the next scroll read.
 */
export class MentionInbox {
    constructor(agentPub, store) {
        this.state = { seen: {} };
        this.loaded = false;
        if (!/^[0-9a-f]{64}$/i.test(agentPub))
            throw new Error('inbox requires a 64-hex agent pubkey');
        this.agentPub = agentPub.toLowerCase();
        this.store = store;
    }
    storageKey() {
        return `${KEY_PREFIX}${this.agentPub}`;
    }
    /** Load persisted seen-state (idempotent). Call once before ingest. */
    async load() {
        if (this.loaded || !this.store) {
            this.loaded = true;
            return;
        }
        try {
            const raw = await this.store.get(this.storageKey());
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && parsed.seen && typeof parsed.seen === 'object') {
                    this.state = { seen: parsed.seen };
                }
            }
        }
        catch {
            // Corrupt/absent state → start empty. Seen-state is a cache, never
            // authoritative; losing it only re-surfaces old mentions once.
        }
        this.loaded = true;
    }
    async persist() {
        if (!this.store)
            return;
        await this.store.set(this.storageKey(), JSON.stringify(this.state));
    }
    seenSet(roomId) {
        return new Set(this.state.seen[roomId] ?? []);
    }
    /**
     * Fold a merged scroll and return the mentions that are NEW since the
     * last ingest/markRead for this room. Newly returned notices are marked
     * seen immediately — they will not re-fire on the next ingest.
     */
    async ingest(roomId, messages) {
        await this.load();
        const seen = this.seenSet(roomId);
        const fresh = foldMentions(messages, this.agentPub, roomId).filter((n) => !seen.has(n.msgId));
        if (fresh.length === 0)
            return [];
        const list = this.state.seen[roomId] ?? [];
        for (const n of fresh) {
            seen.add(n.msgId);
            list.push(n.msgId);
        }
        // FIFO eviction beyond the cap.
        while (list.length > SEEN_CAP) {
            const evicted = list.shift();
            if (evicted)
                seen.delete(evicted);
        }
        this.state.seen[roomId] = list;
        await this.persist();
        return fresh;
    }
    /** Mark msg_ids seen without an ingest (e.g. delivered live already). */
    async markSeen(roomId, msgIds) {
        await this.load();
        if (msgIds.length === 0)
            return;
        const seen = this.seenSet(roomId);
        const list = this.state.seen[roomId] ?? [];
        for (const id of msgIds) {
            if (!seen.has(id)) {
                seen.add(id);
                list.push(id);
            }
        }
        while (list.length > SEEN_CAP)
            list.shift();
        this.state.seen[roomId] = list;
        await this.persist();
    }
    /** Whether a msg_id has been seen in a room. */
    async hasSeen(roomId, msgId) {
        await this.load();
        return this.seenSet(roomId).has(msgId);
    }
    /** Forget everything (e.g. identity purge). */
    async clear() {
        this.state = { seen: {} };
        await this.persist();
    }
}
