/** envelope.msg_id format — 16 bytes hex. */
const MSG_ID_RE = /^[0-9a-f]{32}$/;
const MAX_EMOJI_BYTES = 32;
const MAX_LANG_CHARS = 32;
const MAX_CODE_CHARS = 8192;
function isMsgId(x) {
    return typeof x === 'string' && MSG_ID_RE.test(x);
}
/** Build a reply payload (encrypted inside the envelope, never on the wire). */
export function buildReply(args) {
    if (!isMsgId(args.replyTo))
        throw new Error('replyTo must be a parent envelope msg_id (32 hex chars)');
    const to = (Array.isArray(args.to) ? args.to : typeof args.to === 'string' && args.to.length > 0 ? [args.to] : []).filter((t) => typeof t === 'string' && t.length > 0).map((t) => t.toLowerCase()).slice(0, 64);
    return {
        ...(args.text ? { text: args.text } : {}),
        replyTo: args.replyTo,
        ...(to.length > 0 ? { to } : {}),
        ...(args.thread ? { thread: args.thread } : {}),
    };
}
/** msg_id this payload replies to, or null when not a reply. */
export function replyTarget(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const r = payload.replyTo;
    return isMsgId(r) ? r : null;
}
/**
 * Build a reaction payload. Reactions are client-folded by
 * (target, emoji, author) — latest envelope wins, so `remove: true`
 * retracts this author's earlier reaction to the same target.
 */
export function buildReaction(emoji, target, opts = {}) {
    if (typeof emoji !== 'string' || emoji.length === 0)
        throw new Error('reaction requires an emoji');
    if (new TextEncoder().encode(emoji).length > MAX_EMOJI_BYTES)
        throw new Error('emoji too long');
    if (!isMsgId(target))
        throw new Error('reaction target must be an envelope msg_id (32 hex chars)');
    return {
        reaction: emoji,
        target,
        ...(opts.remove ? { remove: true } : {}),
    };
}
/** Parse a reaction payload, or null when the payload is not a reaction. */
export function parseReaction(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const p = payload;
    if (typeof p.reaction !== 'string' || p.reaction.length === 0)
        return null;
    if (new TextEncoder().encode(p.reaction).length > MAX_EMOJI_BYTES)
        return null;
    if (!isMsgId(p.target))
        return null;
    return { emoji: p.reaction, target: p.target, remove: p.remove === true };
}
/** Build a code-block payload (encrypted inside the envelope, never on the wire). */
export function buildCodeBlock(source, opts = {}) {
    if (typeof source !== 'string' || source.length === 0)
        throw new Error('code block requires source');
    if (source.length > MAX_CODE_CHARS)
        throw new Error(`code block source exceeds ${MAX_CODE_CHARS} chars`);
    const lang = typeof opts.lang === 'string' && /^[a-z0-9+#-]{1,32}$/i.test(opts.lang) ? opts.lang.toLowerCase() : null;
    return {
        code: { ...(lang ? { lang } : {}), source },
        ...(opts.caption ? { text: opts.caption } : {}),
    };
}
/** Parse a code-block payload, or null when the payload carries no code. */
export function parseCodeBlock(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const c = payload.code;
    if (!c || typeof c !== 'object')
        return null;
    const { lang, source } = c;
    if (typeof source !== 'string' || source.length === 0 || source.length > MAX_CODE_CHARS)
        return null;
    return {
        lang: typeof lang === 'string' && lang.length > 0 && lang.length <= MAX_LANG_CHARS ? lang.toLowerCase() : null,
        source,
        caption: typeof payload.text === 'string' ? payload.text : null,
    };
}
