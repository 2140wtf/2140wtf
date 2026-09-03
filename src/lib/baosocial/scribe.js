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
import { systemClock, signEvent, getPublicKey, verifyEvent, findTag, } from './crypto.js';
import { encodeSegmentEvent, manifestFor, } from './segment.js';
import { utf8ToBytes, SEGMENT_CONTENT_SIZE, scrollScope } from './crypto.js';
import { EPHEMERAL_MESSAGE, scrollDTag } from './kinds.js';
/** NIP-44 ciphertext of a max-bucket (16 KB) envelope is ~21.9k chars; an
 *  event whose content exceeds this can never scroll — reject at ingest. */
export const MAX_ENVELOPE_CONTENT_CHARS = 22_000;
/** Cheap NIP-44 v2 structural precheck for the blind scribe. The wire
 *  format is `base64(version_byte(1) || nonce(32) || ciphertext || mac(32))`
 *  = at least 65 bytes raw → 88 base64 chars; the version byte is "2" so
 *  the decoded first byte must be 0x32. The decrypt side will validate
 *  the MAC — this is purely an "is this plausible NIP-44 at all?" check
 *  to drop obvious garbage and pre-MAC-corrupted ciphertext at ingest
 *  before it ever reaches the segment pipeline (SEG-01). */
export function looksLikeNip44V2(s) {
    // NIP-44 v2 ciphertext bounds: minimum payload is 1B + 32B nonce + 32B MAC
    // = 65B raw → 88 base64 chars; max-envelope cap is 22000 chars; allow
    // a wide band but reject cleartext and short strings.
    if (s.length < 88 || s.length > MAX_ENVELOPE_CONTENT_CHARS)
        return false;
    // base64 alphabet (NIP-44 uses standard b64, no URL-safe variant)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s))
        return false;
    // decode first byte → must be 0x32 (ASCII '2')
    try {
        const decoded = Buffer.from(s, 'base64');
        if (decoded.length < 65)
            return false;
        return decoded[0] === 0x02;
    }
    catch {
        return false;
    }
}
/** Cap on in-memory dedup sets; oldest entries evicted (insertion order). */
const SEEN_SET_CAP = 20_000;
// ─── Per-author-key token bucket rate limiter (§5.1) ───────────────────────
const RATE_BUCKET_CAP = 10_000;
const RATE_BUCKET_IDLE_MS = 10 * 60_000;
export class RateLimiter {
    constructor(capacity, refillPerSec, nowMs = () => Date.now()) {
        this.capacity = capacity;
        this.refillPerSec = refillPerSec;
        this.nowMs = nowMs;
        this.buckets = new Map();
    }
    allow(key) {
        const now = this.nowMs();
        let b = this.buckets.get(key);
        if (!b) {
            // Bounded memory under key-spray (post-audit): evict idle buckets,
            // then oldest 10% — evict-then-admit, never a hard new-author shed.
            if (this.buckets.size >= RATE_BUCKET_CAP)
                this.evict(now);
            b = { tokens: this.capacity, lastRefillMs: now };
            this.buckets.set(key, b);
        }
        b.tokens = Math.min(this.capacity, b.tokens + ((now - b.lastRefillMs) / 1000) * this.refillPerSec);
        b.lastRefillMs = now;
        if (b.tokens < 1)
            return false;
        b.tokens -= 1;
        return true;
    }
    evict(now) {
        for (const [k, bucket] of this.buckets) {
            if (now - bucket.lastRefillMs > RATE_BUCKET_IDLE_MS)
                this.buckets.delete(k);
        }
        if (this.buckets.size >= RATE_BUCKET_CAP) {
            let n = Math.floor(RATE_BUCKET_CAP / 10);
            for (const k of this.buckets.keys()) {
                this.buckets.delete(k);
                if (--n <= 0)
                    break;
            }
        }
    }
    get size() {
        return this.buckets.size;
    }
}
/** Default single-tier table: current flat behavior preserved. */
export function defaultTierTable(capacity = 8, refillPerSec = 1) {
    return { default: { capacity, refillPerSec } };
}
/** One RateLimiter per tier; authors are bucketed inside their tier only,
 *  so a slow-lane spammer cannot drain a verified member's budget.
 *  NOTE: moving an author BETWEEN tiers starts them at a full bucket in
 *  the new tier (buckets are keyed per tier) — accepted: the roster is
 *  operator-provisioned, but a flapping tierOf hook would hand out
 *  budget. Provision stable rosters. */
