/**
 * agents — agent-facing room primitives (protocol §7, P5: agents in-room).
 *
 * Two things agents need on top of the plain join link:
 *
 *  1. `roomLinkPrivacy(link)` — a deliberate BRANCH POINT instead of
 *     guessing from fragment field presence. An AI agent consuming a link
 *     decides join vs request-invite vs render-only from this summary, and
 *     knows up-front whether the room is shielded (config B) — in which
 *     case it MUST upload via gift wrap.
 *
 *  2. `agentManifestFromMeta` — the room's capability manifest as carried
 *     by the governance-signed room metadata (kind 39000, optional
 *     `agents` section). Tolerant: missing/garbage → null. Advertises what
 *     agents may do in the room (post, cite, attest, …) so the room's
 *     affordances are discoverable without a web host.
 *
 * Pure + neutral — no env, no relay I/O.
 */
import { parseJoinLink, createJoinLink } from './client.js';
/** The agent's conscious branch point. Never guesses: every field is
 *  explicitly present-or-absent from the fragment. */
export function roomLinkPrivacy(link) {
    const p = parseJoinLink(link);
    return {
        roomId: p.roomId,
        shielded: Boolean(p.shield),
        ...(p.linkId ? { inviteId: p.linkId } : {}),
        ...(p.audience ? { audience: p.audience } : {}),
        ...(p.label ? { label: p.label } : {}),
        ...(p.maxUses !== undefined ? { maxUses: p.maxUses } : {}),
        ...(p.expiresAt !== undefined ? { expiresAt: p.expiresAt } : {}),
        ...(p.relay ? { relay: p.relay } : {}),
        ...(p.welcomerPub ? { welcomerPub: p.welcomerPub } : {}),
        ...(p.routingId ? { routingId: p.routingId } : {}),
    };
}
/**
 * Extract the optional `agents` manifest from a room-metadata event's
 * content (kind 39000, governance-signed). Tolerant: not present, not JSON,
 * or malformed → null (room has no advertised agent manifest).
 */
export function agentManifestFromMeta(event) {
    let parsed;
    try {
        parsed = JSON.parse(event.content);
    }
    catch {
        return null;
    }
    const agents = parsed?.agents;
    if (!agents || typeof agents !== 'object')
        return null;
    const a = agents;
    const capabilities = Array.isArray(a.capabilities)
        ? a.capabilities.filter((c) => typeof c === 'string' && c.length > 0)
        : [];
    if (capabilities.length === 0 && !a.name)
        return null;
    return {
        aud: 'agent',
        ...(typeof a.name === 'string' && a.name.length > 0 ? { name: a.name.slice(0, 80) } : {}),
        capabilities,
    };
}
/**
 * Build an aud:'agent' join link with a compact capability summary in the
 * label (≤80 chars, e.g. `agent:post,cite,attest`). Opts mirror
 * buildJoinLink/provision — callers supply relay/welcomer master/shield as
 * their app's wrapper dictates.
 */
export function buildAgentLink(host, entry, opts = {}) {
    const { capabilities, ...linkOpts } = opts;
    const label = linkOpts.label ?? (capabilities && capabilities.length > 0 ? `agent:${capabilities.join(',')}` : undefined);
    return createJoinLink(host, entry.inviteSecret, entry.roomId, {
        ...linkOpts,
        audience: 'agent',
        ...(label ? { label } : {}),
    });
}
