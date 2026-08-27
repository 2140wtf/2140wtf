/**
 * admission — the P3 admission menu (spec §7): composable gates,
 * founder-configured, machine-readable.
 *
 * Policy = OR of AND clauses over a checker menu:
 *
 *     admit if:
 *         trade-credential(issuer)                       ← economic
 *       OR ( wot(trust_roots, max_distance) AND … )      ← social
 *       OR zap-bond(amount)                              ← economic
 *       OR cap-pow(difficulty)                           ← computational (P1)
 *       OR vouch(member)                                 ← relational
 *       OR invite-link                                   ← relational (P1)
 *       OR founder-attestation                           ← agent lane
 *
 * Everything here is PURE: checkers are functions over injected providers
 * (FollowGraph, ZapBondVerifier, MembershipProvider) — no network, no env,
 * no relay I/O (rule 8: credential issuers/verifiers are pluggable ORACLES
 * consulted off the correctness path; deployments provision them).
 *
 * Claimed identities (main pubkey, credentials, vouches) ride INSIDE the
 * encrypted join request — the relay never sees them (§6).
 */
import { systemClock, verifyEvent, findTag, } from './crypto.js';
import { verifyCredential, } from './credential.js';
export function checkerName(ref) {
    return typeof ref === 'string' ? ref : ref.checker;
}
// ─── Individual checkers ───────────────────────────────────────────────────
// TWO-PHASE DISCIPLINE (review finding 4): checkers are READ-ONLY during
// menu evaluation — they never burn a nullifier or vouch slot. Side effects
// commit ONLY for the admitting clause, after the menu decision
// (commitClause in evaluateAdmission). A rejected join therefore never
// spends a credential or a voucher's budget.
/** invite-link (shipped, P1/P5): the welcomer's invite-v2 evaluation already
 *  ran upstream — inside the menu the proof is implicit (a join that
 *  survived the invite gate). Presence marker only. The DAEMON enforces
 *  (config-time) that a menu containing this marker has invites
 *  configured — otherwise it fails closed at room start. */
function checkInviteLink() {
    return { admit: true, reason: 'invite-link (evaluated upstream at the invite gate)' };
}
/** cap-pow (shipped, P1): same reasoning — the PoW gate ran upstream, and
 *  the daemon enforces the cap-pow preset at config time when this marker
 *  is present. */
