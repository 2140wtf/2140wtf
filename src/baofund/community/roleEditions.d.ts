import { type NostrEvent } from './crypto.js';
export declare const ROLE_KIND = 3308;
export declare const ROLE_CATALOG_VERSION = 1;
/**
 * Bound on a per-room raw control-edition cache (vsk:1 roles + vsk:4 bans
 * share kind 3308). Any relay writer can publish a 3308 addressed to a known
 * room id, so an unbounded re-fold input is a memory/CPU DoS; caches keep
 * only the newest `MAX_CONTROL_EVENTS`, and the folds remain the authority
 * gate (a dropped old edition can only be re-read from the relay).
 */
export declare const MAX_CONTROL_EVENTS = 200;
/**
 * Cheap pre-cache filter: true when `event` is a structurally valid, SIGNED
 * control edition (vsk:1 role or vsk:4 ban) addressed to `roomId` at `epoch`.
 * The fold still applies every authority rule; this keeps foreign, malformed
 * or unsigned 3308 junk out of the per-room cache and the O(n) re-fold.
 */
export declare function isControlEditionForRoom(event: NostrEvent, roomId: string, epoch: number): boolean;
/**
 * Bounded, id-deduped merge for a per-room control-edition cache. Pure so the
 * bound/dedupe rules are testable once and shared by the browser hook and the
 * daemon fold input:
 *   - incoming order is preserved (fold input stays chronological);
 *   - empty/duplicate ids are skipped;
 *   - only the newest `max` entries are retained, and the id set is rebuilt
 *     from the retained window - neither structure can grow without bound
 *     (a flood of unique ids must not grow the SET either).
 */
export declare function mergeControlEventCache(current: readonly NostrEvent[], ids: ReadonlySet<string>, incoming: readonly NostrEvent[], max?: number): {
    events: NostrEvent[];
    ids: Set<string>;
};
/** Closed perm vocabulary (spec §2). `pin-role` = who may publish vsk:1
 *  editions; `role-grant` is reserved for v1 chat-level role requests - v0
 *  edition publication is gated on `pin-role` only (spec §2/§6). */
export declare const PERM_VOCABULARY: readonly ["pin", "kick", "ban", "role-grant", "delete-message", "pin-role"];
export type Perm = (typeof PERM_VOCABULARY)[number];
export interface RoleDef {
    id: string;
    rank: number;
    perms: readonly Perm[];
}
/** The `catv:1` catalog. Only the founder holds `pin-role` by default; it
 *  may be granted via an edition's perm tags (spec §8 D1). Dropping a member
 *  or perm = omit it from the next full restatement - there is deliberately
 *  no delete tag (omission is deletion). */
export declare const ROLE_CATALOG_V1: readonly RoleDef[];
export declare const ROLE_CATALOGS: ReadonlyMap<number, readonly RoleDef[]>;
export declare function roleDef(catv: number, roleId: string): RoleDef | null;
/** A structurally-parsed vsk:1 edition. Signature validity is NOT implied -
 *  `signerClassFor` decides authority against the current fold state. */
export interface RoleEdition {
    eventId: string;
    author: string;
    createdAt: number;
    roomId: string;
    epoch: number;
    /** Catalog version tag value; 0 when the tag is absent (spec: default 1 -
     *  an absent tag is explicitly `catv:1`, NOT unknown). */
    catv: number;
    /** Declared role structure, in tag order (id + declared rank). */
    roles: Array<{
        id: string;
        rank?: number;
    }>;
    /** Declared perms per role id, in tag order (vocabulary-filtered). */
    perms: Map<string, Perm[]>;
    /** Declared members per role id, in tag order (64-hex lowercase; invalid
     *  entries are dropped, never thrown - foreign junk must not crash UIs). */
    members: Map<string, string[]>;
}
/** Parse a Nostr event into a RoleEdition. Returns null when the event is
 *  not a kind-3308 vsk:1 role edition at all (wrong kind / missing vsk tag /
 *  missing room tag) - callers treat null as "not our surface". */
export declare function parseRoleEdition(event: NostrEvent): RoleEdition | null;
export type SignerClass = 'founder' | 'pin-role-holder' | 'foreign';
/** Effective perms for `pubkey` under edition `ed` - catalog perms for known
 *  roles ∪ declared perms; unknown roles (unknown catv) enforce NOTHING. */
