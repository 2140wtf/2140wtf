/**
 * invite-v2 — welcomer-enforced per-invite admission (protocol §7, P5).
 *
 * Config-B super-private rooms distribute PERSONAL invite links: each link
 * carries a link id (`lid`), and the operator provisions per-link limits —
 * `maxUses` (how many joins the link admits; 1 = single-use) and `expiry`
 * (unix seconds; 0 = never). The welcomer ENFORCES these bounds, not the
 * client: a joiner can never extend its own invite.
 *
 * The link itself carries `lid` (+ optional `maxUses`/`expiresAt` fields for
 * human/agent display); the join request echoes `lid` inside the
 * NIP-44-encrypted payload; the welcomer looks the lid up in its PROVISIONED
 * invite config (rooms file), checks expiry + remaining uses, and burns a use
 * only on a successful admission. Pure + neutral — no env, no relay I/O;
 * use-state is passed in so daemons decide persistence (in-memory today).
 */
/**
 * Evaluate one join against the room's invite-v2 config.
 *
 * @param config   the room's provisioned invites (empty → invite-v2 not in play)
 * @param ctx      roomId (reserved for future per-room namespacing; must match
 *                 the lid's room), the lid claimed by the joiner, and the
 *                 CURRENT number of uses the lid has consumed
 */
export function evaluateInvite(config, ctx) {
    const lids = Object.keys(config);
    if (lids.length === 0)
        return { verdict: 'admit', reason: 'no-invite-v2' };
    if (!ctx.lid)
        return { verdict: 'reject', reason: 'missing-lid' };
    const spec = config[ctx.lid];
    if (!spec)
        return { verdict: 'reject', reason: 'unknown-lid' };
    if (spec.expiry > 0 && ctx.nowSec >= spec.expiry)
        return { verdict: 'reject', reason: 'expired' };
    if (ctx.uses >= spec.maxUses)
        return { verdict: 'reject', reason: 'exhausted' };
    return { verdict: 'admit', reason: 'ok' };
}
/**
 * Parse the rooms-file invite config form:
 * `[{ "lid": "abc", "maxUses": 1, "expiry": 0 }]` — or an object map
 * `{ "abc": { "maxUses": 1, "expiry": 0 } }`. Tolerant like
 * parseRetention: unknown entries are skipped, never fatal.
 */
export function parseInviteConfig(raw) {
    const out = {};
    const push = (lid, spec) => {
        if (typeof lid !== 'string' || lid.length === 0)
            return;
        const s = spec;
        if (typeof s?.maxUses !== 'number' || !Number.isFinite(s.maxUses) || s.maxUses < 1)
            return;
        const expiry = typeof s.expiry === 'number' && Number.isFinite(s.expiry) ? Math.max(0, Math.floor(s.expiry)) : 0;
        out[lid] = { lid, maxUses: Math.floor(s.maxUses), expiry };
    };
    if (Array.isArray(raw))
        for (const item of raw)
            push(item?.lid, item);
    else if (raw && typeof raw === 'object')
        for (const [lid, spec] of Object.entries(raw))
            push(lid, spec);
    return out;
}
