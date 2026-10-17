/**
 * earnedRoom — the earned-room admitting door (ADR-earned-rooms, first
 * increment: the donation-earned campaign room).
 *
 * An earned room is a room whose ENTRY is earned: its admission menu carries
 * a NON-BEARER admitting clause — holding or receiving the link is never
 * sufficient, and the welcomer evaluates the earned condition AFTER the base
 * policy + invite checks. This module is the typed, pure, fail-closed
 * machinery the welcomer CONSULTS for the first-increment door:
 *
 *     { "or": [ { "and": [ { "checker": "trade-credential",
 *                            "issuerPub": { "n": …, "e": … } } ] } ] }
 *
 * with a PER-CAMPAIGN issuer key pinned in the room entry — never `'any'`
 * (one global issuer + a client-chosen roomId would let a contributor of
 * campaign A unblind for B). The credential itself is the existing fund
 * issuer credential (`credential.ts`, RSA blind signature); the client earns
 * it through the existing donor credential flow after contributing.
 *
 * NO behavior change to any existing admission path: this door is only ever
 * authoritative when the caller EXPLICITLY enables it (`enabled: true`).
 * Absent/false, the evaluator reports `legacy` and the caller keeps its
 * current behavior — links-admit stays the default for every room without an
 * earned gate, and an earned room reverses it for its own door only.
 *
 * Deliberately refused here (ADR-earned-rooms non-negotiables):
 *   - `invite-link` inside an earned menu (bearer leak via OR);
 *   - `zap-bond` (shape only; no nullifier — one lock receipt would replay
 *     across joins/rooms; stay unwired until a nullifier exists);
 *   - `cap-pow` (never the sole gate for a value room);
 *   - `wot`/`vouch` (only with persistent budgets — not this increment);
 *   - `founder-attestation` (an earned family, not the donation-earned
 *     first increment's produced clause).
 *
 * Pure by construction: no network, no env, no relay I/O. Providers (the
 * nullifier cache) are injected, exactly like `admission.ts`. The
 * restart-hardening half the ADR requires with any gate — `AdmissionLog`
 * hydration + fsync-before-admit at welcomer boot — is wired by the boot
 * helpers at the bottom of this module (`parseEarnedDoorEntry`,
 * `hydrateEarnedNullifierCache`) and the welcomer daemon, which journals
 * each burn durably BEFORE the wrap that admits the join is published.
 */
import { type Clock } from './crypto.js';
import { NullifierCache, type Credential, type RsaPublicKey } from './credential.js';
import type { AdmissionProofs } from './admission.js';
/** Grace added to a credential's remaining validity for the nullifier cache
 *  entry — replay protection must outlive the credential itself (same
 *  discipline as admission.ts, review finding 5). */
export declare const EARNED_DOOR_NULLIFIER_GRACE_SEC: number;
/** The parsed first-increment door: exactly one non-bearer admitting clause.
 *  Donation-earned = the fund issuer credential with a pinned per-campaign
 *  issuer key. */
export interface EarnedDoor {
    /** The admitting checker (donation-earned = trade-credential). */
    checker: 'trade-credential';
    /** Per-campaign issuer public key pinned in the room entry. */
    issuerPub: RsaPublicKey;
}
/**
 * Parse and validate an earned-door clause from a room entry. STRICT on
 * purpose: anything malformed, ambiguous, bearer, or not in this increment's
 * vocabulary THROWS — a foreign policy must never silently admit.
 */
export declare function parseEarnedDoor(raw: unknown): EarnedDoor;
/** Room-scoped evaluation context (mirrors AdmissionContext's essential
 *  fields for this single-checker door). */