export declare function permsUnder(ed: RoleEdition, pubkey: string): Perm[];
/** Classify `event`'s signer against the room founder and the CURRENT top
 *  edition (null before any valid edition). Verifies the schnorr signature
 *  and event id client-side - a hostile relay must not be able to fabricate
 *  a roster. The shallow copy defeats nostr-tools' verified-object cache so
 *  every call re-checks (crypto.ts explicitly warns about that cache). */
export declare function signerClassFor(event: NostrEvent, opts: {
    founder: string;
    top: RoleEdition | null;
}): SignerClass;
/** Structure-preservation rule (spec §2, D2): a non-founder edition MUST
 *  restate the `catv` + `role` + `perm` structure verbatim - only `member`
 *  tags may differ. Founder editions may restructure freely. */
export declare function structureMatches(candidate: RoleEdition, top: RoleEdition): boolean;
export interface AssignedRole {
    roleId: string;
    /** Catalog rank when the role is known, else the declared tag rank (may be
     *  null) - display-only. */
    rank: number | null;
    perms: readonly Perm[];
    /** False ⇒ unknown catalog version: render `?`, enforce NOTHING (D1). */
    known: boolean;
}
export interface FoldedRoles {
    /** 'none': no valid edition exists yet (everyone is a plain member).
     *  'ok': a top edition is applied. 'fork': frozen (B1 rule - never
     *  newest-wins). 'ignored-ephemeral': roles unsupported in this tier. */
    status: 'none' | 'ok' | 'fork' | 'ignored-ephemeral';
    /** The applied top edition (null when none / ignored-ephemeral; the last
     *  applied edition when frozen - rendered but marked frozen). */
    edition: RoleEdition | null;
    frozen: boolean;
    /** pubkey → resolved roles from the top edition. Members of an
     *  unknown-catalog edition still appear (known:false) so the UI can render
     *  `?` instead of silently hiding them. */
    grants: Map<string, AssignedRole[]>;
    /** True when the top edition's catv is not in this client's catalog. */
    unknownCatalog: boolean;
    /** The two conflicting edition ids when frozen. */
    forkIds: [string, string] | null;
    stats: {
        seen: number;
        valid: number;
        foreign: number;
    };
}
export interface FoldInput {
    roomId: string;
    /** Current ratchet epoch - editions for other epochs are foreign (§2). */
    epoch: number;
    /** Room founder key (for provisioned rooms: `joined.governance`). */
    founder: string;
    /** Ephemeral/shielded tier ⇒ roles unsupported (§4; §7 test 5). */
    ephemeral: boolean;
}
/** Fold role editions into the room's authoritative role state.
 *
 * Walks candidates chronologically (created_at asc, event id asc as the
 * display tie-break), maintaining the evolving top:
 *   - each candidate must verify client-side and match room+epoch;
 *   - founder editions apply (restructure freely);
 *   - pin-role-holder editions apply only with the structure rule intact;
 *   - anything else is foreign and skipped, never an error;
 *   - a second VALID edition at the same created_at as the top is a FORK:
 *     the fold freezes (last applied state retained, `frozen: true`), and
 *     nothing after the fork is auto-applied.
 */
export declare function foldRoleEditions(events: NostrEvent[], input: FoldInput): FoldedRoles;
/** Every perm `pubkey` holds under the folded state. Unknown-catalog and
 *  frozen states still answer - with the perms they truthfully carry; the
 *  CALLER decides what a frozen room may do. Unknown roles contribute none. */
export declare function permsFor(folded: FoldedRoles, pubkey: string): Perm[];
export declare function hasPerm(folded: FoldedRoles, pubkey: string, perm: Perm): boolean;
export interface EditionSpec {
    roomId: string;
    epoch: number;
    catv?: number;
    /** Role structure - id + rank, in order. */
    roles: Array<{
        id: string;
        rank: number;
    }>;
    /** Full declared perms per role id (restated every edition). */
    perms: Array<{
        roleId: string;
        perm: Perm;
    }>;
    /** Full member set per role id (restated every edition; omission=deletion). */
    members: Array<{
        roleId: string;
        pubkey: string;
    }>;
    alt?: string;
    prev?: string;
}
export declare function buildRoleEditionTags(spec: EditionSpec): string[][];
/** Build + sign a role edition with `signerSecretKey`. The caller is
 *  responsible for authority - the fold, not the builder, is the gate. */
export declare function buildRoleEditionEvent(signerSecretKey: Uint8Array, spec: EditionSpec): NostrEvent;
/** Relay filter for a room's role editions (public stored events). Queries
 *  the single-char `r` alias - see buildRoleEditionTags. */
export declare function roleEditionFilter(roomId: string): {
    kinds: number[];
    '#r': string[];
};
