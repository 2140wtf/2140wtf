/** Build a retraction payload. */
export function buildRetract(target) {
    if (!/^[0-9a-f]{32}$/.test(target))
        throw new Error('retract target must be an envelope msg_id (32 hex chars)');
    return { retract: target };
}
/** Parse a retraction payload, or null when absent/invalid. */
export function parseRetract(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const r = payload.retract;
    return typeof r === 'string' && /^[0-9a-f]{32}$/.test(r) ? { target: r } : null;
}
/**
 * Fold retractions out of a merged scroll. A tombstone applies ONLY when
 * the retractor's envelope author matches the parent's author — enforced
 * here so callers cannot mis-apply someone else's delete.
 */
export function foldRetractions(messages) {
    const state = { retracted: new Map(), dangling: [] };
    // msg_id is only unique PER AUTHOR (dedup key is (author, msg_id)) — collect
    // every author claiming an id. A msg_id with more than one distinct author
    // is AMBIGUOUS: no retraction may apply to it, because the global tombstone
    // (keyed by msg_id) would hide the other author's message too. Without this
    // guard a byzantine member can collide its own msg_id with a victim's and
    // then "retract its own words" to delete the victim's message.
    const authorsByMsgId = new Map();
    for (const m of messages) {
        if (m.redacted)
            continue;
        let authors = authorsByMsgId.get(m.envelope.msg_id);
        if (!authors) {
            authors = new Set();
            authorsByMsgId.set(m.envelope.msg_id, authors);
        }
        authors.add(m.envelope.author);
    }
    for (const m of messages) {
        if (m.redacted)
            continue; // a governance-redacted retraction is void
        const r = parseRetract(m.envelope.payload);
        if (!r)
            continue;
        const authors = authorsByMsgId.get(r.target);
        if (authors === undefined) {
            state.dangling.push({ target: r.target, from: m.envelope.author });
            continue;
        }
        if (authors.size !== 1)
            continue; // ambiguous msg_id — never tombstone
        const originalAuthor = authors.values().next().value;
        if (originalAuthor !== m.envelope.author)
            continue; // NOT your message
        // Latest-in-scroll wins naturally: later envelopes overwrite.
        state.retracted.set(r.target, m.envelope.author);
    }
    return state;
}
