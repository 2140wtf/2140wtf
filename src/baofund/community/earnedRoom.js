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
import { systemClock } from './crypto.js';
import { verifyCredential, parseRsaPublicKey, } from './credential.js';
/** Grace added to a credential's remaining validity for the nullifier cache
 *  entry — replay protection must outlive the credential itself (same
 *  discipline as admission.ts, review finding 5). */
export const EARNED_DOOR_NULLIFIER_GRACE_SEC = 24 * 3600;
/**
 * Parse and validate an earned-door clause from a room entry. STRICT on
 * purpose: anything malformed, ambiguous, bearer, or not in this increment's
 * vocabulary THROWS — a foreign policy must never silently admit.
 */
export function parseEarnedDoor(raw) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('earned door must be an object');
    }
    const menu = raw;
    for (const key of Object.keys(menu)) {
        if (key !== 'or')
            throw new Error(`earned door must not carry "${key}"`);
    }
    if (!Array.isArray(menu.or))
        throw new Error('earned door requires an "or" array');
    if (menu.or.length !== 1) {
        throw new Error('earned door must carry exactly one admitting clause — an OR of clauses is ambiguous (and an invite-link clause would leak bearer admission through it)');
    }
    const clause = menu.or[0];
    if (typeof clause !== 'object' || clause === null || Array.isArray(clause)) {
        throw new Error('earned door clause must be an object');
    }
    const c = clause;
    for (const key of Object.keys(c)) {
        if (key !== 'and')
            throw new Error(`earned door clause must not carry "${key}"`);
    }
    if (!Array.isArray(c.and))
        throw new Error('earned door clause requires an "and" array');
    if (c.and.length !== 1) {
        throw new Error('earned door clause must carry exactly one checker — compound clauses are ambiguous');
    }
    const ref = c.and[0];
    if (typeof ref === 'string') {
        if (ref === 'invite-link') {
            throw new Error('invite-link is bearer admission — an earned door requires a non-bearer clause (ADR-earned-rooms non-negotiable)');
        }
        if (ref === 'cap-pow') {
            throw new Error('cap-pow is never the sole gate for a value room (ADR-earned-rooms non-negotiable)');
        }
        if (ref === 'founder-attestation') {
            throw new Error('founder-attestation is not part of the donation-earned first increment');
        }
        throw new Error(`unknown earned-door checker: ${ref}`);
    }
    if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) {
        throw new Error('earned door checker must be a string or an object');
    }
    const r = ref;
    switch (r.checker) {
        case 'trade-credential': {
            for (const key of Object.keys(r)) {
                if (key !== 'checker' && key !== 'issuerPub')
                    throw new Error(`trade-credential door must not carry "${key}"`);
            }
            const issuerPub = r.issuerPub;
            if (typeof issuerPub !== 'object' || issuerPub === null || Array.isArray(issuerPub)) {
                throw new Error("trade-credential requires a per-campaign issuerPub {n,e} — never 'any' (ADR-earned-rooms non-negotiable)");
            }
            const key = issuerPub;
            if (typeof key.n !== 'string' || typeof key.e !== 'string') {
                throw new Error('trade-credential issuerPub requires hex n and e fields');
            }
            try {
                parseRsaPublicKey({ n: key.n, e: key.e }); // 2048-bit minimum, odd modulus, e ∈ {3, 65537}
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`trade-credential issuerPub is invalid: ${detail}`);
            }
            return { checker: 'trade-credential', issuerPub: { n: key.n, e: key.e } };
        }
        case 'zap-bond':
            throw new Error('zap-bond has no nullifier — stay unwired until one exists (ADR-earned-rooms non-negotiable)');
        case 'wot':
        case 'vouch':
            throw new Error(`${String(r.checker)} requires persistent budgets — not wired in the donation-earned first increment`);
        default:
            throw new Error(`unknown earned-door checker: ${JSON.stringify(r.checker)}`);
    }
}
/**
 * Verify a presented fund issuer credential against the door, READ-ONLY (no
 * nullifier burn): signature over the canonical message, pinned per-campaign
 * issuer, room binding, expiry. This is the credential/issuer-signature
 * verifier the ADR requires; evaluation below commits the nullifier only for
 * an admitted join.
 */
