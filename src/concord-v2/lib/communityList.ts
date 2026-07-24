/**
 * Concord V2 Community List — CORD-02 §8.
 *
 * A member's memberships sync across devices (and clients) as one kind-13302
 * replaceable event, NIP-44-encrypted to self. Every Community they're in AND
 * every one they've left lives in the document — liveness is DERIVED, never
 * deletion, or merges would depend on gossip order.
 *
 * Per entry, two snapshots solve opposite problems: `seed` holds the EARLIEST
 * epoch ever held (the full-history backfill anchor, only ever moves backward
 * on merge) and `current` the LATEST (instant reconstruction on a fresh
 * device). Tombstones are permanent; the newest of `added_at`/`removed_at`
 * decides liveness, so a re-join legitimately resurrects while a backfill can
 * never re-add a tombstoned id.
 */

import { bytesToHex, hex32, verifyCommunityId } from "@/concord-v2/lib/derive";
import {
  MAX_LIST_MEMBERSHIPS,
  capRelays,
  type CommunityV2,
  type HeldRoot,
  type PrivateChannelKey,
} from "@/concord-v2/lib/types";

/**
 * Join material — the invite bundle's MEMBERSHIP subset (never the icon, never
 * the link fields). Snake_case wire shape; unknown fields are preserved
 * (round-trip discipline, CORD-02 §6). The `held_roots` field is an Armada
 * extension carrying retained prior root epochs so history spanning a
 * Refounding stays readable without a rekey-chain walk.
 */
export interface JoinMaterial {
  community_id: string;
  owner: string;
  owner_salt: string;
  community_root: string;
  root_epoch: number;
  /** The PRIVATE channels held (public ones derive from the root — CORD-03). */
  channels: Array<{ id: string; key: string; epoch: number; name: string }>;
  relays: string[];
  name: string;
  /** Armada extension: retained prior roots `[{epoch, key}]` (current excluded). */
  held_roots?: Array<{ epoch: number; key: string }>;
  /** Armada extension: the npub whose Refounding minted `root_epoch`. */
  refounder?: string;
  [k: string]: unknown;
}

export interface CommunityListEntry {
  community_id: string;
  /** Earliest epoch held — only ever moves BACKWARD on merge. */
  seed: JoinMaterial;
  /** Freshest snapshot — replaced on every Refounding or rename. */
  current: JoinMaterial;
  /** ms; tiebreaks against a tombstone. */
  added_at: number;
  /**
   * The Refounding epoch that EXCLUDED me (a kick/ban rekey that carried no
   * blob for me). Being excluded is NOT leaving: the entry stays LIVE and on
   * the rail, but read-only — my keys can't decrypt this epoch. Cleared
   * automatically when `current.root_epoch` advances past it (a later
   * Refounding re-included me), so re-inclusion needs no explicit reset.
   * Only the user's own Leave or the owner's Dissolve ever removes an icon.
   */
  excluded_at_epoch?: number;
  /**
   * Armada extension: the invite link this membership was joined through, in
   * the domain-agnostic bare form `<naddr>#<fragment>` (CORD-05 §2/§3). The
   * link's coordinate is stable and its bundle refreshes in place, so a member
   * STRANDED on a superseded epoch (a stale bundle dropped them onto history —
   * see useRekeyWatch2) can re-resolve this same link and merge the refreshed,
   * higher-epoch bundle forward. Self-encrypted like the rest of the list, so
   * carrying the secret fragment here leaks nothing new (the list already
   * holds `community_root`). Absent for direct-invite and creator entries.
   */
  invite_ref?: string;
  [k: string]: unknown;
}

export interface CommunityTombstone {
  community_id: string;
  /** ms. Permanent — pruning would let a long-offline device resurrect a leave. */
  removed_at: number;
  [k: string]: unknown;
}

export interface CommunityList {
  entries: CommunityListEntry[];
  tombstones: CommunityTombstone[];
  [k: string]: unknown;
}

export const EMPTY_COMMUNITY_LIST: CommunityList = { entries: [], tombstones: [] };

// ── Canonical JSON (the total-order tiebreak) ────────────────────────────────

/** JSON with recursively-sorted object keys — a total order for equal-epoch merges. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// ── Merge (deterministic, commutative, idempotent) ───────────────────────────

/** Higher epoch wins; tie → lexicographically lowest canonical bytes (CORD-02 §8). */
function freshest(a: JoinMaterial, b: JoinMaterial): JoinMaterial {
  if (a.root_epoch !== b.root_epoch) return a.root_epoch > b.root_epoch ? a : b;
  return canonicalJson(a) <= canonicalJson(b) ? a : b;
}

