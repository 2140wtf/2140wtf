import { type NostrEvent, type Clock, type Rng, findTag } from './crypto.js';
export interface PowChallenge {
    salt: string;
    difficulty: number;
    expiry: number;
}
export declare function countLeadingZeroBits(hash: Uint8Array): number;
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
export declare function solvePow(challenge: PowChallenge, burnerPub: string, opts?: {
    maxNonce?: bigint;
    yieldEvery?: number;
}): Promise<string>;
/** Synchronous test-only PoW solver. Exists so test code that calls
 *  `solvePow(...)` in a non-async body keeps working. Identical math to
 *  `solvePow`; never yields, never throws on cap. Use ONLY in tests; in
 *  production always await the async solver. */
export declare function solvePowSync(challenge: PowChallenge, burnerPub: string): string;
export declare function verifyPow(challenge: PowChallenge, burnerPub: string, nonceStr: string): boolean;
/**
 * Constant-time comparison of two hex strings (JOIN-05): both sides are
 * SHA-256-digested to FIXED-LENGTH 32-byte buffers FIRST (no length
 * short-circuit leak), then compared with a data-independent XOR-accumulate
 * loop — the browser-safe equivalent of crypto.timingSafeEqual over the
 * digests. welcomer-core rides inside the browser bundle via join.ts, so
 * node:crypto must not appear here.
 */
export declare function constantTimeEqualHex(a: string, b: string): boolean;
export interface SignedChallenge extends PowChallenge {
    burner: string;
    roomId: string;
    keyEpoch: number;
    /** HMAC over all bound fields. */
    sig: string;
}
export declare function issueChallenge(welcomerEpochKey: Uint8Array, burner: string, roomId: string, keyEpoch: number, difficulty: number, ttlSec: number, clock?: Clock, rng?: Rng): SignedChallenge;
export declare function verifyChallengeSignature(welcomerEpochKey: Uint8Array, c: SignedChallenge): boolean;
export declare class ReplayCache {
    private readonly clock;
    /** ReplayCache (welcomer-core.ts) tracks arbitrary replay keys (pow challenges,
     * invite-uses, etc.). NullifierCache (credential.ts) is the same algorithm
     * but adds hex-validation of the nullifier (NOSTR-32 bytes hex constraint).
     * Keep separate: different validation domains. If consolidated, NullifierCache
     * validation must not apply to ReplayCache keys (e.g. "pow:salt:burner" is
     * not hex).
     */
    private readonly seen;
    constructor(clock?: Clock, limit?: number);
    /** Returns true if the key was NEW (not replayed). */
    checkAndInsert(key: string, ttlWithGraceSec: number): boolean;
    private sweep;
    get size(): number;
}
/**
 * A Set-with-TTL for per-room dedup (seen join event ids JOIN-01,
 * ratcheted burners JOIN-07). Instead of the old `Set` whose 4096-cap was
 * enforced with a `clear()` that dropped ALL dedup state at once, entries
 * are TTL-evicted per key; when over the size cap, expired keys are dropped
 * first, then the oldest survivors — never the whole set.
 */
export declare class TtlKeySet {
    private readonly ttlMs;
    private readonly limit;
    private readonly nowMs;
    private readonly entries;
    constructor(ttlMs: number, limit?: number, nowMs?: () => number);
    has(key: string): boolean;
    /** Synchronous dedup insert: true iff the key was NEW (not seen, not expired). */
    checkAndAdd(key: string): boolean;
    add(key: string): void;
    delete(key: string): boolean;
    get size(): number;
    private sweep;
}
/**
 * Invite-use ledger (JOIN-01): the welcomer's per-lid use counter with
 * SYNCHRONOUS reservation. The daemon must reserve a use immediately after
 * the invite gate passes — BEFORE the first await — and release it only if
 * a later gate rejects. Concurrently replayed copies of one captured join
 * event cannot both read the pre-increment count: the first handler's
 * synchronous `reserve` is visible to everyone after it.
 */
export declare class InviteUseLedger {
    private readonly uses;
    /** Current consumed count — read-only input for the invite gate. */
    count(lid: string): number;
    /** SYNCHRONOUS use reservation. Returns false when the lid is already
     *  exhausted (`uses >= maxUses`) — callers must treat that as rejection. */
    reserve(lid: string, maxUses: number): boolean;
    /** Release a reservation after a later gate rejects (never below zero). */
    release(lid: string): void;
}
/**
 * JOIN-02 — server-side history binding: `req.history === 'fresh'` is
 * honored ONLY when the matched invite config (per-lid) OR the room config
 * provisions it. Without provisioning, a 'fresh' request degrades to the
 * current epoch (no ratchet) — a joiner can never force a room-wide epoch
 * ratchet on its own.
 */