function checkCapPow() {
    return { admit: true, reason: 'cap-pow (evaluated upstream at the PoW gate)' };
}
/** founder-attestation (agent lane): claimed pubkey must be attested. */
function checkFounderAttestation(proofs, providers) {
    if (!proofs.claimedPubkey)
        return { admit: false, reason: 'founder-attestation: no claimed pubkey' };
    if ((providers.founderAttested ?? []).includes(proofs.claimedPubkey)) {
        return { admit: true, reason: 'founder-attestation: attested' };
    }
    return { admit: false, reason: 'founder-attestation: not attested' };
}
/** trade-credential: RSA blind-signed credential, one-join via nullifier. */
function checkTradeCredential(params, proofs, ctx, providers) {
    const presented = proofs.credential;
    if (!presented)
        return { admit: false, reason: 'trade-credential: no credential presented' };
    const verdict = verifyCredential(presented.credential, presented.signature, {
        now: (ctx.clock ?? systemClock).nowSec(),
        roomId: ctx.roomId,
        expectedIssuerPub: params.issuerPub, // pinned — self-issuance fails
    });
    if (!verdict.ok)
        return { admit: false, reason: `trade-credential: ${verdict.reason}` };
    // One credential = one join (welcomer-side nullifier cache, §7).
    // READ-ONLY here (peek) — the insert commits only if this clause wins
    // (two-phase, see commitClause).
    const cache = providers.nullifierCache;
    if (!cache)
        return { admit: false, reason: 'trade-credential: no nullifier cache provisioned' };
    if (cache.has(presented.credential.nullifier)) {
        return { admit: false, reason: 'trade-credential: nullifier replay (credential already spent)' };
    }
    return { admit: true, reason: 'trade-credential: verified' };
}
/** wot: BFS from any trust root to the claimed pubkey, depth-bounded. */
async function checkWot(params, proofs, providers) {
    const target = proofs.claimedPubkey;
    if (!target)
        return { admit: false, reason: 'wot: no claimed pubkey' };
    const graph = providers.followGraph;
    if (!graph)
        return { admit: false, reason: 'wot: no follow graph provisioned' };
    if (!Number.isSafeInteger(params.maxDistance) || params.maxDistance < 0) {
        return { admit: false, reason: 'wot: invalid maxDistance' };
    }
    // BFS, cycle-safe. Depth 0 = the claimant IS a trust root.
    const visited = new Set();
    let frontier = params.trustRoots.filter((r) => /^[0-9a-f]{64}$/.test(r));
    if (frontier.length === 0)
        return { admit: false, reason: 'wot: no valid trust roots' };
    const nb = graph.neighbors;
    for (let depth = 0; depth <= params.maxDistance; depth++) {
        const next = [];
        for (const node of frontier) {
            if (visited.has(node))
                continue;
            visited.add(node);
            if (node === target)
                return { admit: true, reason: `wot: path length ${depth}` };
            // Expand only when deeper levels will actually be VISITED — no
            // wasted provider calls at the boundary (review finding 12).
            // Neighbor enumeration is OPTIONAL on the provider (typed
            // FollowGraphWithNeighbors); pairwise-only graphs answer
            // direct-path checks.
            if (depth < params.maxDistance) {
                if (nb) {
                    const list = await nb.call(graph, node);
                    for (const m of list)
                        if (!visited.has(m))
                            next.push(m);
                }
                else {
                    // Pairwise fallback: ask whether node→target directly (covers
                    // maxDistance ≥ 1 for two-hop checks without enumeration).
                    if (await graph.follows(node, target)) {
                        return { admit: true, reason: `wot: direct path at depth ${depth + 1}` };
                    }
                }
            }
        }
        frontier = next;
        if (frontier.length === 0 && !nb)
            break;
    }
    return { admit: false, reason: 'wot: no path within maxDistance' };
}
/** zap-bond: proof validity is delegated to the injected verifier. */
async function checkZapBond(params, proofs, providers) {
    if (proofs.zapBond === undefined)
        return { admit: false, reason: 'zap-bond: no proof presented' };
    const verifier = providers.zapBondVerifier;
    if (!verifier)
        return { admit: false, reason: 'zap-bond: no verifier provisioned' };
    if (!Number.isSafeInteger(params.amountSats) || params.amountSats <= 0) {
        return { admit: false, reason: 'zap-bond: invalid amount' };
    }
    const ok = await verifier.verify(proofs.zapBond, params.amountSats);
    return ok
        ? { admit: true, reason: `zap-bond: ${params.amountSats} sats locked` }
        : { admit: false, reason: 'zap-bond: proof rejected' };
}
// ─── Vouching (signed event + member budget) ───────────────────────────────
/** Vouch event: purpose 'bao-vouch', p = claimant pubkey, room = roomId,
 *  expiration tag bounds validity. Signed by an existing member. */
export const VOUCH_PURPOSE = 'bao-vouch';
export const VOUCH_KIND = 30078; // addressable app-data (never relay-published by us; rides inside the encrypted join request)
export function buildVouchEvent(memberSign, claimantPub, roomId, clock = systemClock, ttlSec = 24 * 3600) {
    if (!/^[0-9a-f]{64}$/.test(claimantPub))
        throw new Error('invalid claimant pubkey');
    const now = clock.nowSec();
    return memberSign({
        kind: VOUCH_KIND,
        created_at: now,
        tags: [
            ['d', `bao-vouch:${roomId}:${claimantPub}`],
            ['p', claimantPub],
            ['purpose', VOUCH_PURPOSE],
            ['room', roomId],
            ['expiration', String(now + ttlSec)],
        ],
        content: '',
    });
}
export function parseVouchEvent(event, roomId, now) {
    if (event.kind !== VOUCH_KIND)
        return null;
    if (!verifyEvent(event))
        return null;
    if (findTag(event, 'purpose') !== VOUCH_PURPOSE)
        return null;
    if (findTag(event, 'room') !== roomId)
        return null;
    const claimant = findTag(event, 'p');
    if (!claimant || !/^[0-9a-f]{64}$/.test(claimant))
        return null;
    // Expiration is REQUIRED and must be a sane integer — a missing or
    // garbage tag must NOT become a never-expiring vouch (review finding 6).
    const exp = findTag(event, 'expiration');
    if (!exp || !Number.isSafeInteger(Number(exp)) || Number(exp) <= now)
        return null;
    return { voucher: event.pubkey, claimant };
}
/** Bounded per-member vouch counter (welcomer-side, ReplayCache-style).
 *  In-memory by design (same accepted discipline as inviteUses) — a daemon
 *  restart resets counts; ops note, not a protocol property. */