/** Lower epoch wins; tie → lowest canonical bytes. */
function earliest(a: JoinMaterial, b: JoinMaterial): JoinMaterial {
  if (a.root_epoch !== b.root_epoch) return a.root_epoch < b.root_epoch ? a : b;
  return canonicalJson(a) <= canonicalJson(b) ? a : b;
}

function mergeEntry(x: CommunityListEntry, y: CommunityListEntry): CommunityListEntry {
  const current = freshest(x.current, y.current);
  // The higher exclusion epoch wins the merge, but an exclusion only bites
  // while it names an epoch BEYOND what `current` holds: holding the marked
  // epoch's own root is re-inclusion (a later Refounding or a fresh invite
  // for exactly that epoch), so a spent marker is dropped.
  const excludedAt = maxDefined(x.excluded_at_epoch, y.excluded_at_epoch);
  const merged: CommunityListEntry = {
    ...x,
    ...y,
    community_id: x.community_id,
    current,
    seed: earliest(x.seed, y.seed),
    // The newest add wins liveness races against a tombstone, so keep the max.
    added_at: Math.max(x.added_at, y.added_at),
  };
  if (excludedAt !== undefined && excludedAt > current.root_epoch) {
    merged.excluded_at_epoch = excludedAt;
  } else {
    delete merged.excluded_at_epoch;
  }
  return merged;
}

/** The larger of two optional numbers, or undefined if neither is set. */
function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/**
 * Deterministically merge two Community Lists. Entries and tombstones both
 * stay in the document; nothing is deleted (liveness is derived).
 */
export function mergeCommunityLists(a: CommunityList, b: CommunityList): CommunityList {
  const entries = new Map<string, CommunityListEntry>();
  for (const e of [...a.entries, ...b.entries]) {
    if (!e || typeof e.community_id !== "string") continue;
    const prev = entries.get(e.community_id);
    entries.set(e.community_id, prev ? mergeEntry(prev, e) : e);
  }
  const tombstones = new Map<string, CommunityTombstone>();
  for (const t of [...a.tombstones, ...b.tombstones]) {
    if (!t || typeof t.community_id !== "string") continue;
    const prev = tombstones.get(t.community_id);
    if (!prev || t.removed_at > prev.removed_at) tombstones.set(t.community_id, t);
  }
  return {
    ...a,
    ...b,
    entries: [...entries.values()].sort((x, y) => x.community_id.localeCompare(y.community_id)),
    tombstones: [...tombstones.values()].sort((x, y) => x.community_id.localeCompare(y.community_id)),
  };
}

/** Whether an entry is live: no tombstone, or the add is newer than the removal. */
export function isLive(list: CommunityList, communityId: string): boolean {
  const entry = list.entries.find((e) => e.community_id === communityId);
  if (!entry) return false;
  const tomb = list.tombstones.find((t) => t.community_id === communityId);
  return !tomb || entry.added_at > tomb.removed_at;
}

/** The live entries (memberships), derived. */
export function liveEntries(list: CommunityList): CommunityListEntry[] {
  return list.entries.filter((e) => isLive(list, e.community_id));
}

/**
 * Whether the member has been EXCLUDED at their current epoch — a kick/ban
 * Refounding they got no key for. The community stays live and on the rail
 * (only Leave/Dissolve remove an icon), but it renders read-only: the member
 * can't decrypt this epoch.
 *
 * The marker names the epoch minted WITHOUT them, so exclusion holds only
 * while that epoch is beyond what they hold — strictly greater. Holding the
 * marked epoch's own root IS re-inclusion, however it arrived: a later
 * Refounding that re-included them, or a fresh invite handing them exactly
 * the epoch they were cut from (an unban + re-invite lands there).
 */
export function isExcluded(entry: CommunityListEntry): boolean {
  return (
    typeof entry.excluded_at_epoch === "number" &&
    entry.excluded_at_epoch > entry.current.root_epoch
  );
}

/** Add/refresh a membership. Pure. */
export function addToList(list: CommunityList, entry: CommunityListEntry): CommunityList {
  return mergeCommunityLists(list, { entries: [entry], tombstones: [] });
}

/** Tombstone a membership (leave/removed). Pure. */
export function removeFromList(list: CommunityList, communityId: string, removedAt: number): CommunityList {
  return mergeCommunityLists(list, { entries: [], tombstones: [{ community_id: communityId, removed_at: removedAt }] });
}

