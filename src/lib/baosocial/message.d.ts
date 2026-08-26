/**
 * message — structured payload builders for scroll rooms (protocol §7).
 *
 * Every structure here rides INSIDE the NIP-44-encrypted envelope payload —
 * the relay sees ciphertext only, exactly as with mentions. No new kinds,
 * no new tags, no wire-format change: an older client merely sees
 * `payload.text` (or nothing) and ignores the extra fields, so replies,
 * reactions, and code blocks degrade gracefully.
 *
 * Message identity: envelopes are deduped and referenced by `msg_id`
 * (envelope.msg_id — 16 random bytes, hex). Replies and reactions anchor to
 * the msg_id of their parent, NOT to the outer Nostr event id: the msg_id
 * survives retry-until-scrolled republication (§3), the event id does not.
 *
 * Caps: every free-form field is length-capped so a hostile payload cannot
 * make subscribers do unbounded per-message work (same discipline as
 * mention.ts's 64-recipient cap).
 */
import type { Envelope } from './envelope.js';
import type { NostrEvent } from './crypto.js';
export interface ReplyBuild {
    text: string;
    /** msg_id of the parent envelope being replied to. */
    replyTo: string;
    /** Optional mention recipients (composes with mention.ts). */
    to?: string | string[];
    /** Optional thread anchor. */
    thread?: string;
}
/** Build a reply payload (encrypted inside the envelope, never on the wire). */
export declare function buildReply(args: ReplyBuild): Record<string, unknown>;
/** msg_id this payload replies to, or null when not a reply. */
export declare function replyTarget(payload: unknown): string | null;
export interface Reaction {
    emoji: string;
    /** msg_id of the envelope being reacted to. */
    target: string;
    /** true = retract this author's reaction to target (toggle semantics). */
    remove: boolean;
}
/**
 * Build a reaction payload. Reactions are client-folded by
 * (target, emoji, author) — latest envelope wins, so `remove: true`
 * retracts this author's earlier reaction to the same target.
 */
export declare function buildReaction(emoji: string, target: string, opts?: {
    remove?: boolean;
}): Record<string, unknown>;
/** Parse a reaction payload, or null when the payload is not a reaction. */
export declare function parseReaction(payload: unknown): Reaction | null;
/** A decrypted reaction delivered by subscribeReactions. */
export interface ReactionEvent extends Reaction {
    envelope: Envelope;
    event: NostrEvent;
    roomId: string;
    /** Hex author of the outer envelope — the immediate session key. */
    from: string;
}
export interface CodeBlock {
    /** Language hint for client-side highlighting (lowercase alnum, e.g. "ts"). */
    lang: string | null;
    source: string;
    /** Optional human caption (old clients see only this). */
    caption: string | null;
}
/** Build a code-block payload (encrypted inside the envelope, never on the wire). */
export declare function buildCodeBlock(source: string, opts?: {
    lang?: string;
    caption?: string;
}): Record<string, unknown>;
/** Parse a code-block payload, or null when the payload carries no code. */
export declare function parseCodeBlock(payload: unknown): CodeBlock | null;
