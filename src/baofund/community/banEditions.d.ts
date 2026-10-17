/**
 * vsk:4 banlist editions (kind 3308) - deny-only removal list, folded
 * client-side. Companion to roleEditions.ts (same kind, same relay query;
 * the two folds split events by their `vsk` sub-kind tag).
 *
 * Wire contract (the B1 lesson applied):
 *   - ONE event PER TARGET, addressed by d tag `ban:<pubkey>`. Relays may
 *     replace by (pubkey, d) - that replacement then only ever touches ONE
 *     target's entry, never the whole list. A whole-list-in-one-event
 *     design would hand relay replacement the power to silently unban.
 *   - Full restatement discipline inside one edition: an entry re-published
 *     with an EMPTY member set = lift (omission is deletion - D1's rule,
 *     now on the banlist).
 *   - Deny-only: a banlist can REMOVE admission and participation; it can
 *     never grant a role, a perm, or admission (§6: roles never admit; the
 *     lanes stay the only doors).
 *   - Authority: founder (joined.governance) or any holder of the `ban`
 *     perm in the CURRENT role fold, verified client-side before applying
 *     (a hostile relay cannot fabricate entries).
 *   - Epoch-bounded: entries match room + epoch; a rekey invalidates the
 *     old list (fresh epoch = fresh room).
 *   - Timestamp semantics: `banFrom` (created_at of the banning edition)
 *     is when the target became banned; lift is the REPLACEMENT of that
 *     entry. Ban-then-lift-then-reban by created_at order resolves to the
 *     latest edition per d tag (see foldBanEditions ordering note).
 */
import type { NostrEvent } from 'nostr-tools/pure';
export declare const BAN_KIND = 3308;
export declare const BAN_VSK = "4";
export declare const BANLIST_WIRE_VERSION = 1;
/** Parse a kind-3308 event into a banlist edition. Returns null when the
 *  event is not a vsk:4 banlist edition (wrong kind / vsk / missing room) -
 *  callers treat null as "not our surface". */
export declare function parseBanEdition(event: NostrEvent): BanEdition | null;
export interface BanEdition {
    eventId: string;
    author: string;
    createdAt: number;
    roomId: string;
    epoch: number;
    /** The addressed target pubkey (lowercase 64-hex). */
    target: string;
    /** True when the edition restates an EMPTY member set (a lift). */
    lifted: boolean;
    members: string[];
    /** NIP-40 expiration (unix seconds) when the entry is a KICK - the deny
     *  lapses after this instant. Clients that ignore it keep the deny. The
     *  fold drops expired entries from the slot state; it never lets a lapsed
     *  kick lift an older standing permanent ban (see foldBanEditions). */
    expiration?: number;
}
export interface BanAuthorityInput {
    roomId: string;
    epoch: number;
    /** Room founder key (provisioned rooms: `joined.governance`). */
    founder: string;
    /** Pubkeys holding the `ban` perm under the CURRENT role fold. */
    banPermHolders: ReadonlySet<string>;
    /** Pubkeys holding the `kick` perm under the CURRENT role fold. A kick is
     *  an expiring ban edition: its authority is the `kick` perm, which the
     *  catalog grants separately from `ban` (v0 status quo: moderator holds
     *  both; custom roles may hold either alone). Omitted ⇒ no kick-only
     *  holders can publish, never the reverse. */
    kickPermHolders?: ReadonlySet<string>;
    /** Ephemeral/shielded tier ⇒ banlist unsupported (tier honesty, §4). */
    ephemeral: boolean;
    /** Injected clock for NIP-40 kick expiry. Defaults to wall-clock inside
     *  the fold; tests inject a pinned value. */
    nowSeconds?: () => number;
}
export interface FoldedBanlist {
    /** 'none': no valid edition exists. 'ok': entries applied (possibly with
     *  frozen slots - see frozenTargets). */
    status: 'none' | 'ok';
    /** target pubkey → the applied entry (lifts REMOVE the key). A frozen
     *  slot keeps its last-applied state here. */
    banned: Map<string, BanEdition>;
    /** Targets whose same-timestamp editions conflict: the slot is frozen at
     *  its last-applied state (conservative - a ban stays) until a strictly
     *  later valid edition resolves it. Per-slot, NOT whole-list: one
     *  target's ambiguity must not freeze every other entry. */
    frozenTargets: string[];
    /** Per-slot fork evidence: target → [applied id, conflicting id]. */
    forks: Map<string, [string, string]>;
    stats: {
        seen: number;
        valid: number;
        foreign: number;
    };
}
/** Fold banlist editions into the room's authoritative deny list.
 *
 * Ordering: candidates walk chronologically (created_at asc, id asc as the
 * display tie-break). Each target's LATEST applied edition wins - that is
 * exactly "ban-then-lift-then-reban resolves to the last valid word",
 * mirroring the role fold's replacement semantics without any relay
 * replace-by ambiguity (each target is its own d slot). An EXPIRED kick
 * (NIP-40) is skipped entirely: its deny lapsed, but it must never restate
 * away an older permanent ban - only a `ban`-authorized lift/restatement
 * grants admission back.
 *
 * Fork rule (per-slot, §5's rule applied to the banlist): two VALID
 * editions for the SAME target at the same created_at (different event ids)
 * freeze THAT slot - never newest-wins. A MIXED same-second ban/lift
 * conflict resolves to the BAN standing (deny-only conservatism: the id
 * tie-break must never decide an unban); same-kind conflicts keep the
 * tie-break-applied edition. A strictly-later valid edition for the target
 * resolves the fork. Other targets keep folding - one ambiguous d slot
 * must not freeze the whole list.
 */