export function verifyEarnedCredential(door, presented, ctx) {
    if (!presented)
        return { ok: false, reason: 'no credential presented' };
    const verdict = verifyCredential(presented.credential, presented.signature, {
        now: ctx.now,
        roomId: ctx.roomId,
        expectedIssuerPub: door.issuerPub, // pinned — self-issuance and cross-campaign replay fail
    });
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
}
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
export function evaluateEarnedDoor(door, proofs, ctx, providers, options) {
    if (options.enabled !== true)
        return { status: 'legacy' };
    const now = (ctx.clock ?? systemClock).nowSec();
    const presented = proofs.credential;
    const verdict = verifyEarnedCredential(door, presented, { roomId: ctx.roomId, now });
    if (!verdict.ok)
        return { status: 'rejected', reason: `trade-credential: ${verdict.reason}` };
    // verifyEarnedCredential(ok) implies presented; re-derive for the type.
    if (!presented)
        return { status: 'rejected', reason: 'trade-credential: no credential presented' };
    const cache = providers.nullifierCache;
    if (!cache)
        return { status: 'rejected', reason: 'trade-credential: no nullifier cache provisioned' };
    // READ-ONLY replay check first — the burn commits only on admission.
    if (cache.has(presented.credential.nullifier)) {
        return { status: 'rejected', reason: 'trade-credential: nullifier replay (credential already spent)' };
    }
    const grace = providers.nullifierGraceSec ?? EARNED_DOOR_NULLIFIER_GRACE_SEC;
    const ttl = earnedNullifierTtlSec(presented.credential.expiry, now, grace);
    if (!cache.checkAndInsert(presented.credential.nullifier, ttl)) {
        return { status: 'rejected', reason: 'trade-credential: nullifier spent by a concurrent join' };
    }
    return { status: 'admitted', reason: 'trade-credential: verified, nullifier burned' };
}
/** The nullifier cache TTL for a burned credential: its REMAINING validity
 *  plus the grace window, so replay protection outlives the credential
 *  itself. Exported so the welcomer journals the SAME ttl it burned with —
 *  boot hydration then reconstructs the exact remaining lifetime. */
export function earnedNullifierTtlSec(credentialExpiry, nowSec, graceSec = EARNED_DOOR_NULLIFIER_GRACE_SEC) {
    return Math.max(credentialExpiry - nowSec, 0) + graceSec;
}
// ─── Welcomer boot wiring (the increment that turns the door on) ────────────
//
// The evaluator above is pure. These helpers are the OTHER half the ADR
// requires with any gate: room-entry gating semantics (an explicit opt-in,
// never the mere presence of a clause) and `AdmissionLog` hydration, so a
// daemon restart cannot un-burn a spent nullifier. They stay free of node
// imports — the daemon injects its `AdmissionLog` instance structurally — so
// the browser barrel can keep re-exporting this module.
/**
 * Resolve a room entry's earned-door config. Explicit opt-in only:
 *   - no `earnedDoor` clause → null (nothing to consult; legacy behavior);
 *   - clause present but `earnedDoorEnabled` is not exactly `true` → null
 *     (presence of a clause ALONE must never change behavior);
 *   - enabled without a clause, or with a malformed one → THROW (the caller
 *     fails the room closed at boot; a foreign policy must never silently
 *     admit, and an enabled door that cannot be parsed must never serve).
 */
export function parseEarnedDoorEntry(entry) {
    if (entry?.earnedDoorEnabled !== true)
        return null;
    if (entry.earnedDoor === undefined) {
        throw new Error('earned door enabled but no earnedDoor clause provisioned — refusing to serve (fail-closed)');
    }
    return parseEarnedDoor(entry.earnedDoor);
}
/** Hydration fallback for a nullifier record with no recorded `ttl`
 *  (legacy writer): the fund credential window (7 days) + the burn grace.
 *  Over-retention only ever delays eviction; under-retention would reopen a
 *  replay window, so the fallback stays generous and bounded. */
export const EARNED_DOOR_HYDRATION_FALLBACK_TTL_SEC = 7 * 24 * 3600 + EARNED_DOOR_NULLIFIER_GRACE_SEC;
/**
 * Hydrate a room's nullifier cache from durable burn records (boot step).
 * Each record's remaining lifetime is `ttl - (now - ts)`; records without a
 * `ttl` use `EARNED_DOOR_HYDRATION_FALLBACK_TTL_SEC`. A record whose window
 * has fully elapsed is skipped — the credential is expired by then and the
 * verifier rejects it on expiry anyway. A malformed record id THROWS out of
 * `checkAndInsert`: a burn the log cannot faithfully replay must fail the
 * room closed, never be silently dropped. Returns the hydrated count.
 */
export function hydrateEarnedNullifierCache(cache, records, opts) {
    let hydrated = 0;
    for (const rec of records) {
        if (rec.kind !== 'nullifier')
            continue;
        const total = typeof rec.ttl === 'number' && Number.isFinite(rec.ttl) && rec.ttl > 0
            ? rec.ttl
            : EARNED_DOOR_HYDRATION_FALLBACK_TTL_SEC;
        const elapsed = typeof rec.ts === 'number' ? Math.max(opts.nowSec - rec.ts, 0) : 0;
        const remaining = total - elapsed;
        if (remaining <= 0)
            continue;
        if (cache.checkAndInsert(rec.id, remaining))
            hydrated++;
    }
    return hydrated;
}
