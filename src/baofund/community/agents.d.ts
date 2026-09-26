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
import { type JoinLinkOptions } from './client.js';
import type { ChatRoomEntry } from './provision.js';
export interface LinkPrivacy {
    roomId: string;
    shielded: boolean;
    inviteId?: string;
    audience?: 'human' | 'agent';
    label?: string;
    maxUses?: number;
    expiresAt?: number;
    relay?: string;
    welcomerPub?: string;
    routingId?: string;
}
/** The agent's conscious branch point. Never guesses: every field is
 *  explicitly present-or-absent from the fragment. */
export declare function roomLinkPrivacy(link: string): LinkPrivacy;
export interface AgentManifest {
    /** Always 'agent' — a room's manifest is for its agent lane. */
    aud: 'agent';
    name?: string;
    /** Capability labels, e.g. ['post', 'cite', 'attest']. Free-form but
     *  lowercase/dash — consumers match exact strings. */
    capabilities: string[];
}
/**
 * Extract the optional `agents` manifest from a room-metadata event's
 * content (kind 39000, governance-signed). Tolerant: not present, not JSON,
 * or malformed → null (room has no advertised agent manifest).
 */
export declare function agentManifestFromMeta(event: {
    content: string;
}): AgentManifest | null;
/**
 * Build an aud:'agent' join link with a compact capability summary in the
 * label (≤80 chars, e.g. `agent:post,cite,attest`). Opts mirror
 * buildJoinLink/provision — callers supply relay/welcomer master/shield as
 * their app's wrapper dictates.
 */
export declare function buildAgentLink(host: string, entry: Pick<ChatRoomEntry, 'roomId' | 'inviteSecret'>, opts?: JoinLinkOptions & {
    /** Capabilities summary → label (default none — label only when caps). */
    capabilities?: string[];
}): string;
