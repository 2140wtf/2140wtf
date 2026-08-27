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
    const authorByMsgId = new Map();
    for (const m of messages) {
        if (m.redacted)
            continue;
        authorByMsgId.set(m.envelope.msg_id, m.envelope.author);
    }
    for (const m of messages) {
        if (m.redacted)
            continue; // a governance-redacted retraction is void
        const r = parseRetract(m.envelope.payload);
        if (!r)
            continue;
        const originalAuthor = authorByMsgId.get(r.target);
        if (originalAuthor === undefined) {
            state.dangling.push({ target: r.target, from: m.envelope.author });
            continue;
        }
        if (originalAuthor !== m.envelope.author)
            continue; // NOT your message
        // Latest-in-scroll wins naturally: later envelopes overwrite.
        state.retracted.set(r.target, m.envelope.author);
    }
    return state;
}