export class VouchBudget {
    constructor(maxPerMember = 3) {
        this.maxPerMember = maxPerMember;
        this.counts = new Map();
    }
    /** True iff the voucher may vouch again (consumes one slot). */
    consume(voucher) {
        const n = this.counts.get(voucher) ?? 0;
        if (n >= this.maxPerMember)
            return false;
        this.counts.set(voucher, n + 1);
        return true;
    }
    /** Read-only check (two-phase evaluation — consume only on admission). */
    peek(voucher) {
        return (this.counts.get(voucher) ?? 0) < this.maxPerMember;
    }
    used(voucher) {
        return this.counts.get(voucher) ?? 0;
    }
}
async function checkVouch(params, proofs, ctx, providers) {
    if (!proofs.vouch)
        return { admit: false, reason: 'vouch: no vouch event presented' };
    const membership = providers.membership;
    if (!membership)
        return { admit: false, reason: 'vouch: no membership provider provisioned' };
    const parsed = parseVouchEvent(proofs.vouch, ctx.roomId, (ctx.clock ?? systemClock).nowSec());
    if (!parsed)
        return { admit: false, reason: 'vouch: invalid/expired/forged vouch' };
    // Claimant binding (review finding 3): a vouch is NOT a bearer token —
    // it admits only the joiner it was issued for. The claimant rides inside
    // the encrypted join request (claimedPubkey), never an outer tag.
    if (!proofs.claimedPubkey)
        return { admit: false, reason: 'vouch: no claimed pubkey to bind' };
    if (parsed.claimant !== proofs.claimedPubkey) {
        return { admit: false, reason: 'vouch: issued for a different claimant' };
    }
    if (parsed.voucher === parsed.claimant)
        return { admit: false, reason: 'vouch: self-vouch' };
    if (!(await membership.isMember(parsed.voucher))) {
        return { admit: false, reason: 'vouch: voucher is not a member' };
    }
    // READ-ONLY budget check — the slot commits only if this clause wins.
    // BUG-SAFETY: providers.vouchBudget MUST be set when the menu has a vouch
    // checker. A missing budget would create separate instances for peek() vs
    // consume(), bypassing the budget entirely (two-phase violation).
    const budget = providers.vouchBudget;
    if (!budget)
        return { admit: false, reason: 'vouch: no budget provisioned' };
    if (!budget.peek(parsed.voucher)) {
        return { admit: false, reason: 'vouch: voucher budget exhausted' };
    }
    return { admit: true, reason: `vouch: member ${parsed.voucher.slice(0, 12)}… vouches` };
}
// ─── Evaluation ────────────────────────────────────────────────────────────
async function evalChecker(ref, proofs, ctx, providers) {
    if (ref === 'invite-link')
        return checkInviteLink();
    if (ref === 'cap-pow')
        return checkCapPow();
    if (ref === 'founder-attestation')
        return checkFounderAttestation(proofs, providers);
    switch (ref.checker) {
        case 'trade-credential':
            return checkTradeCredential(ref, proofs, ctx, providers);
        case 'wot':
            return checkWot(ref, proofs, providers);
        case 'zap-bond':
            return checkZapBond(ref, proofs, providers);
        case 'vouch':
            return checkVouch(ref, proofs, ctx, providers);
        default:
            throw new Error(`unknown admission checker: ${JSON.stringify(ref)}`);
    }
}
/**
 * Evaluate the menu: EVERY clause is evaluated READ-ONLY (no early exit —
 * the reasons array is complete and deterministic; no nullifier/vouch slot
 * is burned). Admission succeeds when at least one clause fully admits.
 * Side effects (nullifier insert, vouch budget consume) then commit ONLY
 * for the first admitting clause (two-phase, review finding 4) — a join
 * rejected overall never spends a credential or a voucher's budget. If a
 * commit loses a race (a concurrent join spent the nullifier between peek
 * and commit), the next admitting clause is tried.
 */
