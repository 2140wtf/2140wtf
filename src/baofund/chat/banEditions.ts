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
import { verifyEvent } from '@/baofund/community/crypto.js';
import { finalizeEvent } from '@/baofund/community/crypto.js';

export const BAN_KIND = 3308;
export const BAN_VSK = '4';

export const BANLIST_WIRE_VERSION = 1;

const HEX64 = /^[0-9a-f]{64}$/;

function firstTag(tags: string[][], name: string): string | null {
  const t = tags.find((row) => row[0] === name);
  return t && typeof t[1] === 'string' ? t[1] : null;
}

function tagValues(tags: string[][], name: string): string[][] {
  return tags.filter((t) => t[0] === name).map((t) => t.slice(1));
}

/** Parse a kind-3308 event into a banlist edition. Returns null when the
 *  event is not a vsk:4 banlist edition (wrong kind / vsk / missing room) -
 *  callers treat null as "not our surface". */
export function parseBanEdition(event: NostrEvent): BanEdition | null {
  if (event.kind !== BAN_KIND) return null;
  if (firstTag(event.tags, 'vsk') !== BAN_VSK) return null;
  const roomId = firstTag(event.tags, 'room');
  if (!roomId) return null;
  const epochRaw = firstTag(event.tags, 'epoch');
  const epoch = epochRaw !== null && /^\d+$/.test(epochRaw) ? Number(epochRaw) : NaN;
  if (!Number.isSafeInteger(epoch)) return null;

  // Per-entry addressing (B1): one target per event, keyed by d tag.
  const dRaw = firstTag(event.tags, 'd');
  const target = dRaw !== null && dRaw.startsWith('ban:') ? dRaw.slice(4).toLowerCase() : null;
  if (!target || !HEX64.test(target)) return null;

  // The `p` tag mirrors the target (relay-side filterability + parity with
  // NIP conventions); when present it must agree with `d`.
  const p = firstTag(event.tags, 'p');
  if (p !== null && p.toLowerCase() !== target) return null;

  // Full restatement of the entry's member set. Empty = lift.
  const members: string[] = [];
  for (const [pk] of tagValues(event.tags, 'member')) {
    if (typeof pk !== 'string') continue;
    const norm = pk.toLowerCase();
    if (!HEX64.test(norm) || norm !== target) continue; // d is the authority
    if (!members.includes(norm)) members.push(norm);
  }

  // NIP-40 expiration (unix seconds) - a kick: the deny lapses after this
  // instant. Malformed values are IGNORED (deny stands - fail closed).
  let expiration: number | null = null;
  const expRaw = firstTag(event.tags, 'expiration');
  if (expRaw !== null && /^\d+$/.test(expRaw)) expiration = Number(expRaw);

  return {
    eventId: event.id,
    author: event.pubkey,
    createdAt: event.created_at,
    roomId,
    epoch,
    target,
    lifted: members.length === 0,
    members,
    ...(expiration !== null ? { expiration } : {}),
  };
}

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
  stats: { seen: number; valid: number; foreign: number };
}

/** Is this edition's signer authorized? Founder always; otherwise the
 *  signer must hold `ban` under the CURRENT role fold (verified client-side
 *  first - a hostile relay cannot fabricate entries). */
