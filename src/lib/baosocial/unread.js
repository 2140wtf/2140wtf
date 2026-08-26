const KEY_PREFIX = 'bao-unread-v1:';
/** Cap per-room stored msg_id history to bound KV growth. */
const HISTORY_CAP = 4096;
/**
 * Per-agent-per-room unread tracker. Feed merged scrolls; it reports what
 * arrived since the last markRead and persists the read position.
 */
export class UnreadTracker {
    constructor(store) {
        this.state = new Map();
        this.loaded = false;
        this.store = store;
    }
    storageKey() {
        // Read state is per identity; callers namespace by passing distinct
        // stores per identity (same contract as MentionInbox).
        return `${KEY_PREFIX}rooms`;
    }
    async load() {
        if (this.loaded || !this.store) {
            this.loaded = true;
            return;
        }
        try {
            const raw = await this.store.get(this.storageKey());
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    for (const [roomId, st] of Object.entries(parsed)) {
                        if (st && Array.isArray(st.seen))
                            this.state.set(roomId, { seen: st.seen });
                    }
                }
            }
        }
        catch {
            // Corrupt/absent → start empty; worst case re-surfaces old messages once.
        }
        this.loaded = true;
    }
    async persist() {
        if (!this.store)
            return;
        const out = {};
        for (const [k, v] of this.state)
            out[k] = v;
        await this.store.set(this.storageKey(), JSON.stringify(out));
    }
    /**
     * Fold a scroll: returns every non-redacted message whose dedup key was
     * not yet marked read, oldest first. Does NOT advance the position —
     * call markRead when the app actually SHOWS them.
     */
    async peek(roomId, messages) {
        await this.load();
        const st = this.state.get(roomId);
        const firstRead = !st;
        const seen = new Set(st?.seen ?? []);
        const live = messages.filter((m) => !m.redacted);
        const unread = live.filter((m) => !seen.has(`${m.envelope.author}:${m.envelope.msg_id}`));
        return { unread, count: unread.length, firstRead };
    }
    /** Advance the read position to include these messages' keys. */
    async markRead(roomId, messages) {
        await this.load();
        const st = this.state.get(roomId) ?? { seen: [] };
        const have = new Set(st.seen);
        const live = messages.filter((m) => !m.redacted);
        for (const m of live) {
            const key = `${m.envelope.author}:${m.envelope.msg_id}`;
            if (!have.has(key)) {
                have.add(key);
                st.seen.push(key);
            }
        }
        while (st.seen.length > HISTORY_CAP)
            st.seen.shift();
        this.state.set(roomId, st);
        await this.persist();
    }
    /** Convenience: report + advance in one call (open-room behavior). */
    async consume(roomId, messages) {
        const report = await this.peek(roomId, messages);
        if (report.unread.length > 0 || report.firstRead)
            await this.markRead(roomId, messages);
        return report;
    }
    /** Forget one room's position (e.g. left the room). */
    async clearRoom(roomId) {
        await this.load();
        this.state.delete(roomId);
        await this.persist();
    }
    /** Forget everything (identity purge). */
    async clear() {
        await this.load();
        this.state.clear();
        await this.persist();
    }
}
