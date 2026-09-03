/**
 * Welcomer core — spec §5.2. Base protocol (P1 only).
 *
 * Stateless-ish admission: HMAC-signed PoW challenges, bounded replay cache
 * (challenge TTL + 2× grace), deterministic opaque wrap d-tags (d =
 * HMAC(welcomer_epoch_key, burner)) — stateless burner-reuse rejection via
 * addressable replacement.
 *
 * P1 policies: 'open' and 'cap-pow' only.
 *
 * This module has NO imports from admission.ts or nipOa.ts — it is a self-
 * contained unit of the base protocol. The P3 admission menu lives in
 * welcomer-gate.ts.
 */
import { KEY_WRAP } from './kinds.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';
import { systemClock, defaultRng, bytesToHex, hexToBytes, hmacSha256, padJsonToBucket, encryptDm, monotonicTimestamp, signEvent, getPublicKey, findTag, } from './crypto.js';
export function countLeadingZeroBits(hash) {
    let bits = 0;
    for (const byte of hash) {
        if (byte === 0) {
            bits += 8;
        }
        else {
            bits += 8 - (32 - Math.clz32(byte));
            break;
        }
    }
    return bits;
}
/** PoW nonce domain: a 64-bit unsigned counter (matches the 8-byte
 *  big-endian encoding). The wire accepts up to 20 decimal digits, but
 *  values above 2^64−1 cannot be encoded — setBigUint64 would throw. */
const POW_MAX_NONCE = (1n << 64n) - 1n;
/** Default work cap for the solver: 2^32 nonces ≈ 2^4 × the expected cost
 *  of the clamped client maximum (difficulty 28), a generous ceiling that
 *  still bounds a hostile-welcomer hang (JOIN-06). */
const SOLVE_MAX_NONCE = 1n << 32n;
/** Cooperative yield to the event loop (browser + node safe). */
const yieldToEventLoop = () => new Promise((r) => setTimeout(r, 0));
/**
 * Solve a PoW challenge. ASYNC (JOIN-06): the solver yields to the event
 * loop every ~2^16 nonces so a high-difficulty challenge never freezes the
 * caller's event loop (a hostile welcomer can issue difficulty up to the
 * client clamp 28 ≈ 2^28 SHA-256 calls). Total work is capped at
 * `maxNonce` (default 2^32) — beyond it the solver throws instead of
 * running forever.
 *
 * IMPORTANT: this is async. Callers MUST `await` the result. Passing the
 * unawaited promise to a hex-string API (e.g. verifyPow) stringifies the
 * Promise and silently fails every check. See welcomer-scribe.test.ts and
 * integration.test.ts for the canonical pattern.
 */
export async function solvePow(challenge, burnerPub, opts = {}) {
    const salt = hexToBytes(challenge.salt);
    const binder = utf8ToBytes(burnerPub);
    const saltBinder = concatBytes(salt, binder);
    const maxNonce = opts.maxNonce ?? SOLVE_MAX_NONCE;
    const yieldEvery = opts.yieldEvery ?? 2 ** 16;
    for (let nonce = 0n;; nonce++) {
        if (nonce > maxNonce)
            throw new Error(`pow not found within work cap (maxNonce ${maxNonce})`);
        const nonceBytes = new Uint8Array(8);
        new DataView(nonceBytes.buffer).setBigUint64(0, nonce, false);
        const hash = sha256(concatBytes(saltBinder, nonceBytes));
        if (countLeadingZeroBits(hash) >= challenge.difficulty)
            return String(nonce);
        if (nonce > 0n && Number(nonce) % yieldEvery === 0)
            await yieldToEventLoop();
    }
}
/** Synchronous test-only PoW solver. Exists so test code that calls
 *  `solvePow(...)` in a non-async body keeps working. Identical math to
 *  `solvePow`; never yields, never throws on cap. Use ONLY in tests; in
 *  production always await the async solver. */
