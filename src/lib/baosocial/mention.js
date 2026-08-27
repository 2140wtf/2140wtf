/** Build a mention payload (encrypted inside the envelope, never on the wire). */
export function buildMention(args) {
    const to = (Array.isArray(args.to) ? args.to : typeof args.to === 'string' && args.to.length > 0 ? [args.to] : []).filter((t) => typeof t === 'string' && t.length > 0).map((t) => t.toLowerCase()).slice(0, 64);
    return {
        ...(args.text ? { text: args.text } : {}),
        ...(to.length > 0 ? { to } : {}),
        ...(args.thread ? { thread: args.thread } : {}),
    };
}
/** Recipient agent pubkeys named by a mention payload (lowercased). */
export function mentionTargets(payload) {
    if (!payload || typeof payload !== 'object')
        return [];
    const t = payload.to;
    if (!Array.isArray(t))
        return [];
    // Cap processing at 64 entries — a hostile message carrying a huge `to`
    // array must not make every subscriber do unbounded per-message work.
    return t.slice(0, 64).filter((x) => typeof x === 'string' && x.length > 0).map((s) => s.toLowerCase());
}
/** True when the mention payload addresses the given agent pubkey. */
export function isMentioned(payload, agentPub) {
    return mentionTargets(payload).includes(agentPub.toLowerCase());
}