export async function evaluateAdmission(menu, proofs, ctx, providers = {}) {
    const reasons = [];
    const admittedClauses = [];
    for (let i = 0; i < menu.or.length; i++) {
        const clause = menu.or[i];
        let clauseOk = true;
        for (const ref of clause.and) {
            const v = await evalChecker(ref, proofs, ctx, providers);
            reasons.push(`clause[${i}].${checkerName(ref)}: ${v.reason}`);
            if (!v.admit)
                clauseOk = false;
        }
        if (clauseOk && clause.and.length > 0)
            admittedClauses.push(i);
    }
    // Commit phase: burn side effects for the first clause whose commits
    // all succeed. A failed commit (lost race) falls through to the next
    // admitting clause.
    let clause = -1;
    for (const i of admittedClauses) {
        const commit = await commitClause(menu.or[i], proofs, ctx, providers);
        reasons.push(`clause[${i}].commit: ${commit.reason}`);
        if (commit.ok) {
            clause = i;
            break;
        }
    }
    let tier;
    if (clause >= 0 && menu.tiers) {
        // Tier = the mapping of the STRONGEST named checker in the clause
        // (first listed — policy authors order by strength).
        for (const ref of menu.or[clause].and) {
            const t = menu.tiers[checkerName(ref)];
            if (t) {
                tier = t;
                break;
            }
        }
    }
    return { admit: clause >= 0, clause, reasons, ...(tier !== undefined ? { tier } : {}) };
}
/** Commit side effects for ONE admitting clause. Atomic-ish per checker:
 *  a failed commit (replay race) rejects the whole clause so the caller
 *  can fall through to the next admitting clause. */
async function commitClause(clause, proofs, ctx, providers) {
    const now = (ctx.clock ?? systemClock).nowSec();
    for (const ref of clause.and) {
        if (typeof ref === 'object' && ref.checker === 'trade-credential') {
            const cache = providers.nullifierCache;
            if (!cache || !proofs.credential)
                return { ok: false, reason: 'trade-credential commit: no cache/credential' };
            // TTL = remaining credential validity + grace (review finding 5) —
            // replay protection must outlive the credential itself.
            const grace = providers.nullifierGraceSec ?? 24 * 3600;
            const ttl = Math.max(proofs.credential.credential.expiry - now, 0) + grace;
            if (!cache.checkAndInsert(proofs.credential.credential.nullifier, ttl)) {
                return { ok: false, reason: 'trade-credential commit: nullifier spent by a concurrent join' };
            }
        }
        if (typeof ref === 'object' && ref.checker === 'vouch') {
            const parsed = proofs.vouch ? parseVouchEvent(proofs.vouch, ctx.roomId, now) : null;
            if (!parsed)
                return { ok: false, reason: 'vouch commit: vouch no longer valid' };
            const budget = providers.vouchBudget;
            if (!budget)
                return { ok: false, reason: 'vouch commit: no budget provisioned' };
            if (!budget.consume(parsed.voucher)) {
                return { ok: false, reason: 'vouch commit: budget spent by a concurrent join' };
            }
        }
    }
    return { ok: true, reason: 'committed' };
}
// ─── Presets (§7: prevent footguns; the combinator is advanced mode) ───────
export function presetOpen(difficulty = 20) {
    return { or: [{ and: ['cap-pow'] }], tiers: { 'cap-pow': 'slow-lane' } };
}
export function presetCommunity(trustRoots, maxDistance = 2, powDifficulty = 20) {
    return {
        or: [{ and: [{ checker: 'wot', trustRoots, maxDistance }] }, { and: ['cap-pow'] }],
        tiers: { wot: 'member', 'cap-pow': 'slow-lane' },
    };
}
export function presetTraders(issuerPub) {
    return { or: [{ and: [{ checker: 'trade-credential', issuerPub }] }], tiers: { 'trade-credential': 'trader' } };
}
export function presetInviteOnly() {
    return { or: [{ and: ['invite-link'] }], tiers: { 'invite-link': 'member' } };
}
// ─── Rooms-file serialization (tolerant like parseRetention; unknown → throw) ─
/**
 * Parse a rooms-file admission menu spec. JSON form:
 *   { "or": [ { "and": ["cap-pow"] }, { "and": [ {"checker":"wot", …} ] } ],
 *     "tiers": { "wot": "member" } }
 * Unknown checker names THROW — a foreign policy must never silently admit.
 */
