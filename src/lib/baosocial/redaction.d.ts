/**
 * Redaction list — spec §3, §11. Kind 31146, d = bao-redact:<roomId>,
 * governance-key-authored, room-encrypted. Clients enforce at render time.
 *
 * State semantics = design rule 4: state is a pure function of the entry
 * set, folded in (created_at, id) lexicographic order; latest-state-wins;
 * arrival order never matters. This is the only union-merge-safe redaction
 * mechanism — rewriting one scribe's segment does nothing to another's copy.
 */
import { type NostrEvent, type Clock, type Rng } from './crypto.js';
export interface RedactionEntry {
    author: string;
    msg_id: string;
    action: 'redact' | 'unredact';
    reason: string;
    /** Wall-clock seconds, governance side. */
    ts: number;
}
export interface RedactionListContext {
    roomId: string;
    encKey: Uint8Array;
    /** Opaque on-wire scope (scrollScope(deriveScrollWrapperKey(encKey), roomId))
     *  — callers compute once; the roomId never hits the wire. */
    scope: string;
}
export declare function encodeRedactionListEvent(entries: RedactionEntry[], governanceSecretKey: Uint8Array, ctx: RedactionListContext, previousCreatedAt?: number, clock?: Clock, rng?: Rng): NostrEvent;
export declare function decodeRedactionListEvent(event: NostrEvent, ctx: RedactionListContext, governancePubkey: string): RedactionEntry[];
/**
 * Fold entries into the current redaction state (rule 4): sort by
 * (ts, author:msg_id), last write per key wins; an exact (ts, key) tie is
 * broken deterministically — 'redact' beats 'unredact' (fail-closed).
 * Arrival order never matters.
 */
export declare function foldRedactionState(entries: RedactionEntry[]): Set<string>;
export declare function isRedacted(entries: RedactionEntry[], author: string, msgId: string): boolean;