export function solvePowSync(challenge, burnerPub) {
    const saltBinder = concatBytes(hexToBytes(challenge.salt), utf8ToBytes(burnerPub));
    for (let nonce = 0n;; nonce++) {
        const nonceBytes = new Uint8Array(8);
        new DataView(nonceBytes.buffer).setBigUint64(0, nonce, false);
        const hash = sha256(concatBytes(saltBinder, nonceBytes));
        if (countLeadingZeroBits(hash) >= challenge.difficulty)
            return String(nonce);
    }
}
export function verifyPow(challenge, burnerPub, nonceStr) {
    if (!/^\d{1,20}$/.test(nonceStr))
        return false;
    const nonce = BigInt(nonceStr);
    // JOIN-06: reject nonces above 2^64−1 BEFORE setBigUint64, which would
    // throw RangeError out of the admission gate (a silent join hang).
    if (nonce > POW_MAX_NONCE)
        return false;
    const nonceBytes = new Uint8Array(8);
    new DataView(nonceBytes.buffer).setBigUint64(0, nonce, false);
    const hash = sha256(concatBytes(hexToBytes(challenge.salt), utf8ToBytes(burnerPub), nonceBytes));
    return countLeadingZeroBits(hash) >= challenge.difficulty;
}
/**
 * Constant-time comparison of two hex strings (JOIN-05): both sides are
 * SHA-256-digested to FIXED-LENGTH 32-byte buffers FIRST (no length
 * short-circuit leak), then compared with a data-independent XOR-accumulate
 * loop — the browser-safe equivalent of crypto.timingSafeEqual over the
 * digests. welcomer-core rides inside the browser bundle via join.ts, so
 * node:crypto must not appear here.
 */
export function constantTimeEqualHex(a, b) {
    const ha = sha256(utf8ToBytes(a));
    const hb = sha256(utf8ToBytes(b));
    let acc = 0;
    for (let i = 0; i < ha.length; i++)
        acc |= ha[i] ^ hb[i];
    return acc === 0;
}
function challengeMessage(c) {
    return utf8ToBytes(['bao-join-challenge', c.burner, c.roomId, String(c.keyEpoch), String(c.expiry), String(c.difficulty), c.salt].join(':'));
}
export function issueChallenge(welcomerEpochKey, burner, roomId, keyEpoch, difficulty, ttlSec, clock = systemClock, rng = defaultRng) {
    if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 256) {
        throw new Error('difficulty out of range [0, 256]');
    }
    const base = {
        burner,
        roomId,
        keyEpoch,
        difficulty,
        expiry: clock.nowSec() + ttlSec,
        salt: bytesToHex(rng(16)),
    };
    return { ...base, sig: bytesToHex(hmacSha256(welcomerEpochKey, challengeMessage(base))) };
}
export function verifyChallengeSignature(welcomerEpochKey, c) {
    const { sig: _sig, ...base } = c;
    // JOIN-05: constant-time comparison (no prefix-timing leak on the HMAC tag).
    return constantTimeEqualHex(bytesToHex(hmacSha256(welcomerEpochKey, challengeMessage(base))), c.sig);
}
// ─── Bounded replay cache (§5.2) ───────────────────────────────────────────
export class ReplayCache {
    constructor(clock = systemClock) {
        this.clock = clock;
        /** ReplayCache (welcomer-core.ts) tracks arbitrary replay keys (pow challenges,
         * invite-uses, etc.). NullifierCache (credential.ts) is the same algorithm
         * but adds hex-validation of the nullifier (NOSTR-32 bytes hex constraint).
         * Keep separate: different validation domains. If consolidated, NullifierCache
         * validation must not apply to ReplayCache keys (e.g. "pow:salt:burner" is
         * not hex).
         */
        this.seen = new Map(); // key → expiry
    }
    /** Returns true if the key was NEW (not replayed). */
    checkAndInsert(key, ttlWithGraceSec) {
        this.sweep();
        if (this.seen.has(key))
            return false;
        this.seen.set(key, this.clock.nowSec() + ttlWithGraceSec);
        return true;
    }
    sweep() {
        const now = this.clock.nowSec();
        for (const [k, exp] of this.seen)
            if (exp <= now)
                this.seen.delete(k);
    }
    get size() {
        this.sweep();
        return this.seen.size;
    }
}
// ─── JOIN-01/07: per-room TTL key sets + invite-use reservation ────────────
// These are the daemon-side dedup/reservation primitives. Both are built on
// SYNCHRONOUS check-then-insert (no await between the two), so concurrent
// replays of one captured join event can never double-insert: the second
// handler observes the first handler's insert before it can act.
/**
 * A Set-with-TTL for per-room dedup (seen join event ids JOIN-01,
 * ratcheted burners JOIN-07). Instead of the old `Set` whose 4096-cap was
 * enforced with a `clear()` that dropped ALL dedup state at once, entries
 * are TTL-evicted per key; when over the size cap, expired keys are dropped
 * first, then the oldest survivors — never the whole set.
 */
