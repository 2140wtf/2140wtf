/**
 * Scribe — spec §5.1. BLIND orderer: holds NO content key. It subscribes to
 * the room's routing tag, verifies outer event signatures, dedups by event
 * id, rate-limits per author key, and packs ciphertext events into scroll
 * segments it cannot read. Members verify each packed message's signature
 * and decrypt per message (segment format v2).
 *
 * Retention: each scribe purges its OWN expired segments via kind-5
 * addressed to its local segment log (e-tags AND a-tags — rule 3, never a
 * discovery query). The purge is only committed to the log after the
 * deletion is actually published (see commitPurge).
 */
import { type NostrEvent, type Clock, findTag } from './crypto.js';
import { type FlushReason } from './segment.js';
/** NIP-44 ciphertext of a max-bucket (16 KB) envelope is ~21.9k chars; an
 *  event whose content exceeds this can never scroll — reject at ingest. */
export declare const MAX_ENVELOPE_CONTENT_CHARS = 22000;
export declare class RateLimiter {
    private readonly capacity;
    private readonly refillPerSec;
    private readonly nowMs;
    private readonly buckets;
    constructor(capacity: number, refillPerSec: number, nowMs?: () => number);
    allow(key: string): boolean;
    private evict;
    get size(): number;
}
/**
 * Rate budget per standing tier (§7): 'weak' gates (PoW-only) admit to a
 * slow lane; strong credentials earn a bigger budget. The blind scribe
 * cannot resolve tiers itself (it holds no content key, cannot read
 * attestations) — the provisioned `tierOf` roster hook maps the visible
 * author pubkey → tier (scribe-visible pseudonym roster, §9 P2+ hardening;
 * stream keys rotate per epoch and scribes already see posting keys).
 */
export interface TierBudget {
    /** Burst capacity (messages). */
    capacity: number;
    /** Sustained refill (messages per second). */
    refillPerSec: number;
}
/** tier name → budget. MUST include a 'default' tier — unknown authors
 *  (no roster entry) fall back to it. */
export type TierBudgetTable = Record<string, TierBudget>;
/** Default single-tier table: current flat behavior preserved. */
export declare function defaultTierTable(capacity?: number, refillPerSec?: number): TierBudgetTable;
/** One RateLimiter per tier; authors are bucketed inside their tier only,
 *  so a slow-lane spammer cannot drain a verified member's budget.
 *  NOTE: moving an author BETWEEN tiers starts them at a full bucket in
 *  the new tier (buckets are keyed per tier) — accepted: the roster is
 *  operator-provisioned, but a flapping tierOf hook would hand out
 *  budget. Provision stable rosters. */
export declare class TieredRateLimiter {
    private readonly tierOf;
    private readonly tiers;
    constructor(table: TierBudgetTable, tierOf: (authorPub: string) => string, nowMs?: () => number);
    /** Charge the author's tier bucket. Unknown tier names fall back to
     *  'default' (a stale roster entry must never shed a member silently). */
    allow(authorPub: string): boolean;
    get size(): number;
}
export interface SegmentLogEntry {
    seg: number;
    eventId: string;
    createdAt: number;
    messageCount: number;
}
export declare class SegmentLog {
    entries: SegmentLogEntry[];
    record(entry: SegmentLogEntry): void;
    last(): SegmentLogEntry | undefined;
}
export type RetentionPolicy = {
    type: 'none';
} | {
    type: 'count';
    maxMessages: number;
} | {
    type: 'time';
    maxAgeSec: number;
} | {
    type: 'size';
    maxSegments: number;
};
export declare function expiredSegments(log: SegmentLog, policy: RetentionPolicy, clock: Clock): SegmentLogEntry[];
/**
 * Kind-5 deletion addressed to the scribe's OWN known segments (rule 3) —
 * e-tags (exact ids) AND a-tags (whole address: catches stale copies of
 * replaced segments on other relays).
 */