export class TieredRateLimiter {
    constructor(table, tierOf, nowMs = () => Date.now()) {
        this.tierOf = tierOf;
        this.tiers = new Map();
        if (!table.default)
            throw new Error("tier table must include a 'default' tier");
        for (const [name, b] of Object.entries(table)) {
            this.tiers.set(name, new RateLimiter(b.capacity, b.refillPerSec, nowMs));
        }
    }
    /** Charge the author's tier bucket. Unknown tier names fall back to
     *  'default' (a stale roster entry must never shed a member silently). */
    allow(authorPub) {
        const tier = this.tierOf(authorPub);
        const limiter = this.tiers.get(tier) ?? this.tiers.get('default');
        return limiter.allow(authorPub);
    }
    get size() {
        let n = 0;
        for (const l of this.tiers.values())
            n += l.size;
        return n;
    }
}
export class SegmentLog {
    constructor() {
        this.entries = [];
    }
    record(entry) {
        this.entries.push(entry);
    }
    last() {
        return this.entries[this.entries.length - 1];
    }
}
export function expiredSegments(log, policy, clock) {
    switch (policy.type) {
        case 'none':
            return [];
        case 'size': {
            const excess = log.entries.length - policy.maxSegments;
            return excess > 0 ? log.entries.slice(0, excess) : [];
        }
        case 'count': {
            let total = 0;
            for (const e of log.entries)
                total += e.messageCount;
            const expired = [];
            for (const e of log.entries) {
                if (total <= policy.maxMessages)
                    break;
                expired.push(e);
                total -= e.messageCount;
            }
            return expired;
        }
        case 'time': {
            const cutoff = clock.nowSec() - policy.maxAgeSec;
            return log.entries.filter((e) => e.createdAt < cutoff);
        }
    }
}
/**
 * Kind-5 deletion addressed to the scribe's OWN known segments (rule 3) —
 * e-tags (exact ids) AND a-tags (whole address: catches stale copies of
 * replaced segments on other relays).
 */
