/**
 * agentJoin — pure state mapping shared by the CLI and the MCP server
 * (plan P6a MCP-parity fix: shell-less harnesses must be able to JOIN).
 *
 * The MCP server's bao_join tool persists exactly the same room entry the
 * CLI's `join` verb does — one mapping, two surfaces, no drift.
 */
import type { JoinedRoom } from './client.js';
/**
 * Both key domains a mention may target: the durable identity pubkey AND
 * the room's author key (roster/@handle resolution targets the latter).
 * Shared by CLI and MCP — one implementation, two surfaces, no drift.
 */
export declare function myMentionKeys(state: {
    pubkey: string;
}, authorSecretKey: Uint8Array | string | {
    joined: {
        authorSecretKey: Uint8Array | string;
    };
}): string[];
/** Shape persisted under state.rooms[roomId] by both agent surfaces. */
export interface AgentStateRoom {
    roomId: string;
    epoch: number;
    encKey: string;
    routingId: string;
    scribes: string[];
    governance: string | string[];
    authorSecretKey: string;
    relay: string;
    joinedAt: number;
    /** P2 ratchet state — without these a future session cannot follow
     *  epoch advances (§8). */
    chainKey?: string;
    previousEncKey?: string;
    previousEpoch?: number;
}
export declare function roomEntryFromJoined(joined: JoinedRoom, relay: string, nowSec?: number): AgentStateRoom;
