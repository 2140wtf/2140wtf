/**
 * retract — author-side message deletion (§7 payload convention, NO wire
 * change). Final-boss blocker B4: governance could redact anything, but
 * AUTHORS could delete nothing of their own.
 *
 * A retraction is an ordinary envelope `{ retract: <parent msg_id> }`. The
 * scroll is append-only — the parent cannot be un-published — so folding
 * produces a TOMBSTONE: aggregateRetractions maps msg_id → retraction, and
 * every view excludes retracted messages exactly like governance redactions.
 *
 * Authority: a retraction binds only when its ENVELOPE AUTHOR equals the
 * original message's author (you can only delete your own words). Anything
 * else is ignored by the fold — moderator removal stays on the governance
 * redaction list (kind 31146), which outranks author retraction.
 */
import type { MergedMessage } from './merge.js';
/** Build a retraction payload. */
export declare function buildRetract(target: string): Record<string, unknown>;
/** Parse a retraction payload, or null when absent/invalid. */
export declare function parseRetract(payload: unknown): {
    target: string;
} | null;
export interface RetractionState {
    /** msg_id → author key of the retractor (== original author when valid). */
    retracted: Map<string, string>;
    /** Retractions whose parent is not in this scroll (purged/older window). */
    dangling: {
        target: string;
        from: string;
    }[];
}
/**
 * Fold retractions out of a merged scroll. A tombstone applies ONLY when
 * the retractor's envelope author matches the parent's author — enforced
 * here so callers cannot mis-apply someone else's delete.
 */
export declare function foldRetractions(messages: MergedMessage[]): RetractionState;