/**
 * Mark a membership EXCLUDED at `epoch` (a kick/ban Refounding I got no blob
 * for). Unlike {@link removeFromList}, this NEVER hides the icon: being kicked
 * is not the same as leaving. The entry stays live and read-only until either
 * a later Refounding re-includes me (auto-clearing the marker) or I choose to
 * leave. Idempotent — a lower/equal epoch never lowers the marker. Pure.
 */
export function markExcluded(list: CommunityList, communityId: string, epoch: number): CommunityList {
  const idx = list.entries.findIndex((e) => e.community_id === communityId);
  if (idx === -1) return list;
  const entries = list.entries.map((e, i) => {
    if (i !== idx) return e;
    // Only bite while >= current epoch; a stale marker below `current` is moot.
    if (epoch < e.current.root_epoch) return e;
    const prior = typeof e.excluded_at_epoch === "number" ? e.excluded_at_epoch : -Infinity;
    return { ...e, excluded_at_epoch: Math.max(prior, epoch) };
  });
  return { ...list, entries };
}

/**
 * Replace a membership's `current` snapshot in place (an authoritative local
 * refresh — e.g. a caught-up Refounding or rename). Bypasses the epoch-keyed
 * `freshest` so a same-epoch update can't silently lose the canonical-bytes
 * tiebreak.
 *
 * Also bumps `added_at` to now: adopting a fresh epoch key is PROOF of current
 * membership, so it must win liveness over any earlier removal tombstone —
 * exactly as a re-join does. Without this, a member excluded in one Refounding
 * (tombstoned) and RE-INCLUDED in a later one keeps their original `added_at`,
 * which stays below `removed_at`, so `isLive` judges the still-valid membership
 * dead and the community silently vanishes from the rail forever. Pure.
 */
export function refreshCurrent(list: CommunityList, current: JoinMaterial, addedAt = Date.now()): CommunityList {
  const idx = list.entries.findIndex((e) => e.community_id === current.community_id);
  if (idx === -1) return list;
  const entries = list.entries.map((e, i) => {
    if (i !== idx) return e;
    const next: CommunityListEntry = { ...e, current, added_at: Math.max(e.added_at, addedAt) };
    // Adopting the marked epoch's key (or any later one) is re-inclusion:
    // drop the spent exclusion marker.
    if (typeof next.excluded_at_epoch === "number" && next.excluded_at_epoch <= current.root_epoch) {
      delete next.excluded_at_epoch;
    }
    return next;
  });
  return { ...list, entries };
}

/**
 * Replace a membership's private-channel set inside `current` — a
 * channel-scope rekey adoption (fresh key at the next channel epoch) or a
 * channel exclusion (the channel dropped so it visibly disappears, CORD-06
 * §2). Unlike {@link refreshCurrent} this NEVER bumps `added_at`: a channel
 * rotation says nothing about community-level membership, and `added_at`
 * feeds the base exclusion-vs-history decision.
 *
 * Merge caveat (CORD-02 §8): `current` snapshots at the same `root_epoch`
 * tie-break on canonical bytes, so a same-root-epoch channel bump can lose a
 * merge to a stale sibling until the watcher re-adopts — deterministic either
 * way, and the rekey events stay fetchable. An excluded channel's original
 * key survives in `seed` for history. Pure.
 */
export function refreshChannels(
  list: CommunityList,
  communityId: string,
  channels: JoinMaterial["channels"],
): CommunityList {
  const idx = list.entries.findIndex((e) => e.community_id === communityId);
  if (idx === -1) return list;
  const entries = list.entries.map((e, i) => (i === idx ? { ...e, current: { ...e.current, channels } } : e));
  return { ...list, entries };
}

/**
 * Replace a membership's relay set inside `current` — following a Metadata
 * fold whose relay list changed (CORD-02 §6: "clients follow the fold"). The
 * list's copy is bootstrap material for a fresh device; the fold stays the
 * authority, so every device re-derives and re-applies this from its own fold.
 * Like {@link refreshChannels}, NEVER bumps `added_at` (a relay change says
 * nothing about membership) and shares the same same-root-epoch merge caveat:
 * a stale sibling can win the canonical-bytes tiebreak until the watcher
 * re-adopts. `seed` is untouched — it only ever moves backward. Pure.
 */
export function refreshRelays(list: CommunityList, communityId: string, relays: string[]): CommunityList {
  const idx = list.entries.findIndex((e) => e.community_id === communityId);
  if (idx === -1) return list;
  const entries = list.entries.map((e, i) => (i === idx ? { ...e, current: { ...e.current, relays } } : e));
  return { ...list, entries };
}

/**
 * Enforce the membership cap: the count bounds the common case, the NIP-44
 * byte cap is the law — the caller must ALSO verify the serialized list fits
 * before publishing (CORD-02 §8).
 */