export interface EarnedDoorContext {
    roomId: string;
    clock?: Clock;
}
/** Injected providers — the nullifier cache is REQUIRED for admission. */
export interface EarnedDoorProviders {
    /** Welcomer-side one-credential-one-join cache. Missing → reject
     *  (fail closed), never admit unburned. */
    nullifierCache?: NullifierCache;
    /** Grace added to the credential's remaining validity (default
     *  EARNED_DOOR_NULLIFIER_GRACE_SEC). */
    nullifierGraceSec?: number;
}
/** Explicit enablement: the room entry must opt the door in. */
export interface EarnedDoorOptions {
    /** `true` makes the earned door authoritative; absent/false keeps the
     *  caller's current behavior (the evaluator returns `legacy`). */
    enabled: boolean;
}
export type EarnedDoorEvaluation = {
    status: 'legacy';
} | {
    status: 'admitted';
    reason: string;
} | {
    status: 'rejected';
    reason: string;
};
/**
 * Verify a presented fund issuer credential against the door, READ-ONLY (no
 * nullifier burn): signature over the canonical message, pinned per-campaign
 * issuer, room binding, expiry. This is the credential/issuer-signature
 * verifier the ADR requires; evaluation below commits the nullifier only for
 * an admitted join.
 */
export declare function verifyEarnedCredential(door: EarnedDoor, presented: {
    credential: Credential;
    signature: string;
} | undefined, ctx: {
    roomId: string;
    now: number;
}): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/**
 * Evaluate the earned door for a join. Pure and fail-closed:
 *   - `enabled: false` → `legacy` (caller keeps current behavior; no
 *     credential is looked at and no nullifier is burned);
 *   - absent/malformed/expired/replayed/foreign-issuer credential → rejected;
 *   - only a fully verified credential burns its nullifier (one credential =
 *     one join; the burn TTL outlives the credential by the grace window).
 * A rejected evaluation never consumes anything — a later valid join with
 * the same credential still admits.
 */
export declare function evaluateEarnedDoor(door: EarnedDoor, proofs: Pick<AdmissionProofs, 'credential'>, ctx: EarnedDoorContext, providers: EarnedDoorProviders, options: EarnedDoorOptions): EarnedDoorEvaluation;
/** The nullifier cache TTL for a burned credential: its REMAINING validity
 *  plus the grace window, so replay protection outlives the credential
 *  itself. Exported so the welcomer journals the SAME ttl it burned with —
 *  boot hydration then reconstructs the exact remaining lifetime. */
export declare function earnedNullifierTtlSec(credentialExpiry: number, nowSec: number, graceSec?: number): number;
/**
 * Resolve a room entry's earned-door config. Explicit opt-in only:
 *   - no `earnedDoor` clause → null (nothing to consult; legacy behavior);
 *   - clause present but `earnedDoorEnabled` is not exactly `true` → null
 *     (presence of a clause ALONE must never change behavior);
 *   - enabled without a clause, or with a malformed one → THROW (the caller
 *     fails the room closed at boot; a foreign policy must never silently
 *     admit, and an enabled door that cannot be parsed must never serve).
 */
export declare function parseEarnedDoorEntry(entry: {
    earnedDoor?: unknown;
    earnedDoorEnabled?: unknown;
}): EarnedDoor | null;
/** Hydration fallback for a nullifier record with no recorded `ttl`
 *  (legacy writer): the fund credential window (7 days) + the burn grace.
 *  Over-retention only ever delays eviction; under-retention would reopen a
 *  replay window, so the fallback stays generous and bounded. */
export declare const EARNED_DOOR_HYDRATION_FALLBACK_TTL_SEC: number;
/** The structural slice of `AdmissionRecord` (admissionLog.ts) hydration
 *  consumes — kept local so this module stays node-import-free. */
export interface NullifierBurnRecord {
    kind: string;
    id: string;
    ts?: number;
    ttl?: number;
}
/**
 * Hydrate a room's nullifier cache from durable burn records (boot step).
 * Each record's remaining lifetime is `ttl - (now - ts)`; records without a
 * `ttl` use `EARNED_DOOR_HYDRATION_FALLBACK_TTL_SEC`. A record whose window
 * has fully elapsed is skipped — the credential is expired by then and the
 * verifier rejects it on expiry anyway. A malformed record id THROWS out of
 * `checkAndInsert`: a burn the log cannot faithfully replay must fail the
 * room closed, never be silently dropped. Returns the hydrated count.
 */
export declare function hydrateEarnedNullifierCache(cache: NullifierCache, records: NullifierBurnRecord[], opts: {
    nowSec: number;
}): number;
