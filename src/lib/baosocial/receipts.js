/**
 * Receipts — spec §3. Retry-until-scrolled tracker.
 *
 * - Receipt timeout = 3× flush deadline.
 * - A message is CENSORED (omitted) when absent from 2 consecutive segments
 *   of every listed scribe.
 */
import { dedupKey } from './envelope.js';
export class ReceiptTracker {
    constructor(opts) {
        this.messages = new Map();
        this.timeoutMs = 3 * opts.flushDeadlineMs; // §3: 3× flush deadline
        this.now = opts.now ?? (() => Date.now());
    }
    track(envelope) {
        const key = dedupKey(envelope);
        const existing = this.messages.get(key);
        if (existing) {
            existing.resendCount++;
            // Resubmission after a censored/timeout verdict RESTARTS the receipt
            // window — otherwise a resubmitted message can never confirm
            // (post-review bug).
            if (existing.state !== 'pending' && existing.state !== 'confirmed') {
                existing.state = 'pending';
                existing.sentAtMs = this.now();
            }
            return existing;
        }
        const tracked = {
            key,
            envelope,
            sentAtMs: this.now(),
            resendCount: 0,
            state: 'pending',
        };
        this.messages.set(key, tracked);
        return tracked;
    }
    /**
     * Observe scroll coverage. `segments` per scribe MUST carry created_at;
     * only segments published AT/AFTER the message was sent count — segments
     * that pre-date the send can never contain it, and counting them produced
     * false censorship verdicts (post-audit bug).
     */
    observe(scribeCoverage, 
    /** Full-scroll contents from a complete read, when the caller has one —
     *  resolves "scrolled long ago" vs "never scrolled" (restart/late-sub
     *  false censorship, post-audit D1). */
    scrollKeys) {
        for (const tracked of this.messages.values()) {
            if (tracked.state === 'confirmed')
                continue; // terminal
            if (scrollKeys?.has(tracked.key)) {
                tracked.state = 'confirmed';
                continue;
            }
            const sentAtSec = Math.floor(tracked.sentAtMs / 1000);
            let confirmed = false;
            // No scribe coverage at all ⇒ no evidence of omission ⇒ never mark
            // censored (vacuous-truth over zero scribes was a false-censorship
            // bug: an empty map marked every pending message 'censored').
            let censored = scribeCoverage.size > 0;
            for (const coverage of scribeCoverage.values()) {
                const relevant = coverage.segments.filter((s) => s.createdAt >= sentAtSec).slice(-2);
                for (const seg of relevant) {
                    if (seg.keys.has(tracked.key))
                        confirmed = true;
                }
                // Censored only if ≥2 post-send segments from EVERY scribe lack it.
                if (relevant.length < 2 || relevant.some((s) => s.keys.has(tracked.key))) {
                    censored = false;
                }
            }
            // Scroll inclusion revives any non-confirmed state (censored messages
            // that get resubmitted and land ARE confirmed).
            if (confirmed)
                tracked.state = 'confirmed';
            else if (tracked.state === 'pending' && censored)
                tracked.state = 'censored';
            else if (tracked.state === 'pending' && this.now() - tracked.sentAtMs > this.timeoutMs)
                tracked.state = 'timeout';
        }
    }
    /** Keys still awaiting a receipt past the timeout (retry candidates). */
    retryCandidates() {
        const nowMs = this.now();
        return [...this.messages.values()].filter((m) => m.state === 'pending' && nowMs - m.sentAtMs > this.timeoutMs);
    }
    get(key) {
        return this.messages.get(key);
    }
    all() {
        return [...this.messages.values()];
    }
}
