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
    /** Hard cap on live entries. */
    private readonly limit;
    /** ReplayCache (welcomer-core.ts) tracks arbitrary replay keys (pow challenges,
     * invite-uses, etc.). NullifierCache (credential.ts) is the same algorithm
     * but adds hex-validation of the nullifier (NOSTR-32 bytes hex constraint).
     * Keep separate: different validation domains. If consolidated, NullifierCache
     * validation must not apply to ReplayCache keys (e.g. "pow:salt:burner" is
     * not hex).
     *
     * MEMORY BOUND (round-6): a hard entry cap with per-key eviction, matching
     * TtlKeySet. TTL alone is not a bound — unexpired entries are unbounded
     * under a key flood (a hostile joiner can mint a fresh challenge salt per
     * request for the whole TTL window). Under sustained pressure the
     * soonest-expiring (usually oldest) unexpired keys are evicted, so a replay
     * of an EVICTED key can be accepted before its TTL would have swept it.
     * This is the deliberate memory-vs-exhaustiveness trade-off: replay
     * rejection is guaranteed for every entry the cache still holds (all
     * realistic single-welcomer windows), and the cap bounds a flood. Callers
     * that need stronger guarantees must size the cache up or persist
     * nullifiers durably.
     */
    private readonly seen;
    constructor(clock?: Clock, 
    /** Hard cap on live entries. */
    limit?: number);
    /** Returns true if the key was NEW (not replayed). */
    checkAndInsert(key: string, ttlWithGraceSec: number): boolean;
    private sweep;
    /** Over the cap: drop expired keys first, then the soonest-expiring
     *  survivors (TtlKeySet pattern) — per-key eviction, never a bulk wipe. */
    private evictOverCap;
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
 * Typed durable-write failure (JOIN-01, P5). Durable ledger implementations
 * (FileInviteUseLedger) throw this from `commit` when the use cannot be
 * persisted. `WelcomerJoinState.publishJoinWrap` treats it as FAIL CLOSED:
 * nothing is published, the reservation is released, and the outcome is the
 * retryable `'ledger-error'` — admission never proceeds on a use that a
 * restart could reopen. The in-memory default never throws.
 */
export declare class InviteLedgerWriteError extends Error {
    readonly lid: string;
    /** 'write' = the durable store failed; 'capacity' = the bounded ledger is
     *  full and refusing to admit a use it cannot persist. Both are retryable
     *  by the caller once the condition clears. */
    readonly reason: 'write' | 'capacity';
    constructor(lid: string, message: string, 
    /** 'write' = the durable store failed; 'capacity' = the bounded ledger is
     *  full and refusing to admit a use it cannot persist. Both are retryable
     *  by the caller once the condition clears. */
    reason?: 'write' | 'capacity');
}
/**
 * Invite-use ledger contract (JOIN-01, P5). The welcomer's per-lid use
 * counter with SYNCHRONOUS reservation; the daemon may plug a durable
 * implementation (FileInviteUseLedger) so a restart cannot reopen a
 * consumed invite.
 *
 * Lifecycle of one admitted join — COMMIT BEFORE PUBLISH:
 *   reserve(lid, maxUses)  — synchronous check-and-reserve BEFORE the first
 *                            await; false = exhausted, reject.
 *   ...gates + jitter window...
 *   commit(lid)            — the use is finalized and durable implementations
 *                            PERSIST here. THIS MUST HAPPEN BEFORE THE WRAP
 *                            PUBLISH: the wrap is the admission, so a commit
 *                            failure discovered after it would already have
 *                            admitted a use a restart can reopen. A durable
 *                            implementation throws InviteLedgerWriteError when
 *                            it cannot persist — including when its bounded
 *                            capacity is reached and it therefore CANNOT
 *                            persist (reason 'capacity'); the caller publishes
 *                            nothing, releases the reservation, and returns the
 *                            typed, retryable rejection. Capacity is never a
 *                            reason to admit an unpersisted use.
 *   publish()              — the wrap reaches the relay = the join is admitted.
 *   rollbackCommit(lid)    — publish failed: undo the not-yet-admitted commit
 *                            so the client's retry can still admit. If the
 *                            durable rollback write ALSO fails the use stays
 *                            consumed: fail closed (over-rejection, never
 *                            over-admission).
 *   release(lid)           — any other later rejection drops the reservation.
 *
 * `count` = committed + pending, so the gate sees a concurrent reservation
 * immediately. Concurrently replayed copies of one captured join event can
 * never both pass the bound: the first handler's synchronous `reserve` is
 * visible to everyone after it.
 */
export interface InviteLedger {
    /** Current consumed count (committed + reserved) — gate input. */
    count(lid: string): number;
    /** SYNCHRONOUS reservation. False when already exhausted. */
    reserve(lid: string, maxUses: number): boolean;
    /** Drop a reservation that never became an admission (never below zero).
     *  Never touches a committed count. */
    release(lid: string): void;
    /** Finalize a reservation BEFORE the wrap publish. Durable implementations
     *  persist here and MUST throw InviteLedgerWriteError when they cannot —
     *  including at capacity (reason 'capacity') — the caller then admits
     *  nothing (fail closed, retryable). */
    commit(lid: string): void;
    /** Undo a commit whose wrap was NOT published. Durable implementations
     *  decrement the persisted count; when that write fails too they keep the
     *  use consumed (fail closed) and must not throw into the join path. */
    rollbackCommit(lid: string): void;
}
/**
 * In-memory default. Same discipline as before (the accepted daemon
 * default): a restart resets consumption; use FileInviteUseLedger when the
 * room must not reopen used invites across restarts.
 */
export declare class InviteUseLedger implements InviteLedger {
    private readonly committed;
    private readonly pending;
    /** Current consumed count — read-only input for the invite gate. */
    count(lid: string): number;
    /** SYNCHRONOUS use reservation. Returns false when the lid is already
     *  exhausted (`count >= maxUses`) — callers must treat that as rejection. */
    reserve(lid: string, maxUses: number): boolean;
    /** Release a reservation after a later gate rejects (never below zero). */
    release(lid: string): void;
    /** Move one reservation to the committed count (idempotent no-op when the
     *  lid has no pending reservation). Never throws — there is no durable
     *  write to fail. */
    commit(lid: string): void;
    /** Undo a commit whose wrap was never published (publish failure). */
    rollbackCommit(lid: string): void;
}
/**
 * JOIN-02 — server-side history binding: `req.history === 'fresh'` is
 * honored ONLY when the matched invite config (per-lid) OR the room config
 * provisions it. Without provisioning, a 'fresh' request degrades to the
 * current epoch (no ratchet) — a joiner can never force a room-wide epoch
 * ratchet on its own.
 */
export declare function freshJoinProvisioned(roomHistory: string | undefined, inviteHistory: string | undefined): boolean;
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
