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
export function solvePow(challenge, burnerPub) {
    const salt = hexToBytes(challenge.salt);
    const binder = utf8ToBytes(burnerPub);
    for (let nonce = 0;; nonce++) {
        const nonceBytes = new Uint8Array(8);
        new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce), false);
        const hash = sha256(concatBytes(salt, binder, nonceBytes));
        if (countLeadingZeroBits(hash) >= challenge.difficulty)
            return String(nonce);
    }
}
export function verifyPow(challenge, burnerPub, nonceStr) {
    if (!/^\d{1,20}$/.test(nonceStr))
        return false;
    const nonce = BigInt(nonceStr);
    const nonceBytes = new Uint8Array(8);
    new DataView(nonceBytes.buffer).setBigUint64(0, nonce, false);
    const hash = sha256(concatBytes(hexToBytes(challenge.salt), utf8ToBytes(burnerPub), nonceBytes));
    return countLeadingZeroBits(hash) >= challenge.difficulty;
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
    return bytesToHex(hmacSha256(welcomerEpochKey, challengeMessage(base))) === c.sig;
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