export class TtlKeySet {
    constructor(ttlMs, limit = 4096, nowMs = () => Date.now()) {
        this.ttlMs = ttlMs;
        this.limit = limit;
        this.nowMs = nowMs;
        this.entries = new Map(); // key → expiryMs
    }
    has(key) {
        const exp = this.entries.get(key);
        if (exp === undefined)
            return false;
        if (exp <= this.nowMs()) {
            this.entries.delete(key);
            return false;
        }
        return true;
    }
    /** Synchronous dedup insert: true iff the key was NEW (not seen, not expired). */
    checkAndAdd(key) {
        if (this.has(key))
            return false;
        this.entries.set(key, this.nowMs() + this.ttlMs);
        this.sweep();
        return true;
    }
    add(key) {
        this.entries.set(key, this.nowMs() + this.ttlMs);
        this.sweep();
    }
    delete(key) {
        return this.entries.delete(key);
    }
    get size() {
        this.sweep();
        return this.entries.size;
    }
    sweep() {
        if (this.entries.size < this.limit)
            return;
        const now = this.nowMs();
        for (const [k, exp] of this.entries)
            if (exp <= now)
                this.entries.delete(k);
        if (this.entries.size >= this.limit) {
            // Still over budget after TTL eviction? Drop the OLDEST survivors —
            // per-key eviction, never a bulk wipe.
            const oldest = [...this.entries.entries()].sort((a, b) => a[1] - b[1]);
            for (let i = 0; i < oldest.length && this.entries.size >= this.limit; i++) {
                this.entries.delete(oldest[i][0]);
            }
        }
    }
}
/**
 * Invite-use ledger (JOIN-01): the welcomer's per-lid use counter with
 * SYNCHRONOUS reservation. The daemon must reserve a use immediately after
 * the invite gate passes — BEFORE the first await — and release it only if
 * a later gate rejects. Concurrently replayed copies of one captured join
 * event cannot both read the pre-increment count: the first handler's
 * synchronous `reserve` is visible to everyone after it.
 */
export class InviteUseLedger {
    constructor() {
        this.uses = new Map();
    }
    /** Current consumed count — read-only input for the invite gate. */
    count(lid) {
        return this.uses.get(lid) ?? 0;
    }
    /** SYNCHRONOUS use reservation. Returns false when the lid is already
     *  exhausted (`uses >= maxUses`) — callers must treat that as rejection. */
    reserve(lid, maxUses) {
        const n = this.uses.get(lid) ?? 0;
        if (n >= maxUses)
            return false;
        this.uses.set(lid, n + 1);
        return true;
    }
    /** Release a reservation after a later gate rejects (never below zero). */
    release(lid) {
        const n = this.uses.get(lid) ?? 0;
        if (n > 0)
            this.uses.set(lid, n - 1);
    }
}
/**
 * JOIN-02 — server-side history binding: `req.history === 'fresh'` is
 * honored ONLY when the matched invite config (per-lid) OR the room config
 * provisions it. Without provisioning, a 'fresh' request degrades to the
 * current epoch (no ratchet) — a joiner can never force a room-wide epoch
 * ratchet on its own.
 */
