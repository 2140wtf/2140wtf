/**
 * Canonical client merge — spec §3.3.
 *
 * 1. Take segments from all listed scribes.
 * 2. Verify every segment signature against the signed scribe list; reject
 *    segments from unlisted keys.
 * 3. Dedup by (author, msg_id).
 * 4. Apply the redaction list (latest-state-wins, rule 4).
 * 5. Render order: per-scribe (seg#, position); cross-scribe tie-break by
 *    msg_id. Cross-scribe order is approximate by design.
 */
import { type NostrEvent } from './crypto.js';
import { type SegmentContext } from './segment.js';
import { type RedactionEntry } from './redaction.js';
import { type Envelope } from './envelope.js';
export interface MergedMessage {
    envelope: Envelope;
    /** Which scribes included this message (pubkeys). */
    scribes: string[];
    redacted: boolean;
}
export interface MergeResult {
    messages: MergedMessage[];
    /** Events rejected and why — diagnostics for misbehaving scribes. */
    rejected: {
        eventId: string;
        reason: string;
    }[];
    /** Scribes whose scroll covers a given (author, msg_id) — omission input. */
    coverage: Map<string, Set<string>>;
    /**
     * Prev-chain anomalies per scribe (spec §3.2 tamper-evidence): broken
     * prev links and seg# gaps. A gap can be legitimate retention (expired
     * segments are purged) — but an *interior* gap or wrong prev on a live
     * chain is evidence of scribe tampering. Surfaced, never silently merged.
     */
    chainWarnings: string[];
}
export interface MergeOptions {
    /** Signed scribe list (pubkeys) from room metadata. */
    scribes: string[];
    ctx: SegmentContext;
    redactions?: RedactionEntry[];
}
export declare function mergeScrolls(events: NostrEvent[], opts: MergeOptions): MergeResult;