function isAuthorized(
  edition: BanEdition,
  event: NostrEvent,
  input: BanAuthorityInput,
): boolean {
  if (event.pubkey === input.founder) return true;
  // Permanent editions are `ban` authority ONLY. Expiring editions (kicks)
  // may be signed by a `kick` holder; a `ban` holder may kick too (ban
  // authority subsumes a temporary removal). A `kick`-only holder can never
  // publish a permanent ban.
  if (edition.expiration !== undefined) {
    return input.banPermHolders.has(event.pubkey) || (input.kickPermHolders?.has(event.pubkey) ?? false);
  }
  return input.banPermHolders.has(event.pubkey);
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
export function foldBanEditions(events: NostrEvent[], input: BanAuthorityInput): FoldedBanlist {
  const nowSeconds = input.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const empty: FoldedBanlist = {
    status: 'none',
    banned: new Map(),
    frozenTargets: [],
    forks: new Map(),
    stats: { seen: 0, valid: 0, foreign: 0 },
  };
  if (input.ephemeral) return empty;

  const byId = new Map<string, NostrEvent>();
  for (const event of events) {
    const parsed = parseBanEdition(event);
    if (!parsed || parsed.roomId !== input.roomId || parsed.epoch !== input.epoch) continue;
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  const candidates = [...byId.values()].sort(
    (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const applied = new Map<string, BanEdition>();
  const forks = new Map<string, [string, string]>();
  let valid = 0;
  let foreign = 0;
  let lapsed = 0;

  for (const event of candidates) {
    const parsed = parseBanEdition(event)!;
    if (!verifyEvent({ ...event })) {
      foreign++; // client-side verification: never trust relay-side checks
      continue;
    }
    if (!isAuthorized(parsed, event, input)) {
      foreign++;
      continue;
    }
    // A principal under removal must not authorize an edition for their own
    // key: without this, a banned ban-perm holder signs a lift for their own
    // d slot and nullifies the founder's removal. Founder authority remains
    // supreme (a founder may always restate).
    if (parsed.target === event.pubkey.toLowerCase() && event.pubkey !== input.founder) {
      foreign++;
      continue;
    }
    // NIP-40 kick semantics: once `expiration` has passed, the deny has
    // lapsed. The entry is IGNORED for the slot state rather than applied as
    // a lift: a kick must never restate away a standing permanent ban (only
    // a `ban`-authorized lift or restatement grants admission back), and a
    // kick-only holder must not be able to launder an unban by waiting out
    // their own timeout. Clients ignoring expiration keep the deny (fail
    // closed).
    if (parsed.expiration !== undefined && parsed.expiration <= nowSeconds()) {
      lapsed++; // a real banlist exists; its expiring entry has lapsed
      continue;
    }
    const current = applied.get(parsed.target);
    if (current) {
      if (current.createdAt === parsed.createdAt) {
        // Same-timestamp conflict on this slot: record the evidence, never
        // newest-wins (§5). Deny-only conservatism for MIXED conflicts: a
        // same-second ban/lift disagreement resolves to the BAN standing -
        // the id tie-break must never accidentally unban through a lottery.
        // Same-kind conflicts keep the tie-break-applied edition.
        if (!forks.has(parsed.target)) forks.set(parsed.target, [current.eventId, parsed.eventId]);
        if (current.lifted !== parsed.lifted) {
          // Deny-only conservatism: the BAN standing wins a mixed conflict -
          // replace only when the incumbent is a lift and the newcomer a ban.
          applied.set(parsed.target, current.lifted ? parsed : current);
        }
        continue;
      }
      // Strictly later edition: replaces AND resolves any slot fork.
      forks.delete(parsed.target);
    }
    // A lift is a replacement with an empty member set → the key is
    // removed; the slot's history lives on in relay storage, not here.
    applied.set(parsed.target, parsed);
    valid++;
  }

  if (applied.size === 0 && forks.size === 0) {
    return {
      ...empty,
      // A lapsed-only list still reports 'ok' (a banlist exists and is
      // currently empty) - same verdict the old as-lift fold produced.
      ...(lapsed > 0 ? { status: 'ok' as const } : {}),
      stats: { seen: candidates.length, valid, foreign },
    };
  }

  const banned = new Map<string, BanEdition>();
  for (const [target, edition] of applied) {
    if (!edition.lifted) banned.set(target, edition);  }

  return {
    status: 'ok',
    banned,
    frozenTargets: [...forks.keys()],
    forks,
    stats: { seen: candidates.length, valid, foreign },
  };
}

/** Deny-only checks over the folded list (spec §6). These NEVER grant
 *  anything - the only questions they answer are "is X excluded?". */
export function isBanned(banned: FoldedBanlist, pubkey: string): boolean {
  return banned.status === 'ok' && banned.banned.has(pubkey.toLowerCase());
}

/** Ban-from timestamp for a target: `created_at` of the banning edition
 *  (the B6 rule: store the anchor, derive windows from it). Null when not
 *  banned. */
export function banFrom(banned: FoldedBanlist, pubkey: string): number | null {
  if (banned.status !== 'ok') return null;
  const entry = banned.banned.get(pubkey.toLowerCase());
  return entry ? entry.createdAt : null;
}

// ─── Publication (founder or ban-perm holder; the fold is the gate) ────────

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

export function buildBanEditionTags(spec: BanEditionSpec, lifted: boolean): string[][] {
  const tags: string[][] = [
    ['vsk', BAN_VSK],
    ['room', spec.roomId],
    // Single-char alias for strfry's 1-char tag index (see roleEditions).
    ['r', spec.roomId],
    ['epoch', String(spec.epoch)],
    ['d', `ban:${spec.target.toLowerCase()}`],
    ['p', spec.target.toLowerCase()],
  ];
  if (spec.reason) tags.push(['reason', spec.reason]);
  if (spec.expiration !== undefined) tags.push(['expiration', String(spec.expiration)]);
  if (!lifted) tags.push(['member', spec.target.toLowerCase()]);
  tags.push(['alt', spec.alt ?? (lifted ? 'banlist lift' : 'banlist entry')]);
  if (spec.prev) tags.push(['prev', spec.prev]);
  return tags;
}

/** Build + sign a banlist edition (entry or lift) with `signerSecretKey`.
 *  The caller is responsible for authority - the fold, not the builder, is
 *  the gate. */
export function buildBanEditionEvent(signerSecretKey: Uint8Array, spec: BanEditionSpec): NostrEvent {
  return finalizeEvent(
    {
      kind: BAN_KIND,
      created_at: spec.createdAt ?? Math.floor(Date.now() / 1000),
      tags: buildBanEditionTags(spec, false),
      content: '',
    },
    signerSecretKey,
  );
}

/** Build + sign a LIFT edition (empty member set - omission is deletion). */
export function buildBanLiftEvent(signerSecretKey: Uint8Array, spec: BanEditionSpec): NostrEvent {
  return finalizeEvent(
    {
      kind: BAN_KIND,
      created_at: spec.createdAt ?? Math.floor(Date.now() / 1000),
      tags: buildBanEditionTags(spec, true),
      content: '',
    },
    signerSecretKey,
  );
}

/** Relay filter for a room's banlist editions (same kind as roles; the
 *  folds split by `vsk`). */
/** Relay filter for a room's banlist editions. Queries the single-char `r`
 *  alias - strfry only indexes 1-char tag names (see roleEditions). */
export function banEditionFilter(roomId: string): { kinds: number[]; '#r': string[] } {
  return { kinds: [BAN_KIND], '#r': [roomId] };
}
