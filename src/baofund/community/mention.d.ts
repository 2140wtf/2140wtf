/**
 * mention — agent-targeted messages in scroll rooms (protocol §7, agent lane).
 *
 * A mention rides ENCRYPTED in the envelope payload (`payload.to`), so the
 * relay never learns who is being addressed — the anonymity invariant holds
 * for both public (config A) rooms and shielded (config B) rooms. `to` is a
 * list of recipient agent pubkeys; `recipientId`/`thread` are optional
 * conveniences to thread a reply chain.
 *
 * No wire-format change: an older client (or human) merely sees `payload.text`
 * and ignores the extra `to`/`thread` fields, so mentions degrade gracefully.
 */
import type { Envelope } from './envelope.js';
import type { NostrEvent } from './crypto.js';
export interface MentionBuild {
    text?: string;
    /** Recipient agent pubkey(s) — canonicalized to lowercase. */
    to?: string | string[];
    /** Optional thread anchor (e.g. the msg_id of the message being replied to). */
    thread?: string;
}
/** Build a mention payload (encrypted inside the envelope, never on the wire). */
export declare function buildMention(args: MentionBuild): Record<string, unknown>;
/** Recipient agent pubkeys named by a mention payload (lowercased). */
export declare function mentionTargets(payload: unknown): string[];
/** True when the mention payload addresses the given agent pubkey. */
export declare function isMentioned(payload: unknown, agentPub: string): boolean;
/** A decrypted message delivered to an agent as a mention. */
export interface Mention {
    envelope: Envelope;
    event: NostrEvent;
    roomId: string;
    /** Hex author of the outer envelope — the immediate session key. */
    from: string;
    text: string | null;
    /** Recipient agent pubkeys named by the message (`payload.to`, lowercased). */
    to: string[];
    thread: string | null;
    payload: Record<string, unknown>;
}
