/**
 * Receipts — spec §3. Retry-until-scrolled tracker.
 *
 * - Receipt timeout = 3× flush deadline.
 * - A message is CENSORED (omitted) when absent from 2 consecutive segments
 *   of every listed scribe.
 */
import { type Envelope } from './envelope.js';
export type ReceiptState = 'pending' | 'confirmed' | 'censored' | 'timeout';
export interface TrackedMessage {
    key: string;
    envelope: Envelope;
    sentAtMs: number;
    resendCount: number;
    state: ReceiptState;
}
export interface ReceiptTrackerOptions {
    flushDeadlineMs: number;
    now?: () => number;
}
export declare class ReceiptTracker {
    private readonly timeoutMs;
    private readonly now;
    private readonly messages;
    constructor(opts: ReceiptTrackerOptions);
    track(envelope: Envelope): TrackedMessage;
    /**
     * Observe scroll coverage. `segments` per scribe MUST carry created_at;
     * only segments published AT/AFTER the message was sent count — segments
     * that pre-date the send can never contain it, and counting them produced
     * false censorship verdicts (post-audit bug).
     */
    observe(scribeCoverage: Map<string, {
        segments: {
            keys: Set<string>;
            createdAt: number;
        }[];
    }>, 
    /** Full-scroll contents from a complete read, when the caller has one —
     *  resolves "scrolled long ago" vs "never scrolled" (restart/late-sub
     *  false censorship, post-audit D1). */
    scrollKeys?: Set<string>): void;
    /** Keys still awaiting a receipt past the timeout (retry candidates). */
    retryCandidates(): TrackedMessage[];
    get(key: string): TrackedMessage | undefined;
    all(): TrackedMessage[];
}