export function freshJoinProvisioned(roomHistory, inviteHistory) {
    return roomHistory === 'fresh' || inviteHistory === 'fresh';
}
/** JOIN-02 — per-room ratchet rate limit (min interval between ratchets). */
export function ratchetAllowed(lastRatchetAtMs, nowMs, minIntervalMs) {
    return nowMs - lastRatchetAtMs >= minIntervalMs;
}
/** JOIN-07 — durable ratchet-marker d-tag (kind 30078). The daemon
 *  publishes this marker to the relay BEFORE the jittered wrap (and BEFORE
 *  the ratchet), so a daemon restart inside the wrap-publish jitter window
 *  still sees the marker and never ratchets the same join twice. Distinct
 *  address space from key wraps (wrapDTag) and challenges (challengeDTag). */
export function ratchetMarkerDTag(welcomerEpochKey, roomId, recipientPub) {
    return bytesToHex(hmacSha256(welcomerEpochKey, concatBytes(utf8ToBytes('ratcheted'), concatBytes(utf8ToBytes(roomId), hexToBytes(recipientPub)))));
}
export function evaluatePolicy(policy, powOk) {
    switch (policy.preset) {
        case 'open':
            return true;
        case 'cap-pow':
            return powOk;
    }
}
// ─── Wrap publishing (§5.2, §11) ───────────────────────────────────────────
export const WRAP_TTL_SEC = 3600; // wraps expire; orphan wraps must not accumulate (§11)
/**
 * d = HMAC(welcomer_epoch_key, roomId ‖ burner). The roomId is INSIDE the
 * HMAC — the tag stays opaque (no room-id substring on the wire) while
 * preventing cross-room wrap collisions when one welcomer epoch key serves
 * multiple rooms (post-review bug: same burner + two rooms → second wrap
 * silently destroyed the first).
 */
export function wrapDTag(welcomerEpochKey, roomId, recipientPub) {
    return bytesToHex(hmacSha256(welcomerEpochKey, concatBytes(utf8ToBytes(roomId), hexToBytes(recipientPub))));
}
export function publishWrap(welcomerSecretKey, welcomerEpochKey, recipientPub, payload, clock = systemClock, rng = defaultRng) {
    return signEvent({
        kind: KEY_WRAP,
        created_at: monotonicTimestamp(undefined, clock),
        tags: [
            ['d', wrapDTag(welcomerEpochKey, payload.roomId, recipientPub)],
            ['p', recipientPub],
            ['expiration', String(clock.nowSec() + WRAP_TTL_SEC)],
            ['-'],
        ],
        content: encryptDm(padJsonToBucket(JSON.stringify(payload)), welcomerSecretKey, recipientPub, rng),
    }, welcomerSecretKey);
}
/** Challenge wraps live at a DIFFERENT deterministic address than key wraps
 *  (same burner, same room, different purpose) — HMAC(epoch, "challenge" ‖ …). */
