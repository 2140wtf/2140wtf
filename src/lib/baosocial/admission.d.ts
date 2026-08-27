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
import { type Clock, type NostrEvent } from './crypto.js';
import { NullifierCache, type Credential, type RsaPublicKey } from './credential.js';
/** Every proof type a checker can consume. A join carries any subset. */
export interface AdmissionProofs {
    /** Claimed main identity pubkey (64-hex) — for wot/founder-attestation.
     *  Never relay-visible (§6). */
    claimedPubkey?: string;
    /** A presented trade credential + its finalized signature. */
    credential?: {
        credential: Credential;
        signature: string;
    };
    /** Opaque zap-bond proof — interpreted ONLY by the injected verifier. */
    zapBond?: unknown;
    /** Vouch: a signed event (purpose 'bao-vouch') by an existing member. */
    vouch?: NostrEvent;
}
/** Room-scoped evaluation context. */
export interface AdmissionContext {
    roomId: string;
    /** Burner pubkey authoring the join request. */
    burnerPub: string;
    clock?: Clock;
}
export type CheckerVerdict = {
    admit: boolean;
    reason: string;
};
/** Follow graph for WoT gates. Implementations fetch/cache as they like —
 *  this module never does. */
export interface FollowGraph {
    /** True iff `a` follows `b`. May be sync or async. */
    follows(a: string, b: string): boolean | Promise<boolean>;
}
/** A follow graph that can ALSO enumerate out-edges (needed for BFS beyond
 *  depth 1; pairwise-only graphs answer direct-path checks). */
export interface FollowGraphWithNeighbors extends FollowGraph {
    neighbors?(a: string): string[] | Promise<string[]>;
}
/** Zap-bond verifier. The library defines the shape; the deployment
 *  provisions the implementation (LN receipt check, ecash lock, …). */
export interface ZapBondVerifier {
    verify(proof: unknown, amountSats: number): boolean | Promise<boolean>;
}
/** Room membership oracle for vouching. */
export interface MembershipProvider {
    isMember(pubkey: string): boolean | Promise<boolean>;
}
/** Providers are provisioned per room; every checker pulls what it needs. */
export interface AdmissionProviders {
    followGraph?: FollowGraph;
    zapBondVerifier?: ZapBondVerifier;
    membership?: MembershipProvider;
    /** Welcomer-side credential nullifier cache (one credential = one join). */
    nullifierCache?: NullifierCache;
    /** Founder-attested pubkeys (kind 39998, folded by the caller). */
    founderAttested?: string[];
    /** Grace period (seconds) added to a credential's REMAINING validity for
     *  nullifier cache entries — replay protection must outlive the
     *  credential itself (default 24 h grace). */
    nullifierGraceSec?: number;
    /** Per-member vouch budget — REQUIRED when the menu uses vouch checker.
     *  Shared across eval (peek) and commit (consume) so two-phase discipline
     *  holds. The daemon must create one instance per room and pass it in.
     *  Restart resets the budget (same discipline as inviteUses). */
    vouchBudget?: VouchBudget;
}
/**
 * A checker reference in the AST. Plain string = bare checker
 * ('cap-pow'); object form carries params: { checker: 'wot', … }.
 */
export type CheckerRef = 'invite-link' | 'cap-pow' | 'founder-attestation' | {
    checker: 'trade-credential';
    issuerPub: RsaPublicKey;
} | {
    checker: 'wot';
    trustRoots: string[];
    maxDistance: number;
} | {
    checker: 'zap-bond';
    amountSats: number;
} | {
    checker: 'vouch';
    maxVouchesPerMember?: number;
};
export interface AndClause {
    and: CheckerRef[];
}
/** OR of AND clauses (spec §7). */
export interface AdmissionMenu {
    or: AndClause[];
    /** Optional tier mapping: checker name → standing tier label returned
     *  on admission (scribe rate budgets / invite rights, §7). */
    tiers?: Record<string, string>;
}
export interface AdmissionResult {
    admit: boolean;
    /** Index of the admitting clause (-1 when rejected). */
    clause: number;
    /** Per-checker reasons, ALL evaluated (no early-exit ambiguity). */
    reasons: string[];
    /** Standing tier for the admitting clause (from tiers map), if any. */
    tier?: string;
}
export declare function checkerName(ref: CheckerRef): string;
/** Vouch event: purpose 'bao-vouch', p = claimant pubkey, room = roomId,
 *  expiration tag bounds validity. Signed by an existing member. */
export declare const VOUCH_PURPOSE = "bao-vouch";
export declare const VOUCH_KIND = 30078;
export declare function buildVouchEvent(memberSign: (t: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
}) => NostrEvent, claimantPub: string, roomId: string, clock?: Clock, ttlSec?: number): NostrEvent;
export declare function parseVouchEvent(event: NostrEvent, roomId: string, now: number): {
    voucher: string;
    claimant: string;
} | null;
/** Bounded per-member vouch counter (welcomer-side, ReplayCache-style).
 *  In-memory by design (same accepted discipline as inviteUses) — a daemon
 *  restart resets counts; ops note, not a protocol property. */
export declare class VouchBudget {
    readonly maxPerMember: number;
    private readonly counts;
    constructor(maxPerMember?: number);
    /** True iff the voucher may vouch again (consumes one slot). */
    consume(voucher: string): boolean;
    /** Read-only check (two-phase evaluation — consume only on admission). */
    peek(voucher: string): boolean;
    used(voucher: string): number;
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
export declare function evaluateAdmission(menu: AdmissionMenu, proofs: AdmissionProofs, ctx: AdmissionContext, providers?: AdmissionProviders & {
    vouchBudget?: VouchBudget;
}): Promise<AdmissionResult>;
export declare function presetOpen(difficulty?: number): AdmissionMenu;
export declare function presetCommunity(trustRoots: string[], maxDistance?: number, powDifficulty?: number): AdmissionMenu;
export declare function presetTraders(issuerPub: RsaPublicKey): AdmissionMenu;
export declare function presetInviteOnly(): AdmissionMenu;
/**
 * Parse a rooms-file admission menu spec. JSON form:
 *   { "or": [ { "and": ["cap-pow"] }, { "and": [ {"checker":"wot", …} ] } ],
 *     "tiers": { "wot": "member" } }
 * Unknown checker names THROW — a foreign policy must never silently admit.
 */
export declare function parseAdmissionMenu(raw: unknown): AdmissionMenu;
