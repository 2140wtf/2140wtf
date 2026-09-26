import { type NostrEvent } from './crypto.js';
export declare const ROOM_DIR_D_PREFIX = "bao-room:";
/** Default lease before a directory row expires without a heartbeat. */
export declare const DIRECTORY_LEASE_SECS: number;
export declare function deriveDirectoryPubkey(master: Uint8Array): string;
export interface DirectoryRoom {
    roomId: string;
    /** Public display name (1–80 chars). */
    name: string;
    /** Public topic (≤200 chars). */
    topic?: string;
    /** Admission posture advertised to joiners: open | cap-pow | invite. */
    policy: 'open' | 'cap-pow' | 'invite';
}
/**
 * Author the upsert event AS the deployment directory key. Signed by that
 * key alone — verifier checks authorship, nothing embedded.
 */
export declare function buildRoomDirectoryEvent(directorySecretKey: Uint8Array, room: DirectoryRoom, opts?: {
    nowSec?: number;
    leaseSecs?: number;
    replaceId?: string;
}): NostrEvent;
/** Kind-5 tombstone closing a room's directory row. */
export declare function buildRoomDirectoryDelete(directorySecretKey: Uint8Array, rowEventId: string, opts?: {
    nowSec?: number;
}): NostrEvent;
export interface DirectoryEntry extends DirectoryRoom {
    roomId: string;
    /** Row event id (for kind-5 deletes / e-tag replacement). */
    eventId: string;
    createdAt: number;
    /** Lease deadline from the expiration tag (absent → 0 = no lease). */
    expiresAt: number;
}
export interface ParseOk {
    ok: true;
    entry: DirectoryEntry;
}
export interface ParseBad {
    ok: false;
    reason: string;
}
/**
 * Structural validation ONLY (shape, d-prefix, policy vocabulary).
 * Authorship is enforced by the caller's subscription filter AND by
 * foldDirectory when an expected author is pinned.
 */
export declare function parseRoomDirectoryEvent(ev: NostrEvent): ParseOk | ParseBad;
/**
 * Fold raw relay events into the current directory view.
 *
 * Rule 4 semantics: latest-state-wins per roomId by (created_at,id) —
 * arrival order never matters. Deletes (kind 5 authored by the SAME
 * directory key, e-tagging the row id) remove rows. Expired leases are
 * filtered when nowSec is provided (callers SHOULD pass it; relays that
 * enforce NIP-40 do this server-side, others need the client check).
 *
 * expectedAuthor pins single-deployment trust: rows authored by anything
 * else are rejected (forged/cross-posted), never folded.
 */
export declare function foldDirectory(events: NostrEvent[], opts?: {
    expectedAuthor?: string;
    nowSec?: number;
}): Map<string, DirectoryEntry>;
/** Hex convenience re-export guard (keeps import list honest for callers). */