export declare function foldBanEditions(events: NostrEvent[], input: BanAuthorityInput): FoldedBanlist;
/** Deny-only checks over the folded list (spec §6). These NEVER grant
 *  anything - the only questions they answer are "is X excluded?". */
export declare function isBanned(banned: FoldedBanlist, pubkey: string): boolean;
/** Ban-from timestamp for a target: `created_at` of the banning edition
 *  (the B6 rule: store the anchor, derive windows from it). Null when not
 *  banned. */
export declare function banFrom(banned: FoldedBanlist, pubkey: string): number | null;
export interface BanEditionSpec {
    roomId: string;
    epoch: number;
    target: string;
    /** Omit (or pass []) to publish a LIFT. */
    reason?: string;
    alt?: string;
    prev?: string;
    /** Pin created_at (deterministic vectors/tests). Default: now. */
    createdAt?: number;
    /** NIP-40 `expiration` tag (unix seconds) - a TEMPORARY removal (kick):
     *  after this time the lapse is folded as if the entry were absent (a
     *  permanent ban from an earlier edition still stands). The tag stays on
     *  the relay event (NIP-40: relays may delete; readers that ignore
     *  expiration keep the deny - fail-closed conservatism). */
    expiration?: number;
}
export declare function buildBanEditionTags(spec: BanEditionSpec, lifted: boolean): string[][];
/** Build + sign a banlist edition (entry or lift) with `signerSecretKey`.
 *  The caller is responsible for authority - the fold, not the builder, is
 *  the gate. */
export declare function buildBanEditionEvent(signerSecretKey: Uint8Array, spec: BanEditionSpec): NostrEvent;
/** Build + sign a LIFT edition (empty member set - omission is deletion). */
export declare function buildBanLiftEvent(signerSecretKey: Uint8Array, spec: BanEditionSpec): NostrEvent;
/** Relay filter for a room's banlist editions (same kind as roles; the
 *  folds split by `vsk`). */
/** Relay filter for a room's banlist editions. Queries the single-char `r`
 *  alias - strfry only indexes 1-char tag names (see roleEditions). */
export declare function banEditionFilter(roomId: string): {
    kinds: number[];
    '#r': string[];
};