export declare function buildRetentionDeletion(scribeSecretKey: Uint8Array, scope: string, expired: SegmentLogEntry[], clock?: Clock): NostrEvent | null;
export interface ScribeOptions {
    secretKey: Uint8Array;
    roomId: string;
    routingId: string;
    /** Scroll-wrapper key (deriveScrollWrapperKey(contentKey)) — encrypts the
     *  padded segment CONTAINER only. The scribe never holds the content key
     *  and cannot read a single message. */
    segKey: Uint8Array;
    epoch: number;
    flushDeadlineMs: number;
    retention: RetentionPolicy;
    /** Per-author-key budget (§5.1). */
    rateCapacity?: number;
    rateRefillPerSec?: number;
    /** Tiered standing (§7): per-tier budgets + a provisioned roster hook
     *  mapping author pubkey → tier name (scribe-visible pseudonym roster,
     *  §9). When both are set, tiers WIN over the flat rateCapacity. */
    tiers?: TierBudgetTable;
    tierOf?: (authorPub: string) => string;
    clock?: Clock;
    nowMs?: () => number;
}
export interface RollResult {
    segment: NostrEvent;
    deletion: NostrEvent | null;
    /** Entries the deletion covers — removed from the log ONLY via
     *  commitPurge() after the deletion is actually published. */
    expired: SegmentLogEntry[];
    flush: FlushReason;
}
export declare class Scribe {
    readonly pubkey: string;
    readonly log: SegmentLog;
    private pending;
    private pendingBytes;
    /** Event-id replay/dedup set — the ONLY dedup a blind scribe can do;
     *  (author, msg_id) dedup happens client-side at merge (§3.3). */
    private readonly seenEventIds;
    /** Monotonic segment counter — NEVER derived from the live log length
     *  (retention shrinks the log; reuse collides on the addressable d-tag). */
    private nextSeg;
    private droppedOversize;
    private lastRoll;
    /** Event id of the last rolled segment — prev-chain continuity must not
     *  depend on the purgeable log. */
    private lastSegmentId;
    /** Flat limiter (default) OR tiered limiter (when tiers are set). */
    private readonly limiter;
    private readonly opts;
    private readonly clock;
    private readonly nowMs;
    private segmentOpenedAtMs;
    private lastCreatedAt;
    constructor(opts: ScribeOptions);
    /**
     * Blind ingest: verify the OUTER event only — kind, signature, routing
     * tag, size. The content is ciphertext the scribe cannot read. Returns
     * the accepted event, or null when rejected.
     */
    ingest(event: NostrEvent): NostrEvent | null;
    /**
     * Greedily pack the largest prefix of pending events that fits one
     * segment. Overflow stays pending for the next roll; oversize singles are
     * dropped (counted) rather than wedging the scribe.
     */
    private packPending;
    /** True when a roll should happen (size ≥ segment budget, or time). */
    shouldRoll(): boolean;
    /** Why a roll should happen right now, or null. Daemons use this as the
     *  segment's flush tag — the recorded reason must be true. */
    rollReason(): FlushReason | null;
    /**
     * Roll the pending buffer into a segment + retention deletion (if any).
     * The retention purge is COMPUTED here but APPLIED only by commitPurge()
     * after the daemon has actually published the deletion — a failed
     * deletion publish must never lose the addresses (post-audit H1).
     */
    roll(flush: FlushReason): RollResult;
    private segmentCtx;
    pendingCount(): number;
    /**
     * Undo the most recent roll after a SEGMENT publish failure: events return
     * to the front of pending, the log entry and counters revert. Only valid
     * while no newer roll exists (daemons serialize rolls).
     */
    rollbackLastRoll(): boolean;
    /** Apply a retention purge to the log AFTER its kind-5 was published. */
    commitPurge(expiredEventIds: string[]): void;
    oversizeDropped(): number;
    snapshot(): ScribeSnapshot;
    restoreSnapshot(s: ScribeSnapshot): void;
}
export interface ScribeSnapshot {
    nextSeg: number;
    log: SegmentLogEntry[];
    seenEventIds: string[];
    lastCreatedAt?: number;
    lastSegmentId?: string | null;
}
export { findTag };
