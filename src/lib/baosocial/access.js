/**
 * access — agent admission policy (protocol §7 admission, agent lane).
 *
 * Ported from bao.markets' AgentAccessPolicy (none / selected / all) onto
 * protocol-native primitives: `aud:"agent"` join links + kind 39998
 * founder attestations. Pure and neutral — inputs are passed in; this
 * module never touches the relay and never reads process.env.
 *
 *   - policy 'none'     an agent join is rejected outright
 *   - policy 'all'      any agent identity on the join is admitted
 *   - policy 'selected' the join is admitted only when the claimed agent
 *                       pubkey is in the room's allowlist OR the founder's
 *                       attestation list
 *
 * Humans (no agent identity claimed on a join) are never gated here — the
 * room's base joiner policy (open / cap-pow / invite) governs them. An
 * agent's identity rides INSIDE the NIP-44-encrypted join request, so the
 * relay never sees it; only the welcomer and the agent know.
 */
// ─── Types ────────────────────────────────────────────────────────────────
import { verifyAgentAdmission } from './nipOa.js';
// ─── Pure admission ───────────────────────────────────────────────────────
/** Decide whether an agent join is admitted. Humans (no agentPub) always
 *  fall through to the room's base joiner policy — the verdict is 'admit'
 *  with reason 'no-agent-lane'. */
export function evaluateAgentAdmission(cfg, ctx = {}) {
    if (!ctx.agentPub || !/^[0-9a-f]{64}$/.test(ctx.agentPub)) {
        return { verdict: 'admit', reason: 'no-agent-lane' };
    }
    switch (cfg.policy) {
        case 'none':
            return { verdict: 'reject', reason: 'agents-excluded' };
        case 'all':
            return { verdict: 'admit', reason: 'all-agents' };
        case 'selected': {
            if ((cfg.allowlist ?? []).includes(ctx.agentPub))
                return { verdict: 'admit', reason: 'allowlisted' };
            if ((cfg.attested ?? []).includes(ctx.agentPub))
                return { verdict: 'admit', reason: 'attested' };
            if ((cfg.oaOwners ?? []).length > 0 &&
                ctx.oa &&
                verifyAgentAdmission({
                    agentPub: ctx.agentPub,
                    authTag: ctx.oa.authTag,
                    joinProof: ctx.oa.joinProof,
                    roomId: ctx.oa.roomId,
                    burnerPub: ctx.oa.burnerPub,
                    oaOwners: cfg.oaOwners ?? [],
                    nowSec: ctx.oa.nowSec,
                })) {
                return { verdict: 'admit', reason: 'oa-attested' };
            }
            return { verdict: 'reject', reason: 'not-selected' };
        }
    }
}
/** Convenience: true when the agent join is admitted. */
export function admitAgentJoin(cfg, ctx = {}) {
    return evaluateAgentAdmission(cfg, ctx).verdict === 'admit';
}
// ─── Kind 39998 attestations (existing infra) ────────────────────────────
/** All hex agent pubkeys named by a founder attestation event (kind 39998):
 *  mirrors bao.markets' fetchAttestedAgentPubkeys — every 'agent' or 'p'
 *  tag whose value is a 64-hex pubkey. Non-hex / foreign tags are ignored. */
export function attestationAgents(event) {
    const agents = new Set();
    for (const t of event.tags) {
        if ((t[0] === 'agent' || t[0] === 'p') && /^[0-9a-f]{64}$/.test(t[1] ?? '')) {
            agents.add(t[1]);
        }
    }
    return [...agents];
}
export function isAttested(attested, pubkey) {
    return attested.includes(pubkey);
}
// ─── Rooms-file serialization (tolerant, like parseRetention/parsePolicy) ─
/**
 * Parse a rooms-file agent policy: 'none' | 'all' | 'selected' |
 * 'selected:<hex>[,<hex>…]'. The plain forms mirror the legacy policy
 * strings; the list form carries the room's allowlist inline so operators
 * provisioning via the rooms file need no separate field. Unknown spec →
 * throw (a foreign entry must surface, never silently become 'all').
 */
export function parseAgentPolicy(spec) {
    if (!spec || spec === 'none')
        return { policy: 'none', allowlist: [] };
    if (spec === 'all')
        return { policy: 'all', allowlist: [] };
    if (spec === 'selected')
        return { policy: 'selected', allowlist: [] };
    const [head, ...rest] = spec.split(':');
    if (head === 'selected') {
        const allowlist = rest.length > 0 ? rest.join(':').split(',').filter((p) => /^[0-9a-f]{64}$/.test(p)) : [];
        return { policy: 'selected', allowlist };
    }
    throw new Error(`unknown agent policy: ${spec}`);
}
