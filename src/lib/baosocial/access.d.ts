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
export type AgentAccessPolicy = 'none' | 'selected' | 'all';
export interface AgentAdmissionConfig {
    policy: AgentAccessPolicy;
    /** Room-provisioned allowlist — honored when policy === 'selected'. */
    allowlist?: string[];
    /** Founder-attested agent pubkeys (kind 39998) — honored when
     *  policy === 'selected'. */
    attested?: string[];
    /** NIP-OA owner pubkeys — honored when policy === 'selected': an agent
     *  carrying a valid owner attestation (auth tag) from ANY listed owner
     *  is admitted. This is the external-agent lane (Buzz & co.): provenance
     *  without a room-specific allowlist entry. */
    oaOwners?: string[];
}
export interface AgentJoinContext {
    /** Agent identity claimed on the join request. Absent for human joins. */
    agentPub?: string;
    /** NIP-OA evidence carried in the encrypted join payload (required when
     *  the 'oaOwners' lane should be evaluated): the raw auth tag plus the
     *  agent-key join proof binding the claim to this room and burner. */
    oa?: {
        authTag: unknown;
        joinProof: string;
        roomId: string;
        burnerPub: string;
        nowSec?: number;
    };
}
export type AgentAdmissionVerdict = 'admit' | 'reject';
export type AgentAdmissionReason = 'no-agent-lane' | 'all-agents' | 'allowlisted' | 'attested' | 'oa-attested' | 'agents-excluded' | 'not-selected';
export interface AgentAdmissionResult {
    verdict: AgentAdmissionVerdict;
    reason: AgentAdmissionReason;
}
/** Decide whether an agent join is admitted. Humans (no agentPub) always
 *  fall through to the room's base joiner policy — the verdict is 'admit'
 *  with reason 'no-agent-lane'. */
export declare function evaluateAgentAdmission(cfg: AgentAdmissionConfig, ctx?: AgentJoinContext): AgentAdmissionResult;
/** Convenience: true when the agent join is admitted. */
export declare function admitAgentJoin(cfg: AgentAdmissionConfig, ctx?: AgentJoinContext): boolean;
/** All hex agent pubkeys named by a founder attestation event (kind 39998):
 *  mirrors bao.markets' fetchAttestedAgentPubkeys — every 'agent' or 'p'
 *  tag whose value is a 64-hex pubkey. Non-hex / foreign tags are ignored. */
export declare function attestationAgents(event: {
    tags: string[][];
}): string[];
export declare function isAttested(attested: string[], pubkey: string): boolean;
/**
 * Parse a rooms-file agent policy: 'none' | 'all' | 'selected' |
 * 'selected:<hex>[,<hex>…]'. The plain forms mirror the legacy policy
 * strings; the list form carries the room's allowlist inline so operators
 * provisioning via the rooms file need no separate field. Unknown spec →
 * throw (a foreign entry must surface, never silently become 'all').
 */
export declare function parseAgentPolicy(spec: string | undefined): {
    policy: AgentAccessPolicy;
    allowlist: string[];
};