export function challengeDTag(welcomerEpochKey, roomId, recipientPub) {
    return bytesToHex(hmacSha256(welcomerEpochKey, concatBytes(utf8ToBytes('challenge'), concatBytes(utf8ToBytes(roomId), hexToBytes(recipientPub)))));
}
/** Publish a PoW challenge to a joiner's burner (kind 30078, short TTL). */
export function publishChallenge(welcomerSecretKey, welcomerEpochKey, recipientPub, roomId, difficulty, ttlSec, keyEpoch, clock = systemClock, rng = defaultRng) {
    const challenge = issueChallenge(welcomerEpochKey, recipientPub, roomId, keyEpoch, difficulty, ttlSec, clock, rng);
    const event = signEvent({
        kind: KEY_WRAP,
        created_at: monotonicTimestamp(undefined, clock),
        tags: [
            ['d', challengeDTag(welcomerEpochKey, roomId, recipientPub)],
            ['p', recipientPub],
            ['expiration', String(clock.nowSec() + ttlSec + 600)],
            ['-'],
        ],
        content: encryptDm(padJsonToBucket(JSON.stringify({ challenge })), welcomerSecretKey, recipientPub, rng),
    }, welcomerSecretKey);
    return { event, challenge };
}
export function welcomerPubkey(welcomerSecretKey) {
    return getPublicKey(welcomerSecretKey);
}
/**
 * Re-key on exclusion (spec §8): exclusion requires a re-key, not a
 * ratchet step (remaining members can ratchet forward forever). The
 * welcomer/governance wraps a FRESH chain seed to every remaining member —
 * O(N) wraps, one per recipient ONE-TIME BURNER address.
 *
 * RULE 2 / spec §10 (hard requirement): recipients MUST be burner
 * solicits, exactly like the §6 join flow — a member's persona (or any
 * durable) pubkey as a relay-visible wrap `p`-tag across rooms is
 * cross-room membership linkability. Each remaining member solicits with
 * a fresh burner; the re-key wraps to the burners. Never pass persona or
 * stream pubkeys here.
 *
 * The payload carries type:'rekey' plus the new chainKey and epoch so a
 * client can distinguish a re-key wrap from a join wrap and reset its
 * ratchet state. The excluded member receives nothing and its old k_n
 * cannot decrypt post-re-key epochs.
 *
 * Pure helper — one wrap event per recipient; publishing/ordering is the
 * caller's job. Deterministic wrap d-tags (wrapDTag) make re-delivery
 * idempotent via addressable replacement.
 */
export function buildRekeyWraps(welcomerSecretKey, welcomerEpochKey, burnerRecipients, payload, clock = systemClock, rng = defaultRng) {
    const full = { ...payload, type: 'rekey' };
    return burnerRecipients.map((recipientPub) => publishWrap(welcomerSecretKey, welcomerEpochKey, recipientPub, full, clock, rng));
}
/** Tolerant parse of a decrypted wrap payload: is this a re-key? */
export function isRekeyPayload(payload) {
    return typeof payload === 'object' && payload !== null && payload.type === 'rekey';
}
/**
 * Verify a cap-pow join submission. Every binding is checked: the challenge
 * must be signed by this welcomer, bound to THIS burner and THIS room, carry
 * AT LEAST the policy difficulty, be unexpired, have a valid PoW solution,
 * and not be replayed. (Post-review bugs: cross-burner, cross-room, and
 * zero-difficulty challenges were all admitted.)
 */
export function verifyJoinAdmission(cfg, challenge, burnerPub, powNonce) {
    if (cfg.policy.preset === 'open')
        return true;
    const clock = cfg.clock ?? systemClock;
    if (!challenge)
        return false;
    if (!verifyChallengeSignature(cfg.epochKey, challenge))
        return false;
    if (challenge.burner !== burnerPub)
        return false;
    if (challenge.roomId !== cfg.roomId)
        return false;
    if (challenge.difficulty < cfg.policy.difficulty)
        return false;
    if (challenge.expiry <= clock.nowSec())
        return false;
    if (!verifyPow(challenge, burnerPub, powNonce))
        return false;
    return cfg.replayCache.checkAndInsert(`pow:${challenge.salt}:${burnerPub}`, cfg.challengeTtlSec * 3);
}
/** Exposed for join-request validation in scribe/welcomer daemons. */
export function extractJoinRequestFields(event) {
    return { burner: event.pubkey };
}
export { findTag };