export function buildRetentionDeletion(scribeSecretKey, scope, expired, clock = systemClock) {
    if (expired.length === 0)
        return null;
    const pubkey = getPublicKey(scribeSecretKey);
    const tags = [];
    for (const e of expired) {
        tags.push(['e', e.eventId]);
        tags.push(['a', `31145:${pubkey}:${scrollDTag(scope, e.seg)}`]);
    }
    return signEvent({
        kind: 5,
        created_at: clock.nowSec(),
        tags,
        content: 'scroll retention purge',
    }, scribeSecretKey);
}
export class Scribe {
    constructor(opts) {
        this.log = new SegmentLog();
        this.pending = [];
        this.pendingBytes = 0;
        /** Event-id replay/dedup set — the ONLY dedup a blind scribe can do;
         *  (author, msg_id) dedup happens client-side at merge (§3.3). */
        this.seenEventIds = new Set();
        /** Monotonic segment counter — NEVER derived from the live log length
         *  (retention shrinks the log; reuse collides on the addressable d-tag). */
        this.nextSeg = 0;
        this.droppedOversize = 0;
        this.lastRoll = null;
        /** Event id of the last rolled segment — prev-chain continuity must not
         *  depend on the purgeable log. */
        this.lastSegmentId = null;
        this.opts = opts;
        this.pubkey = getPublicKey(opts.secretKey);
        this.clock = opts.clock ?? systemClock;
        this.nowMs = opts.nowMs ?? (() => Date.now());
        this.limiter = opts.tiers
            ? new TieredRateLimiter(opts.tiers, opts.tierOf ?? (() => 'default'), this.nowMs)
            : new RateLimiter(opts.rateCapacity ?? 8, opts.rateRefillPerSec ?? 1, this.nowMs);
        this.segmentOpenedAtMs = this.nowMs();
    }
    /**
     * Blind ingest: verify the OUTER event only — kind, signature, routing
     * tag, size. The content is ciphertext the scribe cannot read. Returns
     * the accepted event, or null when rejected.
     */
    ingest(event) {
        if (event.kind !== EPHEMERAL_MESSAGE)
            return null;
        if (typeof event.content !== 'string' || event.content.length > MAX_ENVELOPE_CONTENT_CHARS)
            return null;
        // SEG-01 defense-in-depth (scribe-side): cheap NIP-44 v2 structural
        // precheck at ingest. The blind scribe cannot decrypt, but it can
        // reject obvious garbage: base64 shape + version byte "2" prefix +
        // a sensible length window. Catches random bytes and unkeyed
        // ciphertext long before they reach the per-message salvage path
        // in decodeSegmentContent. The per-message salvage is still the
        // authoritative defense against wrong-key-but-well-formed content.
        if (!looksLikeNip44V2(event.content))
            return null;
        // 1. Exact replay: reject without charging the author's rate budget.
        if (this.seenEventIds.has(event.id))
            return null;
        // 2. Signature + routing tag BEFORE the rate charge: event.pubkey is
        //    attacker-controlled plaintext — charging first would let a forged
        //    (invalid-signature) event drain ANY victim's bucket at trivial
        //    cost, silently dropping the victim's legitimate posts (post-audit
        //    H: spoofable per-author DoS).
        if (!verifyEvent(event))
            return null;
        if (findTag(event, 'r') !== this.opts.routingId)
            return null;
        // 3. Novel, VALID events are rate-limited per author key. The attacker
        //    only ever spends their own bucket now.
        if (!this.limiter.allow(event.pubkey))
            return null;
        this.seenEventIds.add(event.id);
        trimSet(this.seenEventIds, SEEN_SET_CAP);
        this.pending.push(event);
        this.pendingBytes += JSON.stringify(event).length;
        return event;
    }
    /**
     * Greedily pack the largest prefix of pending events that fits one
     * segment. Overflow stays pending for the next roll; oversize singles are
     * dropped (counted) rather than wedging the scribe.
     */
    packPending() {
        const packed = [];
        const overflow = [];
        for (const ev of this.pending) {
            const trial = [...packed, ev];
            const size = utf8ToBytes(JSON.stringify(manifestFor(trial))).length + 4; // + pad header
            if (size <= SEGMENT_CONTENT_SIZE) {
                packed.push(ev);
            }
            else if (packed.length === 0) {
                this.droppedOversize++; // can never fit — drop, don't wedge
            }
            else {
                overflow.push(ev);
            }
        }
        this.pending = overflow;
        this.pendingBytes = overflow.reduce((n, e) => n + JSON.stringify(e).length, 0);
        return packed;
    }
    /** True when a roll should happen (size ≥ segment budget, or time). */
    shouldRoll() {
        return this.rollReason() !== null;
    }
    /** Why a roll should happen right now, or null. Daemons use this as the
     *  segment's flush tag — the recorded reason must be true. */
    rollReason() {
        if (this.pending.length === 0)
            return null;
        if (this.pendingBytes >= SEGMENT_CONTENT_SIZE)
            return 'size';
        return this.nowMs() - this.segmentOpenedAtMs >= this.opts.flushDeadlineMs ? 'time' : null;
    }
    /**
     * Roll the pending buffer into a segment + retention deletion (if any).
     * The retention purge is COMPUTED here but APPLIED only by commitPurge()
     * after the daemon has actually published the deletion — a failed
     * deletion publish must never lose the addresses (post-audit H1).
     */
    roll(flush) {
        const packed = this.packPending();
        if (packed.length === 0)
            throw new Error('roll() with nothing to scroll');
        const prevId = this.lastSegmentId;
        const prevCreatedAt = this.lastCreatedAt;
        const seg = this.nextSeg;
        const segment = encodeSegmentEvent({
            scribeSecretKey: this.opts.secretKey,
            events: packed,
            seg,
            prevSegmentId: prevId,
            flush,
            ctx: this.segmentCtx(),
            previousCreatedAt: prevCreatedAt,
            clock: this.clock,
        });
        this.nextSeg += 1;
        this.lastCreatedAt = segment.created_at;
        this.lastSegmentId = segment.id;
        const entry = {
            seg,
            eventId: segment.id,
            createdAt: segment.created_at,
            messageCount: packed.length,
        };
        this.log.record(entry);
        if (this.pending.length === 0)
            this.segmentOpenedAtMs = this.nowMs();
        // Rollback state: undo is only valid for the LATEST roll — daemons
        // serialize rolls (single in-flight), so this is always safe there.
        this.lastRoll = { packed, entry, prevSegmentId: prevId, prevCreatedAt };
        const expired = expiredSegments(this.log, this.opts.retention, this.clock);
        const deletion = buildRetentionDeletion(this.opts.secretKey, scrollScope(this.opts.segKey, this.opts.roomId), expired, this.clock);
        return { segment, deletion, expired, flush };
    }
    segmentCtx() {
        return {
            roomId: this.opts.roomId,
            encKey: new Uint8Array(32), // unused for encoding (segKey present)
            segKey: this.opts.segKey,
            routingId: this.opts.routingId,
            expiration: this.opts.retention.type === 'time'
                ? this.clock.nowSec() + this.opts.retention.maxAgeSec
                : undefined,
        };
    }
    pendingCount() {
        return this.pending.length;
    }
    /**
     * Undo the most recent roll after a SEGMENT publish failure: events return
     * to the front of pending, the log entry and counters revert. Only valid
     * while no newer roll exists (daemons serialize rolls).
     */
    rollbackLastRoll() {
        if (!this.lastRoll)
            return false;
        const { packed, entry, prevSegmentId, prevCreatedAt } = this.lastRoll;
        this.log.entries = this.log.entries.filter((e) => e.eventId !== entry.eventId);
        this.nextSeg -= 1;
        this.lastSegmentId = prevSegmentId;
        this.lastCreatedAt = prevCreatedAt;
        this.pending = [...packed, ...this.pending];
        this.pendingBytes = this.pending.reduce((n, e) => n + JSON.stringify(e).length, 0);
        this.lastRoll = null;
        return true;
    }
    /** Apply a retention purge to the log AFTER its kind-5 was published. */
    commitPurge(expiredEventIds) {
        const removed = new Set(expiredEventIds);
        this.log.entries = this.log.entries.filter((e) => !removed.has(e.eventId));
    }
    oversizeDropped() {
        return this.droppedOversize;
    }
    // ─── Persistence ─────────────────────────────────────────────────────────
    snapshot() {
        return {
            nextSeg: this.nextSeg,
            log: [...this.log.entries],
            seenEventIds: [...this.seenEventIds].slice(-SEEN_SET_CAP / 2),
            lastCreatedAt: this.lastCreatedAt,
            lastSegmentId: this.lastSegmentId,
        };
    }
    restoreSnapshot(s) {
        this.nextSeg = Math.max(this.nextSeg, s.nextSeg);
        this.log.entries = [...s.log];
        for (const id of s.seenEventIds)
            this.seenEventIds.add(id);
        if (s.lastCreatedAt !== undefined) {
            this.lastCreatedAt = Math.max(this.lastCreatedAt ?? 0, s.lastCreatedAt);
        }
        if (s.lastSegmentId !== undefined)
            this.lastSegmentId = s.lastSegmentId;
    }
}
function trimSet(set, cap) {
    if (set.size <= cap)
        return;
    let n = Math.floor(cap / 4);
    for (const v of set) {
        set.delete(v);
        if (--n <= 0)
            break;
    }
}
export { findTag };
