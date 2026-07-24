/**
 * Concord V2 Control Plane — CORD-02 §5/§6/§9, CORD-04.
 *
 * The Control Plane is one Private Stream per Community (keyed by the
 * community_root at `control_pk`) carrying versioned, real-npub-signed
 * editions inside PLAINTEXT seals (kind 20014 — the one plane whose seals stay
 * plaintext so a compaction can re-wrap signed editions across epochs).
 *
 * `foldControlState` replays the whole plane into current state in one pass:
 * the owner-rooted roster first (delegation fixpoint — the owner's rank comes
 * from the community_id itself, never from any fold), then every authority-
 * gated entity (metadata, channels, banlist, invite registries).
 */

import type { NostrEvent } from "nostr-tools/pure";

import {
  banlistLocator,
  bytesToHex,
  controlGroupKey,
  dissolvedGroupKey,
  grantLocator,
  hex32,
  inviteLinksLocator,
  type GroupKey,
} from "@/concord-v2/lib/derive";
import {
  buildEditionRumor,
  parseEdition,
  toFoldEdition,
  type AuthorityCitation,
  type ParsedEdition,
} from "@/concord-v2/lib/edition";
import {
  KIND_SEAL_PLAINTEXT,
  VSK_BANLIST,
  VSK_CHANNEL,
  VSK_DISSOLVED,
  VSK_GRANT,
  VSK_INVITE_REGISTRY,
  VSK_METADATA,
  VSK_ROLE,
} from "@/concord-v2/lib/kinds";
import {
  canActOnPosition,
  emptyRoles,
  grantFromJSON,
  grantToJSON,
  hasPermission,
  highestPosition,
  isAuthorized,
  MAX_ROLES_PER_COMMUNITY,
  outranks,
  Permissions,
  roleFromJSON,
  roleToJSON,
  type CommunityRoles,
  type MemberGrant,
  type Role,
} from "@/concord-v2/lib/roles";
import { buildRumor, openWrap, sealRumor, wrapSeal, type OpenedEvent, type Rumor, type StreamSigner } from "@/concord-v2/lib/stream";
import {
  utf8Len,
  DESCRIPTION_MAX_BYTES,
  NAME_MAX_BYTES,
  capRelays,
  isImagePointer,
  type ChannelMetadata,
  type CommunityMetadata,
  type CommunityV2,
} from "@/concord-v2/lib/types";
import { bootstrapHead, fold, type Edition } from "@/concord-v2/lib/version";

// ── Addressing ───────────────────────────────────────────────────────────────

/** Every control-plane stream key across the community's held root epochs, newest first. */
export function controlGroups(community: CommunityV2): GroupKey[] {
  return community.heldRoots.map((r) => controlGroupKey(r.key, community.id, r.epoch));
}

/** The CURRENT control-plane stream key (where new editions publish). */
export function currentControlGroup(community: CommunityV2): GroupKey {
  return controlGroupKey(community.root, community.id, community.rootEpoch);
}

// ── Sealing / opening ────────────────────────────────────────────────────────

/** Sign (plaintext seal) + wrap one edition rumor for the control stream. */
export async function sealEdition(rumor: Rumor, control: GroupKey, signer: StreamSigner): Promise<NostrEvent> {
  const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, control, signer);
  return wrapSeal(seal, control);
}

/**
 * Decode-once memo for opened+parsed control editions, keyed by wrap id. The
 * roster/metadata/banlist consumers re-fold on every mount and poll; a wrap's
 * decryption + seal verify is immutable, so parse each exactly once per
 * session. `null` remembers a failure (not ours / malformed) so it isn't
 * retried either.
 */
const parsedEditionMemo = new Map<string, ParsedEdition | null>();