export function assertListBounds(list: CommunityList): void {
  if (liveEntries(list).length > MAX_LIST_MEMBERSHIPS) {
    throw new Error(`the Community List caps at ${MAX_LIST_MEMBERSHIPS} memberships`);
  }
}

// ── Join material ⇄ runtime community ───────────────────────────────────────

/**
 * Rehydrate a runtime {@link CommunityV2} from an entry. Verifies the
 * self-certifying owner commitment (a corrupted entry fails closed).
 *
 * `extraRelays` is unioned into the runtime relay set (community-first) — but
 * note that V2 plane traffic belongs ONLY on the community's own relays:
 * callers must NOT pass the deployment's app/platform relays here. A relay
 * that stores no Concord wraps answers every plane REQ instantly with an empty
 * EOSE, which can win the backfill's page race and starve the real relays
 * (issue #19).
 */
export function rehydrateCommunity(entry: CommunityListEntry, extraRelays: string[] = []): CommunityV2 | undefined {
  const jm = entry.current;
  try {
    if (!verifyCommunityId(jm.community_id, jm.owner, jm.owner_salt)) return undefined;
    const id = hex32(jm.community_id);
    const root = hex32(jm.community_root);
    const rootEpoch = BigInt(jm.root_epoch);

    const heldRoots: HeldRoot[] = [{ epoch: rootEpoch, key: root }];
    for (const hr of jm.held_roots ?? []) {
      try {
        const epoch = BigInt(hr.epoch);
        if (epoch === rootEpoch) continue;
        heldRoots.push({ epoch, key: hex32(hr.key) });
      } catch {
        // skip malformed retained roots
      }
    }
    // Also anchor the seed's root when it's an epoch we don't otherwise hold.
    if (entry.seed && entry.seed.community_root && entry.seed.root_epoch !== jm.root_epoch) {
      try {
        const seedEpoch = BigInt(entry.seed.root_epoch);
        if (!heldRoots.some((r) => r.epoch === seedEpoch)) {
          heldRoots.push({ epoch: seedEpoch, key: hex32(entry.seed.community_root) });
        }
      } catch {
        // skip malformed seed
      }
    }
    heldRoots.sort((a, b) => (a.epoch > b.epoch ? -1 : a.epoch < b.epoch ? 1 : 0));

    const privateChannels: PrivateChannelKey[] = [];
    for (const ch of Array.isArray(jm.channels) ? jm.channels : []) {
      try {
        privateChannels.push({
          id: hex32(ch.id),
          key: hex32(ch.key),
          epoch: BigInt(ch.epoch),
          name: typeof ch.name === "string" ? ch.name : "",
        });
      } catch {
        // skip malformed channel entries
      }
    }

    return {
      id,
      idHex: jm.community_id.toLowerCase(),
      owner: jm.owner.toLowerCase(),
      ownerSalt: hex32(jm.owner_salt),
      root,
      rootEpoch,
      heldRoots,
      privateChannels,
      relays: capRelays([...(Array.isArray(jm.relays) ? jm.relays : []), ...extraRelays]),
      name: typeof jm.name === "string" ? jm.name : "",
      refounder: typeof jm.refounder === "string" && /^[0-9a-f]{64}$/i.test(jm.refounder) ? jm.refounder.toLowerCase() : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Snapshot a runtime community back into join material (for `current`). */
export function toJoinMaterial(c: CommunityV2, opts?: { relays?: string[]; prior?: JoinMaterial }): JoinMaterial {
  const heldRoots = c.heldRoots
    .filter((r) => r.epoch !== c.rootEpoch)
    .map((r) => ({ epoch: Number(r.epoch), key: bytesToHex(r.key) }));
  return {
    // Round-trip unknown fields from the prior snapshot (CORD-02 §6/§8).
    ...(opts?.prior ?? {}),
    community_id: c.idHex,
    owner: c.owner,
    owner_salt: bytesToHex(c.ownerSalt),
    community_root: bytesToHex(c.root),
    root_epoch: Number(c.rootEpoch),
    channels: c.privateChannels.map((ch) => ({
      id: bytesToHex(ch.id),
      key: bytesToHex(ch.key),
      epoch: Number(ch.epoch),
      name: ch.name,
    })),
    relays: opts?.relays ?? (opts?.prior?.relays as string[] | undefined) ?? [],
    name: c.name,
    ...(heldRoots.length > 0 ? { held_roots: heldRoots } : {}),
    ...(c.refounder ? { refounder: c.refounder } : {}),
  };
}