export declare function freshJoinProvisioned(roomHistory: string | undefined, inviteHistory: string | undefined): boolean;
/** JOIN-02 — per-room ratchet rate limit (min interval between ratchets). */
export declare function ratchetAllowed(lastRatchetAtMs: number, nowMs: number, minIntervalMs: number): boolean;
/** JOIN-07 — durable ratchet-marker d-tag (kind 30078). The daemon
 *  publishes this marker to the relay BEFORE the jittered wrap (and BEFORE
 *  the ratchet), so a daemon restart inside the wrap-publish jitter window
 *  still sees the marker and never ratchets the same join twice. Distinct
 *  address space from key wraps (wrapDTag) and challenges (challengeDTag). */
export declare function ratchetMarkerDTag(welcomerEpochKey: Uint8Array, roomId: string, recipientPub: string): string;
export type AdmissionPolicy = {
    preset: 'open';
} | {
    preset: 'cap-pow';
    difficulty: number;
};
export declare function evaluatePolicy(policy: AdmissionPolicy, powOk: boolean): boolean;
export declare const WRAP_TTL_SEC = 3600;
/**
 * d = HMAC(welcomer_epoch_key, roomId ‖ burner). The roomId is INSIDE the
 * HMAC — the tag stays opaque (no room-id substring on the wire) while
 * preventing cross-room wrap collisions when one welcomer epoch key serves
 * multiple rooms (post-review bug: same burner + two rooms → second wrap
 * silently destroyed the first).
 */
export declare function wrapDTag(welcomerEpochKey: Uint8Array, roomId: string, recipientPub: string): string;
export interface WrapPayload {
    roomId: string;
    encKey: string;
    epoch: number;
    routingId: string;
    scribes: string[];
    /** Room governance pubkey (hex) — clients pin it and reject redaction
     *  lists from any other author (fail-closed, spec §3). */
    governance: string;
    /** Shield transport pubkey (config B) — when present, clients gift-wrap
     *  message uploads to this pubkey instead of publishing openly. */
    shield?: string;
    /** P2 (spec §8 join-forward): hex of the CURRENT epoch chain key. The
     *  welcomer wraps only the current epoch — a joiner derives enc/label
     *  keys for epoch ≥ wrap.epoch and can never ratchet backwards (preimage
     *  resistance). `encKey` is kept for P1 backward compat; P2 clients
     *  prefer chainKey when both are present. */
    chainKey?: string;
}
export declare function publishWrap(welcomerSecretKey: Uint8Array, welcomerEpochKey: Uint8Array, recipientPub: string, payload: WrapPayload, clock?: Clock, rng?: Rng): NostrEvent;
/** Challenge wraps live at a DIFFERENT deterministic address than key wraps
 *  (same burner, same room, different purpose) — HMAC(epoch, "challenge" ‖ …). */
export declare function challengeDTag(welcomerEpochKey: Uint8Array, roomId: string, recipientPub: string): string;
/** Publish a PoW challenge to a joiner's burner (kind 30078, short TTL). */
export declare function publishChallenge(welcomerSecretKey: Uint8Array, welcomerEpochKey: Uint8Array, recipientPub: string, roomId: string, difficulty: number, ttlSec: number, keyEpoch: number, clock?: Clock, rng?: Rng): {
    event: NostrEvent;
    challenge: SignedChallenge;
};
export declare function welcomerPubkey(welcomerSecretKey: Uint8Array): string;
/** Payload type marking a fresh-seed wrap after a member exclusion. */
export interface RekeyPayload extends WrapPayload {
    type: 'rekey';
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
export declare function buildRekeyWraps(welcomerSecretKey: Uint8Array, welcomerEpochKey: Uint8Array, burnerRecipients: string[], payload: Omit<RekeyPayload, 'type'>, clock?: Clock, rng?: Rng): NostrEvent[];
/** Tolerant parse of a decrypted wrap payload: is this a re-key? */
export declare function isRekeyPayload(payload: unknown): payload is RekeyPayload;
export interface JoinGateConfig {
    epochKey: Uint8Array;
    policy: AdmissionPolicy;
    roomId: string;
    challengeTtlSec: number;
    replayCache: ReplayCache;
    clock?: Clock;
}
/**
 * Verify a cap-pow join submission. Every binding is checked: the challenge
 * must be signed by this welcomer, bound to THIS burner and THIS room, carry
 * AT LEAST the policy difficulty, be unexpired, have a valid PoW solution,
 * and not be replayed. (Post-review bugs: cross-burner, cross-room, and
 * zero-difficulty challenges were all admitted.)
 */
export declare function verifyJoinAdmission(cfg: JoinGateConfig, challenge: SignedChallenge | null | undefined, burnerPub: string, powNonce: string): boolean;
/** Exposed for join-request validation in scribe/welcomer daemons. */
export declare function extractJoinRequestFields(event: NostrEvent): {
    burner: string;
};
export { findTag };