/** Open every control wrap that decodes under one of `groups` into editions. */
export function openControlWraps(wraps: NostrEvent[], groups: GroupKey[]): ParsedEdition[] {
  const byPk = new Map(groups.map((g) => [g.pk, g]));
  const out: ParsedEdition[] = [];
  for (const wrap of wraps) {
    const cached = parsedEditionMemo.get(wrap.id);
    if (cached !== undefined) {
      if (cached) out.push(cached);
      continue;
    }
    const group = byPk.get(wrap.pubkey);
    if (!group) continue; // an epoch we don't hold — leave uncached (a caught-up rekey may open it)
    let parsed: ParsedEdition | null = null;
    try {
      parsed = parseEdition(openWrap(wrap, group));
    } catch {
      parsed = null;
    }
    parsedEditionMemo.set(wrap.id, parsed);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Parse already-OPENED control events (from the decrypted opened-event cache)
 * into editions. The wrap decrypt + seal verify happened at ingest; this only
 * extracts the edition machinery. Memoized per rumor id, so re-folds are cheap.
 */
export function openControlEditions(opened: OpenedEvent[]): ParsedEdition[] {
  const out: ParsedEdition[] = [];
  for (const ev of opened) {
    const cached = parsedEditionMemo.get(ev.rumorId);
    if (cached !== undefined) {
      if (cached) out.push(cached);
      continue;
    }
    let parsed: ParsedEdition | null = null;
    try {
      parsed = parseEdition(ev);
    } catch {
      parsed = null;
    }
    parsedEditionMemo.set(ev.rumorId, parsed);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ── Edition builders ─────────────────────────────────────────────────────────

interface BuildCommon {
  actorPubkey: string;
  version: bigint;
  prevHash?: Uint8Array;
  createdAtSecs?: number;
  authority?: AuthorityCitation;
}

/** Community metadata (vsk 0); eid = the community_id. Gated by MANAGE_METADATA. */
export function buildMetadataEdition(communityId: Uint8Array, metadata: CommunityMetadata, o: BuildCommon): Rumor {
  if (utf8Len(metadata.name) > NAME_MAX_BYTES) throw new Error(`community name exceeds ${NAME_MAX_BYTES} bytes`);
  if (metadata.description !== undefined && utf8Len(metadata.description) > DESCRIPTION_MAX_BYTES) {
    throw new Error(`description exceeds ${DESCRIPTION_MAX_BYTES} bytes`);
  }
  return buildEditionRumor({ vsk: VSK_METADATA, entityId: communityId, content: JSON.stringify(metadata), ...o });
}

/** Role (vsk 1); eid = the role_id. Gated by MANAGE_ROLES. */
export function buildRoleEdition(role: Role, o: BuildCommon): Rumor {
  if (utf8Len(role.name) > NAME_MAX_BYTES) throw new Error(`role name exceeds ${NAME_MAX_BYTES} bytes`);
  return buildEditionRumor({ vsk: VSK_ROLE, entityId: hex32(role.roleId), content: roleToJSON(role), ...o });
}

/** Channel metadata (vsk 2); eid = the channel_id. Gated by MANAGE_CHANNELS. */
export function buildChannelEdition(channelId: Uint8Array, metadata: ChannelMetadata, o: BuildCommon): Rumor {
  if (utf8Len(metadata.name) > NAME_MAX_BYTES) throw new Error(`channel name exceeds ${NAME_MAX_BYTES} bytes`);
  return buildEditionRumor({ vsk: VSK_CHANNEL, entityId: channelId, content: JSON.stringify(metadata), ...o });
}

/** Grant (vsk 3); eid = grant_locator(cid, member). Empty role_ids = a revoke. */
export function buildGrantEdition(communityId: Uint8Array, grant: MemberGrant, o: BuildCommon): Rumor {
  const entityId = grantLocator(communityId, hex32(grant.member));
  return buildEditionRumor({ vsk: VSK_GRANT, entityId, content: grantToJSON(grant), ...o });
}

/** Banlist (vsk 4); eid = banlist_locator(cid). The whole list, replaced entire. */
export function buildBanlistEdition(communityId: Uint8Array, banned: string[], o: BuildCommon): Rumor {
  return buildEditionRumor({
    vsk: VSK_BANLIST,
    entityId: banlistLocator(communityId),
    content: JSON.stringify(banned),
    ...o,
  });
}

/** Invite Registry (vsk 8); eid = invite_links_locator(cid, creator). Locators only. */
export function buildRegistryEdition(communityId: Uint8Array, creatorHex: string, linkSigners: string[], o: BuildCommon): Rumor {
  return buildEditionRumor({
    vsk: VSK_INVITE_REGISTRY,
    entityId: inviteLinksLocator(communityId, hex32(creatorHex)),
    content: JSON.stringify(linkSigners),
    ...o,
  });
}

// ── The one-pass fold ────────────────────────────────────────────────────────

export interface EntityHead {
  version: bigint;
  hash: Uint8Array;
}

/** One channel's folded definition. */
export interface FoldedChannel {
  channelIdHex: string;
  name: string;
  isPrivate: boolean;
  deleted: boolean;
}

/** The Control Plane replayed into current state. */
export interface FoldedControl {
  roster: CommunityRoles;
  /** The proven owner (from the community_id commitment) — position 0, supreme. */
  ownerHex: string;
  metadata?: CommunityMetadata;
  /** channelIdHex → folded definition (deleted channels included, flagged). */
  channels: Map<string, FoldedChannel>;
  banned: Set<string>;
  /** Aggregate live public-invite link signers (the Public/Private source of truth). */
  liveInviteLinks: Set<string>;
  /** creatorHex → that creator's own registry list (for maintaining one's registry). */
  registriesByCreator: Map<string, string[]>;
  /** Per-entity head version + hash, for chaining the next edition (key = eid hex). */
  heads: Map<string, EntityHead>;
  /**
   * The chosen head EDITION per entity (key = eid hex) — carries the
   * re-wrappable plaintext seal a Refounding's compaction republishes.
   */
  headEditions: Map<string, ParsedEdition>;
  /**
   * Floored entities the served set could not account for: gap-held (the
   * chain to our floor is withheld), or with zero served editions at all. A
   * data-availability signal ONLY — an entity that was served but
   * authority-rejected (stripped, banned) is deliberately absent, not listed.
   * A Refounding MUST NOT compact while non-empty (CORD-06 §3
   * fold-all-or-abort), or the entities listed here are silently dropped from
   * the new epoch.
   */
  incomplete: string[];
  /**
   * npub → the created_at (SECONDS) of the newest AUTHORIZED banlist edition
   * that named them. A member's Guestbook Join that predates their most recent
   * ban is a stale membership: a ban is a departure the Guestbook never records
   * (self-removal is network-silent), so without this an unbanned member's old
   * Join resurfaces as a phantom on the roster. Derived from the same authority
   * gate as `banned`, so a forged banlist can't backdate-suppress a member.
   */
  bannedAt: Map<string, number>;
}

function pushEdition(m: Map<string, ParsedEdition[]>, key: string, p: ParsedEdition) {
  const list = m.get(key);
  if (list) list.push(p);
  else m.set(key, [p]);
}

/**
 * Fold one entity's editions into an ORDERED candidate list:
 *
 *   1. the chain-verified fold head first (refuse-downgrade, contiguity — the
 *      steady-state answer, and the compaction case too: a re-wrapped head
 *      with a dangling `prev` is still the lowest-anchored walk's top);
 *   2. then EVERY remaining edition, version-DESCENDING (equal versions by
 *      rumor id, the fold's tiebreak winner first) — the candidates a client
 *      may accept when (and only when) a higher-priority candidate fails the
 *      caller's authority gate. "The highest authority-verified head"
 *      (CORD-04 §1) requires gating before choosing, or a forger could
 *      suppress a legit entity with garbage at a higher (or dangling lower)
 *      version.
 *
 * Equal-version fork SIBLINGS are all kept: the tiebreak (lower rumor id) is
 * grindable, so evicting the loser here would let an id-mined fork of the
 * chain tip suppress the real edition before any authority gate ever saw it
 * (an unauthorized banlist fork emptying the banlist, a low-rank grant fork
 * revoking an admin). The tiebreak orders siblings; the gate decides.
 *
 * The caller picks the first candidate that passes its gate and records it in
 * `heads`.
 *
 * `floor` is a TRACKING client's last-accepted head for this entity (from the
 * prior fold's snapshot). When present and the served editions don't link
 * contiguously up to it (a hostile relay withholding the middle of the chain),
 * the fold reports a GAP: a synced client must fail closed and NOT downgrade to
 * the dangling head (CORD-04 §1). We drop every candidate strictly above the
 * floor in that case, so the entity holds at its last-known-good head and
 * refetches. A FRESH joiner (no floor) still accepts the highest head despite a
 * dangling `prev` — that is the legitimate compaction bootstrap.
 *
 * `snapshot` is the subset of editions wrapped under the CURRENT epoch's
 * control group, passed once the community has Refounded at least once. A
 * Refounding compacts every head into the new epoch (CORD-06 §3), so the
 * current epoch is self-contained and readable-but-superseded fragments from
 * older epochs must not outrank it. The snapshot folds by BOOTSTRAP
 * (highest signed version, floor as version-only refuse-downgrade), NEVER the
 * chain walk: behind a compaction, dangling `prev`s are normal, and — since
 * seal signatures survive re-wrap — any group-key holder can re-serve a real
 * OLD edition under the current group. Version anchoring is what bounds that:
 * a re-wrap cannot raise the version inside the signed seal, so a re-served
 * stale edition always loses to the compacted head. Old-epoch editions remain
 * fallback candidates for the authority gate.
 */
function headCandidates(
  editions: ParsedEdition[],
  floor?: EntityHead,
  snapshot?: ParsedEdition[],
  onGap?: () => void,
): ParsedEdition[] {
  const ordered: ParsedEdition[] = [];
  const seenRumors = new Set<string>();
  let gapped = false;

  if (snapshot) {
    // Compaction-era arm. Snapshot presence selects the ARM; version selects
    // the HEAD — over ALL editions, not the subset. Honest paths are identical
    // (the compacted head is ≥ every readable old-epoch edition), but bounding
    // the bootstrap to the subset would let colluding relays serve only a
    // stale re-wrap and outrank a higher true head sitting in our own store.
    const idx = bootstrapHead(editions.map(toFoldEdition), floor?.version ?? 0n);
    if (idx !== null) {
      ordered.push(editions[idx]);
      seenRumors.add(bytesToHex(editions[idx].rumorId));
    } else if (floor !== undefined) {
      // Nothing at/above our floor was served: the head we already accepted
      // vanished from the served set — withheld, fail closed.
      gapped = true;
      onGap?.();
    }
  } else {
    const folds: Edition[] = editions.map(toFoldEdition);
    const result = fold(folds, floor?.version ?? 0n, floor?.hash);

    // Tracking client + a gap: the served chain doesn't reach our floor. Refuse
    // to adopt anything above the floor — a withheld-middle attack can't push a
    // higher dangling edition onto a client that already advanced the chain.
    gapped = floor !== undefined && result.gap;
    if (gapped) onGap?.();

    if (result.head !== null && !gapped) {
      ordered.push(editions[result.head]);
      seenRumors.add(bytesToHex(editions[result.head].rumorId));
    }
  }
  const rest = editions
    .filter((e) => {
      // A compaction re-wrap carries the same rumor — one candidacy per rumor.
      const id = bytesToHex(e.rumorId);
      if (seenRumors.has(id)) return false;
      seenRumors.add(id);
      // Under a gap, suppress every candidate above the floor: only the floor's
      // own version (a re-served head we can still verify against our snapshot)
      // remains admissible, so the entity never downgrades to a dangling head.
      if (gapped && e.version > floor!.version) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.version !== b.version) return a.version > b.version ? -1 : 1;
      return bytesToHex(a.rumorId) < bytesToHex(b.rumorId) ? -1 : 1;
    });
  ordered.push(...rest);
  return ordered;
}

/** Pick the first candidate passing `gate`; record it as the entity's head. */
function pickHead(
  candidates: ParsedEdition[],
  heads: Map<string, EntityHead>,
  headEditions: Map<string, ParsedEdition>,
  gate: (p: ParsedEdition) => boolean,
): ParsedEdition | undefined {
  for (const p of candidates) {
    if (!gate(p)) continue;
    heads.set(bytesToHex(p.entityId), { version: p.version, hash: p.selfHash });
    headEditions.set(bytesToHex(p.entityId), p);
    return p;
  }
  return undefined;
}

/** Order role/grant candidates oldest version first (the admissibility walk). */
function byVersionAsc(a: { parsed: ParsedEdition }, b: { parsed: ParsedEdition }): number {
  return a.parsed.version < b.parsed.version ? -1 : a.parsed.version > b.parsed.version ? 1 : 0;
}

/** Version-ascending groups; equal-version fork siblings share a group. */
function versionGroups<T extends { parsed: ParsedEdition }>(candidates: T[]): T[][] {
  const groups: T[][] = [];
  for (const c of [...candidates].sort(byVersionAsc)) {
    const last = groups[groups.length - 1];
    if (last && last[0].parsed.version === c.parsed.version) last.push(c);
    else groups.push([c]);
  }
  return groups;
}

/**
 * The delegation fixpoint (CORD-04 §2): start with the owner authorized (their
 * rank comes from the community_id, not any fold), then admit role/grant
 * entities whose signer is authorized to make them, repeating until stable.
 * Per entity the ORDERED candidates are tried in turn and the first authorized
 * one settles it, so a forger's garbage edition can't suppress a legit head.
 * Anything whose signer never becomes authorized is dropped (the
 * self-promotion / forged-delegation defense).
 *
 * Editing is ACTING ON A TARGET (CORD-04 §5): besides outranking what an
 * edition hands out, a non-owner signer must strictly outrank what it REPLACES
 * — the standing role position, or the rank a grant's predecessor conferred —
 * or a revoke (empty role_ids) / demotion would be free to anyone. Each
 * entity's candidates are walked version-ascending so the "standing" state is
 * itself an admissible edition, never a forger's plant. Equal-version fork
 * siblings settle to ONE winner per version, highest authority first — the
 * grindable rumor-id tiebreak never lets a lower rank evict its superior's
 * edition.
 *
 * The fold must be a function of the edition SET, never its arrival order:
 * entities are processed in sorted-eid order, and an entity DEFERS while any
 * state its gate reads is still pending — a handed-out role definition, or a
 * candidate author's own rank source (their grant entity). A stalled fixpoint
 * freezes those deferrals one at a time (a still-pending dependency is then
 * provably dead or cyclic), so it always terminates.
 */
function authorizeDelegation(
  roleCandidates: Map<string, Array<{ role: Role; author: string; parsed: ParsedEdition }>>,
  grantCandidates: Map<string, Array<{ grant: MemberGrant; author: string; parsed: ParsedEdition }>>,
  ownerHex: string,
  heads: Map<string, EntityHead>,
  headEditions: Map<string, ParsedEdition>,
): CommunityRoles {
  const roster = emptyRoles();
  const settledRoles = new Set<string>();
  const settledGrants = new Set<string>();
  // Deterministic processing order — never keyed to edition arrival.
  const roleEids = [...roleCandidates.keys()].sort();
  const grantEids = [...grantCandidates.keys()].sort();
  // member → their grant entity: the rank source the author-deferral watches.
  const grantEidOfMember = new Map<string, string>();
  for (const [eid, cands] of grantCandidates) {
    if (cands.length > 0) grantEidOfMember.set(cands[0].grant.member, eid);
  }
  let changed = true;
  // While false, a grant handing out a role that still has unsettled candidates
  // WAITS (that role may yet reach the roster and set the standing rank). Once
  // the fixpoint can settle no more roles, the flag flips: any still-unsettled
  // role is provably dead, so the grants blocked only on dead roles resolve
  // (and drop, since a dead role confers nothing) instead of hanging forever.
  let rolesFrozen = false;
  // While false, an entity with a candidate whose author's own grant entity is
  // unsettled WAITS — the author's rank decides that candidate's admissibility,
  // so settling early would key the roster to edition ARRIVAL order (a real
  // admin's revoke dropped because their grant folded later). Flipped only
  // after a stall with roles already frozen: what's left is dead or a genuine
  // revocation cycle, resolved in sorted-eid order (deterministic either way).
  let ranksFrozen = false;

  const settle = (p: ParsedEdition) => {
    heads.set(bytesToHex(p.entityId), { version: p.version, hash: p.selfHash });
    headEditions.set(bytesToHex(p.entityId), p);
  };

  /** Is a non-owner author's rank still undetermined (their grant entity pending)? */
  const rankPending = (author: string, selfEid?: string): boolean => {
    if (author === ownerHex) return false;
    const aeid = grantEidOfMember.get(author);
    // An entity never waits on itself: a self-grant's only possible rank source
    // is the entity being decided, which is exactly the self-promotion the
    // fixpoint exists to drop.
    return aeid !== undefined && aeid !== selfEid && !settledGrants.has(aeid);
  };

  /**
   * Equal-version fork siblings, highest authority first: the owner, then rank
   * (lower position), then the fold's rumor-id tiebreak. The id is grindable;
   * authority is not — so a fork can only displace an edition its author could
   * have overwritten anyway.
   */
  const authorityFirst = (a: { author: string; parsed: ParsedEdition }, b: { author: string; parsed: ParsedEdition }): number => {
    const rank = (author: string) => (author === ownerHex ? -1 : (highestPosition(roster, author) ?? Number.MAX_SAFE_INTEGER));
    const ra = rank(a.author);
    const rb = rank(b.author);
    if (ra !== rb) return ra - rb;
    const ia = bytesToHex(a.parsed.rumorId);
    const ib = bytesToHex(b.parsed.rumorId);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };

  while (changed) {
    changed = false;

    // Roles: the owner may define any role (position ≥ 1 — the top is not
    // mintable, enforced at parse); a non-owner needs MANAGE_ROLES, must
    // strictly outrank the position they mint, AND must strictly outrank the
    // standing position they replace (no repositioning a role above you).
    for (const eid of roleEids) {
      if (settledRoles.has(eid)) continue;
      const candidates = roleCandidates.get(eid)!;
      if (!ranksFrozen && candidates.some((c) => rankPending(c.author))) continue;
      const admissible = new Set<ParsedEdition>();
      let standing: number | undefined; // the admissible predecessor's position
      for (const group of versionGroups(candidates)) {
        for (const { role, author, parsed } of [...group].sort(authorityFirst)) {
          const mintOk = author === ownerHex || canActOnPosition(roster, author, ownerHex, role.position, Permissions.MANAGE_ROLES);
          const replaceOk = author === ownerHex || standing === undefined || outranks(roster, author, ownerHex, standing);
          if (!mintOk || !replaceOk) continue;
          admissible.add(parsed);
          standing = role.position;
          break; // one winner per version — a fork sibling can't sidestep it
        }
      }
      // The fold's candidate priority (chain-verified head first), gated.
      const pick = candidates.find((c) => admissible.has(c.parsed));
      if (!pick) continue;
      roster.roles.push(pick.role);
      settledRoles.add(eid);
      settle(pick.parsed);
      changed = true;
    }

    // Grants: a non-owner needs MANAGE_ROLES, must strictly outrank every
    // Role handed out, AND must strictly outrank the target's standing rank —
    // a revoke (empty role_ids) or demotion acts ON the member (CORD-04 §5/§6),
    // so it is never free to a lower rank (or to no rank at all).
    //
    // The standing walk reads role POSITIONS and author RANKS, so a grant may
    // only settle once every role its candidates hand out AND every candidate
    // author's own grant entity has stopped being PENDING. Otherwise a
    // predecessor handing out a not-yet-settled role would compute an empty
    // `standing` (a low-rank revoke chained behind it settling vacuously), and
    // a not-yet-ranked author's legitimate revoke would drop as inadmissible —
    // either way the very holes the gate closes, re-opened by fold ORDER.
    for (const eid of grantEids) {
      if (settledGrants.has(eid)) continue;
      const candidates = grantCandidates.get(eid)!;
      // A referenced role is unresolved iff it still has live role candidates
      // that haven't settled; such a grant entity waits for a later pass — but
      // only until roles are frozen (past that, an unsettled role is dead).
      const rolePending = (rid: string) => roleCandidates.has(rid) && !settledRoles.has(rid);
      if (!rolesFrozen && candidates.some((c) => c.grant.roleIds.some(rolePending))) continue;
      if (!ranksFrozen && candidates.some((c) => rankPending(c.author, eid))) continue;

      const admissible = new Set<ParsedEdition>();
      let standing: number | undefined; // the rank the admissible predecessor conferred
      for (const group of versionGroups(candidates)) {
        for (const { grant, author, parsed } of [...group].sort(authorityFirst)) {
          const positions = grant.roleIds
            .map((rid) => roster.roles.find((r) => r.roleId === rid)?.position)
            .filter((p): p is number => p !== undefined);
          const allKnown = positions.length === grant.roleIds.length;
          const ok =
            author === ownerHex ||
            (allKnown &&
              hasPermission(roster, author, Permissions.MANAGE_ROLES) &&
              positions.every((pos) => outranks(roster, author, ownerHex, pos)) &&
              (standing === undefined || outranks(roster, author, ownerHex, standing)));
          if (!ok) continue;
          admissible.add(parsed);
          standing = positions.length ? Math.min(...positions) : undefined;
          break; // one winner per version
        }
      }
      const pick = candidates.find((c) => admissible.has(c.parsed));
      if (!pick) continue;
      roster.grants.push(pick.grant);
      settledGrants.add(eid);
      settle(pick.parsed);
      changed = true;
    }

    // The fixpoint stalled with deferrals still holding entities back: flip
    // one freeze latch (roles first — a rank source may itself be blocked only
    // on a dead role) and let another round resolve them. Each latch only ever
    // moves its gate later and flips once, so termination is preserved.
    if (!changed && !rolesFrozen) {
      rolesFrozen = true;
      changed = true;
    } else if (!changed && !ranksFrozen) {
      ranksFrozen = true;
      changed = true;
    }
  }

  // Deterministic cap: a Community carries at most 100 Roles — fold the 100
  // lowest role_ids and ignore the rest (CORD-04 §2).
  if (roster.roles.length > MAX_ROLES_PER_COMMUNITY) {
    roster.roles.sort((a, b) => (a.roleId < b.roleId ? -1 : a.roleId > b.roleId ? 1 : 0));
    roster.roles = roster.roles.slice(0, MAX_ROLES_PER_COMMUNITY);
  }
  return roster;
}

/** Fold-once memo, keyed on the community + the exact edition set. */
const foldMemo = new Map<string, FoldedControl>();

/**
 * Replay a set of opened control editions into current state. `ownerHex` is
 * the community's proven owner (verified against the id commitment when the
 * membership entry was accepted).
 *
 * Runs in up to two passes: the first fold resolves the Banlist (itself
 * roster-gated), and if any edition was authored by a banned npub the fold
 * re-runs with those editions excluded — a banned npub's authority actions are
 * dropped like every other event of theirs (CORD-04 §4). The first pass's
 * Banlist stays the final word (the owner is never bannable, so the anti-
 * roster can't be used to erase itself).
 */
export function foldControlState(
  editions: ParsedEdition[],
  communityId: Uint8Array,
  ownerHex: string,
  priorHeads?: Map<string, EntityHead>,
  snapshotIds?: Set<string>,
): FoldedControl {
  const cidHex = bytesToHex(communityId);
  const floorSig = priorHeads
    ? [...priorHeads.entries()].map(([k, v]) => `${k}@${v.version}`).sort().join(",")
    : "";
  // snapshotIds is part of the key: attribution can change (a re-wrap arriving)
  // without the edition set changing, and must not serve a stale fold.
  const snapSig = snapshotIds ? [...snapshotIds].sort().join(",") : "";
  const memoKey = `${cidHex}:${ownerHex}:${floorSig}:${snapSig}:${editions.map((e) => e.opened.wrapId).sort().join(",")}`;
  const hit = foldMemo.get(memoKey);
  if (hit) return hit;

  const first = foldOnce(editions, communityId, ownerHex, priorHeads, snapshotIds);
  let result = first;
  const banned = new Set([...first.banned].filter((pk) => pk !== ownerHex));
  if (banned.size > 0 && editions.some((e) => banned.has(e.author))) {
    // Pass 1 stays authoritative for `incomplete`: pass 2 drops banned authors'
    // editions by SEMANTICS (CORD-04 §4), not data loss — a gap it introduces
    // must not read as "plane unserved" and block the ban→refound flow.
    result = {
      ...foldOnce(editions.filter((e) => !banned.has(e.author)), communityId, ownerHex, priorHeads, snapshotIds),
      banned: first.banned,
      bannedAt: first.bannedAt,
      incomplete: first.incomplete,
    };
  }

  // Single-entry-per-community cache so the memo doesn't grow unbounded.
  for (const k of foldMemo.keys()) if (k.startsWith(`${cidHex}:`)) foldMemo.delete(k);
  foldMemo.set(memoKey, result);
  return result;
}

/**
 * The community's Public/Private mode, derived (CORD-05 §5): a non-empty
 * aggregate live-link set means Public. Behavior hangs off this — a ban in a
 * Public community is the Banlist alone (a rotation can't sever someone who
 * can re-fetch the refreshed bundle, and it strands every stale link's future
 * joiners on a dead epoch); only a Private ban Refounds (CORD-06 §3).
 *
 * `excludingCreator` evaluates the mode as if that member's registry were
 * already dropped: the target of an in-flight ban loses their links with
 * their authority, so banning the sole link creator still severs.
 */
export function isCommunityPublic(folded: FoldedControl, excludingCreator?: string): boolean {
  for (const [creator, signers] of folded.registriesByCreator) {
    if (creator === excludingCreator) continue;
    if (signers.length > 0) return true;
  }
  return false;
}

/**
 * Whether any live link belongs to someone OTHER than `viewer` — the links a
 * rotation by `viewer` would strand. The rotation gate, refined: a rotator
 * refreshes their OWN bundles atomically with the rotation (they hold every
 * signer_sk), so their links survive any rotation; only a foreign creator's
 * link goes stale, because nobody else can re-post its bundle. So a client
 * must not rotate while a foreign live link exists, and may rotate freely
 * when every live link is its own — even though the community still reads
 * Public (the CORD-05 §5 flag is unchanged by this).
 *
 * `excludingCreator` drops one more registry from the view — the target of an
 * in-flight ban, whose links die with their authority.
 */
export function hasForeignLiveLinks(folded: FoldedControl, viewer: string, excludingCreator?: string): boolean {
  for (const [creator, signers] of folded.registriesByCreator) {
    if (creator === viewer || creator === excludingCreator) continue;
    if (signers.length > 0) return true;
  }
  return false;
}

function foldOnce(
  editions: ParsedEdition[],
  communityId: Uint8Array,
  ownerHex: string,
  priorHeads?: Map<string, EntityHead>,
  snapshotIds?: Set<string>,
): FoldedControl {
  const cidHex = bytesToHex(communityId);

  // 1. Group by (vsk, entity).
  const byVsk = new Map<string, Map<string, ParsedEdition[]>>();
  for (const p of editions) {
    let m = byVsk.get(p.vsk);
    if (!m) byVsk.set(p.vsk, (m = new Map()));
    pushEdition(m, bytesToHex(p.entityId), p);
  }

  const heads = new Map<string, EntityHead>();
  const headEditions = new Map<string, ParsedEdition>();
  const gapHeld = new Set<string>();
  /** Ordered head candidates per entity of one vsk (floored per prior head). */
  const candidatesOf = (vsk: string): Map<string, ParsedEdition[]> => {
    const out = new Map<string, ParsedEdition[]>();
    for (const [eid, list] of byVsk.get(vsk) ?? new Map<string, ParsedEdition[]>()) {
      // Current-epoch subset: when any edition of this entity arrived under
      // the current control group, the chain walk anchors there (see
      // headCandidates) — an entity never re-wrapped keeps full-set semantics.
      const snap = snapshotIds ? list.filter((p: ParsedEdition) => snapshotIds.has(bytesToHex(p.rumorId))) : [];
      out.set(
        eid,
        headCandidates(list, priorHeads?.get(eid), snap.length > 0 ? snap : undefined, () => gapHeld.add(eid)),
      );
    }
    return out;
  };

  // 2. Roster (owner-rooted fixpoint) — resolved before any gated entity.
  const roleCandidates = new Map<string, Array<{ role: Role; author: string; parsed: ParsedEdition }>>();
  for (const [eid, candidates] of candidatesOf(VSK_ROLE)) {
    const parsed = candidates
      .map((p) => ({ role: roleFromJSON(p.content), author: p.author, parsed: p }))
      // The entity coordinate must be the role's own id (anti-spoofing).
      .filter((c): c is { role: Role; author: string; parsed: ParsedEdition } =>
        Boolean(c.role && bytesToHex(hex32(c.role.roleId)) === eid),
      );
    if (parsed.length > 0) roleCandidates.set(eid, parsed);
  }
  const grantCandidates = new Map<string, Array<{ grant: MemberGrant; author: string; parsed: ParsedEdition }>>();
  for (const [eid, candidates] of candidatesOf(VSK_GRANT)) {
    const parsed = candidates
      .map((p) => ({ grant: grantFromJSON(p.content), author: p.author, parsed: p }))
      // The coordinate must be the member's grant locator (anti-spoofing).
      .filter((c): c is { grant: MemberGrant; author: string; parsed: ParsedEdition } =>
        Boolean(c.grant && bytesToHex(grantLocator(communityId, hex32(c.grant.member))) === eid),
      );
    if (parsed.length > 0) grantCandidates.set(eid, parsed);
  }
  const roster = authorizeDelegation(roleCandidates, grantCandidates, ownerHex, heads, headEditions);

  // The `vac` authority-citation check (CORD-04 §5). A non-owner authority
  // action MUST cite the exact Grant it acts under, pinned by (eid, version,
  // hash). A verifier honors it only once it holds that Grant at ≥ the cited
  // version with a MATCHING hash — otherwise the action "parks" (is dropped
  // this fold) rather than being honored on the strength of some other grant.
  // This closes the forged-citation and never-resolves-citation holes: without
  // it the fold ignored `p.authority` entirely and honored any gated action
  // whose author currently resolves as authorized.
  //
  // Index every grant edition the fold saw as eid → version → {selfHash}. The
  // owner needs no citation (supreme); a citation resolves iff some seen grant
  // edition at the cited eid+version has the cited hash.
  const grantEditionIndex = new Map<string, Map<string, Set<string>>>();
  for (const [eid, cands] of grantCandidates) {
    const byVer = new Map<string, Set<string>>();
    for (const c of cands) {
      const v = c.parsed.version.toString();
      let s = byVer.get(v);
      if (!s) byVer.set(v, (s = new Set()));
      s.add(bytesToHex(c.parsed.selfHash));
    }
    grantEditionIndex.set(eid, byVer);
  }
  const citationOk = (p: ParsedEdition): boolean => {
    if (p.author === ownerHex) return true; // supreme: no citation required
    const vac = p.authority;
    if (!vac) return false; // a non-owner action MUST cite its grant
    // The citation must name the actor's OWN grant coordinate.
    const expectedEid = bytesToHex(grantLocator(communityId, hex32(p.author)));
    if (bytesToHex(vac.entityId) !== expectedEid) return false;
    // The cited (version, hash) must match a grant edition we actually hold.
    const hashes = grantEditionIndex.get(expectedEid)?.get(vac.version.toString());
    return hashes !== undefined && hashes.has(bytesToHex(vac.editionHash));
  };

  // 3. Metadata (vsk 0): must be the community's own entity + an authorized actor.
  let metadata: CommunityMetadata | undefined;
  {
    const candidates = candidatesOf(VSK_METADATA).get(cidHex) ?? [];
    const head = pickHead(candidates, heads, headEditions, (p) => {
      if (!isAuthorized(roster, p.author, ownerHex, Permissions.MANAGE_METADATA)) return false;
      if (!citationOk(p)) return false;
      try {
        const parsed = JSON.parse(p.content) as CommunityMetadata;
        // The protocol caps are read-side rules too (CORD-02 §6): an oversize
        // name/description is malformed, not merely impolite.
        if (typeof parsed.name !== "string" || utf8Len(parsed.name) > NAME_MAX_BYTES) return false;
        if (parsed.description !== undefined && (typeof parsed.description !== "string" || utf8Len(parsed.description) > DESCRIPTION_MAX_BYTES)) return false;
        return true;
      } catch {
        return false;
      }
    });
    if (head) {
      const parsed = JSON.parse(head.content) as CommunityMetadata;
      metadata = {
        ...parsed,
        relays: capRelays(Array.isArray(parsed.relays) ? parsed.relays : []),
        icon: isImagePointer(parsed.icon) ? parsed.icon : undefined,
        banner: isImagePointer(parsed.banner) ? parsed.banner : undefined,
      };
    }
  }

  // 4. Channels (vsk 2), each gated by MANAGE_CHANNELS.
  const channels = new Map<string, FoldedChannel>();
  for (const [eid, candidates] of candidatesOf(VSK_CHANNEL)) {
    const head = pickHead(candidates, heads, headEditions, (p) => {
      if (!isAuthorized(roster, p.author, ownerHex, Permissions.MANAGE_CHANNELS)) return false;
      if (!citationOk(p)) return false;
      try {
        const meta = JSON.parse(p.content) as ChannelMetadata;
        return typeof meta.name === "string" && meta.name.length > 0 && utf8Len(meta.name) <= NAME_MAX_BYTES;
      } catch {
        return false;
      }
    });
    if (!head) continue;
    const meta = JSON.parse(head.content) as ChannelMetadata;
    channels.set(eid, {
      channelIdHex: eid,
      name: meta.name,
      isPrivate: meta.private === true,
      deleted: meta.deleted === true,
    });
  }

  // 5. Banlist (vsk 4): the one anti-roster; unauthorized head → empty (fail closed).
  const banned = new Set<string>();
  const bannedAt = new Map<string, number>();
  {
    const eid = bytesToHex(banlistLocator(communityId));
    const candidates = candidatesOf(VSK_BANLIST).get(eid) ?? [];
    const banlistGate = (p: ParsedEdition): boolean => {
      if (!isAuthorized(roster, p.author, ownerHex, Permissions.BAN)) return false;
      if (!citationOk(p)) return false;
      try {
        return Array.isArray(JSON.parse(p.content));
      } catch {
        return false;
      }
    };
    const head = pickHead(candidates, heads, headEditions, banlistGate);
    if (head) {
      for (const pk of JSON.parse(head.content) as unknown[]) {
        if (typeof pk === "string" && /^[0-9a-f]{64}$/i.test(pk)) banned.add(pk.toLowerCase());
      }
    }
    // Ban history (for phantom-member suppression, see FoldedControl.bannedAt):
    // the newest AUTHORIZED edition that named each npub. Same gate as the head,
    // so a forged banlist can't backdate-suppress a legit member. `createdAt` is
    // seconds. Editions span every held epoch, so the history is as complete as
    // the reader's key set — which, by the compaction correlation, is exactly
    // whenever they also hold the stale Join that would otherwise phantom.
    for (const p of candidates) {
      if (!banlistGate(p)) continue;
      let list: unknown;
      try {
        list = JSON.parse(p.content);
      } catch {
        continue;
      }
      if (!Array.isArray(list)) continue;
      for (const pk of list) {
        if (typeof pk !== "string" || !/^[0-9a-f]{64}$/i.test(pk)) continue;
        const k = pk.toLowerCase();
        // The owner is never bannable (parity with foldControlState's `banned`
        // filter): an authorized moderator listing the owner must not durably
        // suppress them from the roster past the unban.
        if (k === ownerHex) continue;
        const prev = bannedAt.get(k);
        if (prev === undefined || p.createdAt > prev) bannedAt.set(k, p.createdAt);
      }
    }
  }

  // 6. Invite registries (vsk 8): each creator owns exactly their own list
  // (the coordinate binds to the author), honored only while its author holds
  // CREATE_INVITE. The aggregate active set is the Public/Private source of
  // truth (CORD-05 §5).
  const liveInviteLinks = new Set<string>();
  const registriesByCreator = new Map<string, string[]>();
  for (const [eid, candidates] of candidatesOf(VSK_INVITE_REGISTRY)) {
    const head = pickHead(candidates, heads, headEditions, (p) => {
      if (bytesToHex(inviteLinksLocator(communityId, hex32(p.author))) !== eid) return false;
      if (!isAuthorized(roster, p.author, ownerHex, Permissions.CREATE_INVITE)) return false;
      if (!citationOk(p)) return false;
      try {
        return Array.isArray(JSON.parse(p.content));
      } catch {
        return false;
      }
    });
    if (!head) continue;
    const list = (JSON.parse(head.content) as unknown[]).filter(
      (s): s is string => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s),
    );
    registriesByCreator.set(head.author, list);
    for (const pk of list) liveInviteLinks.add(pk.toLowerCase());
  }

  // Data-availability roll-up: gap-held entities, plus floored entities with
  // ZERO served editions this fold. A floored entity whose editions were
  // served but authority-rejected is NOT flagged — that's a deliberate drop
  // (a stripped role, a banned creator's registry, CORD-04 §4), and flagging
  // it would false-abort the very ban→refound flow the gate protects.
  const servedEids = new Set<string>();
  for (const m of byVsk.values()) for (const eid of m.keys()) servedEids.add(eid);
  const incomplete = [...gapHeld];
  for (const eid of priorHeads?.keys() ?? []) {
    if (!servedEids.has(eid) && !gapHeld.has(eid)) incomplete.push(eid);
  }

  const result: FoldedControl = { roster, ownerHex, metadata, channels, banned, bannedAt, liveInviteLinks, registriesByCreator, heads, headEditions, incomplete };
  return result;
}

// ── Dissolution (CORD-02 §9) ─────────────────────────────────────────────────

const ZERO32_HEX = "0".repeat(64);

/**
 * Build the owner-dissolution tombstone rumor: chainless (no ev/ep/vac),
 * eid = 0…0, empty content. Published at `dissolved_pk` — a coordinate derived
 * from the community_id alone, so every member past or present resolves it.
 */
export function buildDissolvedRumor(ownerPubkey: string, createdAtSecs?: number): Rumor {
  return buildRumor({
    kind: 3308,
    content: "",
    tags: [
      ["vsk", VSK_DISSOLVED],
      ["eid", ZERO32_HEX],
    ],
    pubkey: ownerPubkey,
    ms: null,
    createdAtSecs,
  });
}

/** Sign + wrap the dissolution tombstone at the community's dissolved address. */
export async function sealDissolved(communityId: Uint8Array, ownerPubkey: string, signer: StreamSigner): Promise<NostrEvent> {
  const group = dissolvedGroupKey(communityId);
  const rumor = buildDissolvedRumor(ownerPubkey);
  const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, group, signer);
  return wrapSeal(seal, group);
}

/**
 * Whether any of `wraps` is a valid owner-signed dissolution tombstone for
 * this community. Only the owner's signature counts; an impostor's event at
 * the (findable-by-anyone) address is noise. Terminal: on sight, the client
 * seals the community read-only.
 */
export function isDissolved(wraps: NostrEvent[], communityId: Uint8Array, ownerHex: string): boolean {
  const group = dissolvedGroupKey(communityId);
  for (const wrap of wraps) {
    let opened: OpenedEvent;
    try {
      opened = openWrap(wrap, group);
    } catch {
      continue;
    }
    if (isDissolvedOpened(opened, ownerHex)) return true;
  }
  return false;
}

/** Whether an already-opened dissolved-address event is a valid owner tombstone. */
export function isDissolvedOpened(opened: OpenedEvent, ownerHex: string): boolean {
  if (opened.author !== ownerHex) return false;
  if (opened.sealKind !== KIND_SEAL_PLAINTEXT) return false; // control-family seals are plaintext (CORD-02 §5)
  const vsk = opened.tags.find((t) => t[0] === "vsk")?.[1];
  const eid = opened.tags.find((t) => t[0] === "eid")?.[1];
  return opened.kind === 3308 && vsk === VSK_DISSOLVED && eid === ZERO32_HEX;
}