export function parseAdmissionMenu(raw) {
    if (typeof raw !== 'object' || raw === null)
        throw new Error('admission menu must be an object');
    const m = raw;
    if (!Array.isArray(m.or))
        throw new Error('admission menu requires an "or" array');
    const or = m.or.map((clause, ci) => {
        if (typeof clause !== 'object' || clause === null || !Array.isArray(clause.and)) {
            throw new Error(`clause ${ci} requires an "and" array`);
        }
        const and = clause.and.map((ref) => parseCheckerRef(ref));
        return { and };
    });
    const tiers = {};
    if (m.tiers !== undefined) {
        if (typeof m.tiers !== 'object' || m.tiers === null)
            throw new Error('tiers must be an object');
        for (const [k, v] of Object.entries(m.tiers)) {
            if (typeof v !== 'string')
                throw new Error(`tier for ${k} must be a string`);
            tiers[k] = v;
        }
    }
    return { or, ...(Object.keys(tiers).length > 0 ? { tiers } : {}) };
}
function parseCheckerRef(raw) {
    if (raw === 'invite-link' || raw === 'cap-pow' || raw === 'founder-attestation')
        return raw;
    if (typeof raw === 'string')
        throw new Error(`unknown admission checker: ${raw}`);
    if (typeof raw !== 'object' || raw === null)
        throw new Error('checker ref must be a string or object');
    const r = raw;
    switch (r.checker) {
        case 'trade-credential': {
            const issuerPub = r.issuerPub;
            if (typeof issuerPub !== 'object' || issuerPub === null || typeof issuerPub.n !== 'string' || typeof issuerPub.e !== 'string') {
                throw new Error('trade-credential requires issuerPub {n, e}');
            }
            return { checker: 'trade-credential', issuerPub };
        }
        case 'wot': {
            if (!Array.isArray(r.trustRoots) || !r.trustRoots.every((x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x))) {
                throw new Error('wot requires trustRoots (array of 64-hex pubkeys)');
            }
            if (typeof r.maxDistance !== 'number' || !Number.isSafeInteger(r.maxDistance) || r.maxDistance < 0) {
                throw new Error('wot requires a non-negative integer maxDistance');
            }
            return { checker: 'wot', trustRoots: r.trustRoots, maxDistance: r.maxDistance };
        }
        case 'zap-bond': {
            if (typeof r.amountSats !== 'number' || !Number.isSafeInteger(r.amountSats) || r.amountSats <= 0) {
                throw new Error('zap-bond requires a positive integer amountSats');
            }
            return { checker: 'zap-bond', amountSats: r.amountSats };
        }
        case 'vouch': {
            const max = r.maxVouchesPerMember;
            if (max !== undefined && (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1)) {
                throw new Error('vouch maxVouchesPerMember must be a positive integer');
            }
            return { checker: 'vouch', ...(max !== undefined ? { maxVouchesPerMember: max } : {}) };
        }
        default:
            throw new Error(`unknown admission checker: ${JSON.stringify(r.checker)}`);
    }
}
