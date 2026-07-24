import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useCommunityEntry2, useUpdateCommunityList2 } from "@/concord-v2/hooks/useCommunityList2";
import { useControlFold2, useDissolved2 } from "@/concord-v2/hooks/useControlPlane2";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toJoinMaterial } from "@/concord-v2/lib/communityList";
import { controlGroups, currentControlGroup, foldControlState, openControlEditions } from "@/concord-v2/lib/control";
import { controlSweepTruncated, sweepControl } from "@/concord-v2/lib/planeSync";
import { channelRekeyGroupKey, controlGroupKey, guestbookGroupKey } from "@/concord-v2/lib/derive";
import {
  baseRekeyGroupKey,
  bytesToHex,
  epochKeyCommitment,
  random32,
} from "@/concord-v2/lib/derive";
import { buildSnapshotRumors, sealGuestbook } from "@/concord-v2/lib/guestbook";
import { KIND_SEAL_ENCRYPTED, KIND_WRAP } from "@/concord-v2/lib/kinds";
import {
  base64ToBytes,
  buildRekeyRumors,
  bytesToBase64,
  checkContinuity,
  decodeWrappedKey,
  encodeWrappedKey,
  findBlob,
  groupRotations,
  lowerKeyWins,
  myLocator,
  parseRekey,
  rekeyScopeId,
  rotationExcludesMe,
  rotationPublishedAtMs,
  type ParsedRekey,
  type RekeyBlob,
} from "@/concord-v2/lib/rekey";
import { hasPermission, Permissions } from "@/concord-v2/lib/roles";
import { queryByStreams, readStreamCursor, updateStreamCursor, writeOpened } from "@/concord-v2/lib/rumorStore";
import { openWrap, rewrapSeal, sealRumor, wrapSeal, type OpenedEvent } from "@/concord-v2/lib/stream";
import { buildRefreshedBundleEvents, type InviteBundle } from "@/concord-v2/lib/invite";
import { fetchInviteList } from "@/concord-v2/hooks/useInvites2";
import { toast } from "@/hooks/useToast";
import type { CommunityMetadata, CommunityV2, HeldRoot, PrivateChannelKey } from "@/concord-v2/lib/types";

import type { NostrEvent } from "@nostrify/nostrify";
import type { NUser } from "@nostrify/react/login";

const ZERO_SCOPE = new Uint8Array(32);

/**
 * Re-post this user's live invite bundles for `rotated` at the community's
 * CURRENT keys (CORD-05 §2). `rotated` carries the new `root`/`rootEpoch`; the
 * creator's Invite List (kind 13303, §4) supplies each live link's `token` +
 * `signer_sk` — so a creator refreshes exactly the links they minted, whether
 * they are the Refounder or a member adopting someone else's rotation. The
 * merged list's tombstones exclude revoked links terminally, so a
 * Public→Private conversion never resurrects one. Best-effort: any failure is
 * swallowed by the caller (an unrefreshed link only delays a joiner's
 * catch-up, never breaks a rotation). Exported for tests.
 */
export async function refreshInviteBundlesFor(
  nostr: ReturnType<typeof useNostr>["nostr"],
  user: NUser,
  rotated: Pick<CommunityV2, "id" | "idHex" | "owner" | "ownerSalt" | "root" | "rootEpoch" | "privateChannels" | "relays" | "name">,
  metadata: Pick<CommunityMetadata, "name" | "icon"> | undefined,
  // Fan-out override for a relay-list change: the refreshed bundle (which
  // VENDS `rotated.relays`) must also overwrite the copy on the OLD relays —
  // that's where existing links' fragment hints send fetchers.
  publishRelays?: string[],
): Promise<void> {
  if (!user.signer.nip44) return;
  const { list } = await fetchInviteList(nostr, user);
  const live = list.entries.filter((e) => e.community_id === rotated.idHex);
  if (live.length === 0) return;

  const bundle: InviteBundle = {
    community_id: rotated.idHex,
    owner: rotated.owner,
    owner_salt: bytesToHex(rotated.ownerSalt),
    community_root: bytesToHex(rotated.root),
    root_epoch: Number(rotated.rootEpoch),
    channels: rotated.privateChannels.map((ch) => ({
      id: bytesToHex(ch.id),
      key: bytesToHex(ch.key),
      epoch: Number(ch.epoch),
      name: ch.name,
    })),
    relays: rotated.relays,
    name: metadata?.name ?? rotated.name,
    ...(metadata?.icon ? { icon: metadata.icon } : {}),
    creator_npub: user.pubkey,
  };

  const targets = publishRelays ?? rotated.relays;
  for (const bundleEvent of buildRefreshedBundleEvents(bundle, live)) {
    await Promise.allSettled(
      targets.map((url) => nostr.relay(url).event(bundleEvent, { signal: AbortSignal.timeout(8000) })),
    );
  }
}

/**
 * Watch the NEXT epoch's base-rekey address (CORD-06 §2) and react:
 *
 *   - a complete, authorized, continuity-checked rotation carrying MY blob →
 *     adopt the new root (retaining the prior for history) and record the
 *     refounder as the new epoch's snapshot authority;
 *   - a complete rotation with NO blob for me across ALL chunks, published
 *     at/after I joined → I've been excluded (kicked/banned): the membership is
 *     marked read-only at that epoch but STAYS on the rail. Only the user's own
 *     Leave or the owner's Dissolve ever removes an icon. A missing chunk is
 *     never an exclusion — the watcher just keeps refetching. Neither is a
 *     complete rotation that predates my join: it is community history I was
 *     never part of (a stale public invite drops me ONTO a past Refounding),
 *     so its lack of a blob for me means nothing.
 */
export function useRekeyWatch2(community: CommunityV2 | undefined): { stranded: boolean } {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { data: folded } = useControlFold2(community);
  const { data: dissolved } = useDissolved2(community);
  const { mutateAsync: updateList } = useUpdateCommunityList2();
  const entry = useCommunityEntry2(community?.idHex);
  const queryClient = useQueryClient();
  // One adoption/removal per (community, epoch) per session — the list update
  // re-renders with the new epoch, which re-arms the watcher naturally.
  const handled = useRef(new Set<string>());
  // STRANDED: a fresh joiner sitting on an epoch the community has already
  // rotated past, whose rotation predates the join and carries no blob for them
  // — a stale public invite dropped them onto a superseded epoch. They can read
  // history but not the current epoch, and (unlike an adoption) have no forward
  // path from the wire: only a REFRESHED link or a Direct Invite heals them.
  // Surfaced so the UI can tell them the link is out of date (CORD-05 §2).
  const [stranded, setStranded] = useState(false);

  // A successful catch-up (useStrandedRecovery2 merging a refreshed bundle, or
  // any adoption) advances the held epoch — reset so the flag never outlives
  // the strand it described. The main effect re-derives it at the new epoch if
  // the member is somehow STILL behind (e.g. the refreshed bundle itself lags).
  const heldEpoch = community?.rootEpoch;
  const heldId = community?.idHex;
  useEffect(() => {
    setStranded(false);
  }, [heldId, heldEpoch]);

  const nextEpoch = community ? community.rootEpoch + 1n : 0n;
  const query = useQuery<OpenedEvent[]>({
    queryKey: ["concord2", "rekey", community?.idHex ?? null, nextEpoch.toString()],
    enabled: Boolean(community),
    staleTime: 30_000,
    // Rekeys are rare, admin-initiated rotations; this watcher only runs for the
    // open community (mounted on ConcordV2Page). Poll at a relaxed cadence and
    // never while the tab is hidden — per-relay cursors below mean a longer gap
    // only delays adoption, never skips a chunk (issue #19 family).
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const address = baseRekeyGroupKey(community!.root, community!.id, nextEpoch);
      const base: { kinds: number[]; authors: string[]; limit: number } = {
        kinds: [KIND_WRAP],
        authors: [address.pk],
        limit: 50,
      };

      // PER-RELAY `since` cursors: each relay is re-asked from what IT has
      // delivered, so a fast relay can never advance a shared cursor past a
      // rekey chunk a lagging relay still owes us. A permanently-skipped chunk
      // would leave the rotation `!complete` forever — the member never adopts
      // the new epoch and every message under it stays undecryptable
      // (issue #19 family).
      const results = await Promise.all(
        community!.relays.map(async (url) => {
          const scope = `rekey:${community!.idHex}:${nextEpoch}|${url}`;
          const cursor = await readStreamCursor(scope);
          const filter = cursor?.newest ? { ...base, since: cursor.newest } : base;
          try {
            const events = await nostr
              .relay(url)
              .query([filter], { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
            if (events.length > 0) {
              await updateStreamCursor(scope, {
                newest: Math.max(...events.map((e) => e.created_at)),
              });
            }
            return events;
          } catch {
            // Failed/aborted — the cursor stays put; the next poll re-asks.
            return [] as NostrEvent[];
          }
        }),
      );
      // Decrypt the stream layer once (the inner blob stays pairwise-encrypted);
      // persist the opened events so a seen rekey round is never refetched.
      const fresh: OpenedEvent[] = [];
      for (const wrap of results.flat()) {
        try {
          fresh.push(openWrap(wrap, address));
        } catch {
          // not this address / malformed
        }
      }
      if (fresh.length > 0) writeOpened(fresh);
      const stored = await queryByStreams([address.pk]);
      const byId = new Map<string, OpenedEvent>();
      for (const e of stored) byId.set(e.rumorId, e);
      for (const e of fresh) byId.set(e.rumorId, e);
      return [...byId.values()];
    },
  });

  useEffect(() => {
    if (!community || !user || !folded || !query.data || query.data.length === 0) return;
    // Without my own list entry we don't know when I joined, and the removal
    // decision compares each rotation's publish time against that join time —
    // so wait for it rather than risk a stale-epoch false removal.
    if (!entry) return;
    // Death wins every race (CORD-02 §9): a Refounding never crosses the
    // owner's tombstone — no epoch advance past it is honored.
    if (dissolved) return;
    const key = `${community.idHex}:${nextEpoch}`;
    if (handled.current.has(key)) return;
    const nip44 = user.signer.nip44;
    if (!nip44) return;

    let cancelled = false;
    void (async () => {
      const parsed: ParsedRekey[] = [];
      for (const opened of query.data!) {
        try {
          parsed.push(parseRekey(opened));
        } catch {
          // not a rekey / not ours
        }
      }

      // Authorized rotators only: a removed member still holding the prior
      // root can CONSTRUCT a perfect rotation; authority is the roster, never
      // key possession (CORD-06). A banned rotator is dropped outright —
      // every event from a banned npub is, authority actions included
      // (CORD-04 §4).
      const rotations = groupRotations(parsed).filter(
        (set) =>
          set.scopeIdHex === "0".repeat(64) &&
          !folded.banned.has(set.rotator) &&
          (set.rotator === folded.ownerHex || hasPermission(folded.roster, set.rotator, Permissions.BAN)) &&
          checkContinuity(set, community.rootEpoch, community.root).ok,
      );
      if (rotations.length === 0) return;

      // My join time (wall-clock ms). A rotation that entirely predates it
      // happened before I was a member, so its lack of a blob for me is NOT an
      // exclusion — see the removal guard below.
      const joinedAt = entry?.added_at ?? 0;

      // Try to adopt: my blob, decrypted under the rotator↔me pairwise key.
      let adopted: { key: Uint8Array; rotator: string } | undefined;
      // A complete rotation counts toward removal only if it could have carried
      // a blob for me — i.e. it was published at/after I joined.
      let sawExcludingRotation = false;
      // A complete rotation PAST my epoch that predates my join and holds no
      // blob for me: I was dropped onto a superseded epoch by a stale invite.
      let sawStrandingRotation = false;
      for (const set of rotations) {
        if (!set.complete) continue;
        // A member who joined via a stale public invite (bundle epoch N) lands
        // ON a historical `N→N+1` Refounding they were never part of; it carries
        // no blob at their locator, but it predates their join, so it must not be
        // read as a removal (else the rail icon vanishes seconds after every
        // join/rejoin while the community stays fully interactable — exposing it
        // as a liveness-only bug). Only a rotation at/after the join can exclude.
        const couldCarryMyBlob = rotationExcludesMe(rotationPublishedAtMs(set), joinedAt);
        const locator = myLocator(set.rotator, user.pubkey, set.scopeIdHex, set.newEpoch);
        const blob = findBlob(set, locator);
        if (!blob) {
          if (couldCarryMyBlob) sawExcludingRotation = true;
          // Predates my join AND advances past the epoch I hold → I'm stranded
          // on a stale invite's dead epoch, with no wire path forward.
          else if (set.newEpoch > community.rootEpoch) sawStrandingRotation = true;
          continue;
        }
        try {
          const plainB64 = await nip44.decrypt(set.rotator, blob.wrapped);
          const newKey = decodeWrappedKey(base64ToBytes(plainB64), ZERO_SCOPE, set.newEpoch);
          // Racing rotations converge on the lexicographically lowest new key.
          if (!adopted || lowerKeyWins(adopted.key, newKey) === newKey) {
            adopted = { key: newKey, rotator: set.rotator };
          }
        } catch {
          // undecryptable blob at my locator — treat as absent
          if (couldCarryMyBlob) sawExcludingRotation = true;
        }
      }
      if (cancelled) return;

      if (adopted) {
        handled.current.add(key);
        setStranded(false);
        const heldRoots: HeldRoot[] = [
          { epoch: nextEpoch, key: adopted.key },
          ...community.heldRoots,
        ];
        const rotated: CommunityV2 = {
          ...community,
          root: adopted.key,
          rootEpoch: nextEpoch,
          heldRoots,
          refounder: adopted.rotator,
        };
        await updateList({
          type: "refresh-current",
          current: toJoinMaterial(rotated, { prior: entry?.current, relays: entry?.current.relays }),
        }).catch(() => handled.current.delete(key));
        queryClient.invalidateQueries({ queryKey: ["concord2", "list"] });
        // Any links I minted must also vend the fresh epoch (CORD-05 §2), and
        // only I hold their signer_sk — the Refounder can refresh only their
        // own. Best-effort, fire-and-forget: a no-op for the linkless majority.
        refreshInviteBundlesFor(nostr, user, rotated, folded.metadata).catch(() => undefined);
        return;
      }

      // Every chunk of at least one complete rotation held, none carries my
      // locator, AND that rotation was published at/after I joined → I've been
      // excluded (kicked/banned). Being excluded is NOT leaving: mark the entry
      // read-only at this epoch but KEEP it on the rail. It disappears only if
      // the user chooses to leave or the owner dissolves. A later Refounding
      // that re-includes me (adoption above) clears the marker. A rotation that
      // entirely predates my join is community history, not an exclusion.
      if (sawExcludingRotation) {
        handled.current.add(key);
        await updateList({
          type: "exclude",
          communityId: community.idHex,
          epoch: Number(nextEpoch),
        }).catch(() => handled.current.delete(key));
        queryClient.invalidateQueries({ queryKey: ["concord2", "list"] });
      }

      // A complete rotation that PREDATES my join and carries no blob for me
      // is community history I was never part of (a stale public invite
      // dropped me onto a past Refounding): neither an adoption nor an
      // exclusion. There is no forward path on the wire — the rekey for the
      // epoch I hold was minted before my pubkey existed, so it can't carry my
      // blob. The recovery is a REFRESHED link (CORD-05 §2) or a Direct Invite
      // from an online member; surface `stranded` so the UI can say so instead
      // of silently leaving them unable to read the current epoch.
      setStranded(sawStrandingRotation);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community?.idHex, community?.rootEpoch, user?.pubkey, folded, dissolved, query.data, entry?.added_at]);

  return { stranded };
}

/**
 * Keep this creator's OWN live invite links vending the CURRENT epoch (CORD-05
 * §2: "the creator re-posting under it refreshes the bundle … so a link shared
 * once survives every rotation").
 *
 * The gap this closes: a link's bundle only ever advanced when the creator's
 * client happened to (a) be the Refounder, or (b) adopt someone else's rotation
 * via {@link useRekeyWatch2}. A creator who rotated on another device, or whose
 * community was Refounded by a different admin while they were offline, left
 * their links vending the DEAD pre-rotation epoch indefinitely — stranding
 * every fresh joiner on a superseded epoch with no wire path forward. Only the
 * creator holds each link's `signer_sk`, so no one else can heal it.
 *
 * On every open of a community the creator holds live links for, reconcile:
 * re-mint every live link at the current epoch. `refreshInviteBundlesFor` is
 * idempotent (re-posting an already-fresh bundle is a harmless same-epoch
 * rewrite), and this runs at most once per (community, epoch) per session, so a
 * fresh community costs one Invite-List fetch and nothing more.
 */
export function useLinkRefreshWatch2(community: CommunityV2 | undefined): void {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { data: folded } = useControlFold2(community);
  // At most one refresh per (community, epoch, relay set) per session — a later
  // adoption re-renders with a higher epoch, and a relay-list change (followed
  // via useRelayFollow2) changes the set, either of which re-arms this
  // naturally. Relays are in the key because the bundle VENDS them: a link
  // fetched after a relay move must hand joiners the new set.
  const refreshed = useRef(new Set<string>());

  useEffect(() => {
    if (!community || !user?.signer.nip44 || !folded) return;
    // Only an authorized creator may re-post bundles: a stripped creator's
    // refresh would resurrect a link the authority watcher is retiring (the
    // registry already ignores them, but the bundle coordinate is theirs
    // alone). Skipping on a partial fold is safe — a refresh is never owed.
    if (user.pubkey !== folded.ownerHex && !hasPermission(folded.roster, user.pubkey, Permissions.CREATE_INVITE)) return;
    const key = `${community.idHex}:${community.rootEpoch}:${community.relays.join(",")}`;
    if (refreshed.current.has(key)) return;

    let cancelled = false;
    void (async () => {
      // Do I hold any live links for THIS community? (fetchInviteList already
      // drops tombstoned/revoked entries.) If not, there is nothing to refresh.
      let hasLinks = false;
      try {
        const { list } = await fetchInviteList(nostr, user);
        hasLinks = list.entries.some((e) => e.community_id === community.idHex);
      } catch {
        // Transient fetch failure — leave the key unmarked so a later open (or
        // the useRekeyWatch2/refound refresh paths) retries.
        return;
      }
      if (cancelled || !hasLinks) return;
      // Mark BEFORE the refresh so a re-render mid-flight doesn't double-fire;
      // a genuine failure re-arms via the epoch changing or an app restart.
      refreshed.current.add(key);
      // Idempotent and best-effort: an unrefreshed link only delays a joiner's
      // catch-up, and useRekeyWatch2 / useRefound2 also drive this on their own
      // triggers. Mints from the current community snapshot (the open community
      // is already on its adopted epoch).
      await refreshInviteBundlesFor(nostr, user, community, folded.metadata).catch(() => {
        // Persistent failure: unmark so the next open retries.
        refreshed.current.delete(key);
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community?.idHex, community?.rootEpoch, community?.relays.join(","), user?.pubkey, folded]);
}

/**
 * Watch each held Private Channel's NEXT-epoch rekey address (CORD-06 §2:
 * "per PRIVATE Channel you hold; the NEXT channel-epoch's rekey address") and
 * react per channel, mirroring {@link useRekeyWatch2}'s base logic:
 *
 *   - a complete, authorized, continuity-checked rotation carrying MY blob →
 *     adopt the channel's new key/epoch (scope-bound inside the ciphertext,
 *     so a blob minted for one channel can never splice into another);
 *   - a complete rotation with NO blob for me, published at/after I joined →
 *     I've been removed from the channel: it is dropped from `current` so it
 *     visibly disappears (§2 "the client then either visibly removes them or
 *     switches to the new keys"); the original key survives in `seed`.
 *
 * Addresses derive from the community_root, and a Refounding seals its
 * channel rekeys under the PRIOR root (§3) — so a member who adopted the base
 * rotation first would derive the wrong address from their fresh root alone.
 * Every held root is therefore watched, and adoption chains: each adopted
 * channel epoch re-keys the query at `epoch + 2`, walking forward across any
 * number of missed rotations.
 *
 * Authority follows CORD-06: a single-channel Rekey requires MANAGE_CHANNELS,
 * a Refounding's channel rotations act under BAN, and the owner outranks all —
 * any of the three is honored; a banned rotator never is.
 */
export function useChannelRekeyWatch2(community: CommunityV2 | undefined) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { data: folded } = useControlFold2(community);
  const { data: dissolved } = useDissolved2(community);
  const { mutateAsync: updateList } = useUpdateCommunityList2();
  const entry = useCommunityEntry2(community?.idHex);
  const queryClient = useQueryClient();
  const handled = useRef(new Set<string>());

  // The watched (channel, next-epoch) set — the query re-keys when an adoption
  // moves any channel forward, chaining across missed rotations.
  const watchKey = (community?.privateChannels ?? [])
    .map((ch) => `${bytesToHex(ch.id)}:${(ch.epoch + 1n).toString()}`)
    .sort()
    .join(",");

  const query = useQuery<OpenedEvent[]>({
    queryKey: ["concord2", "chrekey", community?.idHex ?? null, watchKey],
    enabled: Boolean(community && community.privateChannels.length > 0),
    staleTime: 30_000,
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      // Per held channel, the next channel-epoch's address under EVERY held
      // root: a refound-driven channel rekey is sealed under the root that was
      // current when it was minted (the then-prior root, §3), which a member
      // catching up may have already rotated past.
      const roots = community!.heldRoots.length > 0 ? community!.heldRoots : [{ epoch: community!.rootEpoch, key: community!.root }];
      const byPk = new Map<string, ReturnType<typeof channelRekeyGroupKey>>();
      for (const ch of community!.privateChannels) {
        for (const r of roots) {
          const address = channelRekeyGroupKey(r.key, ch.id, ch.epoch + 1n);
          byPk.set(address.pk, address);
        }
      }
      const authors = [...byPk.keys()];
      const base: { kinds: number[]; authors: string[]; limit: number } = {
        kinds: [KIND_WRAP],
        authors,
        limit: 50,
      };

      // PER-RELAY `since` cursors, exactly as the base watcher (issue #19
      // family): a fast relay must never advance a cursor past a chunk a
      // lagging relay still owes us.
      const results = await Promise.all(
        community!.relays.map(async (url) => {
          const scope = `chrekey:${community!.idHex}:${watchKey}|${url}`;
          const cursor = await readStreamCursor(scope);
          const filter = cursor?.newest ? { ...base, since: cursor.newest } : base;
          try {
            const events = await nostr
              .relay(url)
              .query([filter], { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
            if (events.length > 0) {
              await updateStreamCursor(scope, { newest: Math.max(...events.map((e) => e.created_at)) });
            }
            return events;
          } catch {
            return [] as NostrEvent[];
          }
        }),
      );
      const fresh: OpenedEvent[] = [];
      for (const wrap of results.flat()) {
        const address = byPk.get(wrap.pubkey);
        if (!address) continue;
        try {
          fresh.push(openWrap(wrap, address));
        } catch {
          // not this address / malformed
        }
      }
      if (fresh.length > 0) writeOpened(fresh);
      const stored = await queryByStreams(authors);
      const byId = new Map<string, OpenedEvent>();
      for (const e of stored) byId.set(e.rumorId, e);
      for (const e of fresh) byId.set(e.rumorId, e);
      return [...byId.values()];
    },
  });

  useEffect(() => {
    if (!community || !user || !folded || !query.data || query.data.length === 0) return;
    if (community.privateChannels.length === 0) return;
    if (!entry) return; // the removal decision needs my join time
    if (dissolved) return; // death wins every race (CORD-02 §9)
    const nip44 = user.signer.nip44;
    if (!nip44) return;

    let cancelled = false;
    void (async () => {
      const parsed: ParsedRekey[] = [];
      for (const opened of query.data!) {
        try {
          parsed.push(parseRekey(opened));
        } catch {
          // not a rekey / not ours
        }
      }
      const sets = groupRotations(parsed);
      const joinedAt = entry?.added_at ?? 0;

      // Walk each held channel independently; accumulate one channels update.
      let nextChannels = entry.current.channels.map((c) => ({ ...c }));
      let changed = false;

      for (const ch of community.privateChannels) {
        const chIdHex = bytesToHex(ch.id);
        const chNext = ch.epoch + 1n;
        const key = `${community.idHex}:${chIdHex}:${chNext}`;
        if (handled.current.has(key)) continue;

        // Authorized rotators only (CORD-06): MANAGE_CHANNELS mints a
        // single-channel Rekey, BAN mints a Refounding's channel rotations,
        // the owner outranks all. Key possession is never authority.
        const rotations = sets.filter(
          (set) =>
            set.scopeIdHex === chIdHex &&
            set.newEpoch === chNext &&
            !folded.banned.has(set.rotator) &&
            (set.rotator === folded.ownerHex ||
              hasPermission(folded.roster, set.rotator, Permissions.BAN) ||
              hasPermission(folded.roster, set.rotator, Permissions.MANAGE_CHANNELS)) &&
            checkContinuity(set, ch.epoch, ch.key).ok,
        );
        if (rotations.length === 0) continue;

        let adopted: Uint8Array | undefined;
        let sawExcludingRotation = false;
        for (const set of rotations) {
          if (!set.complete) continue; // a missing chunk is never a removal
          const couldCarryMyBlob = rotationExcludesMe(rotationPublishedAtMs(set), joinedAt);
          const locator = myLocator(set.rotator, user.pubkey, chIdHex, chNext);
          const blob = findBlob(set, locator);
          if (!blob) {
            if (couldCarryMyBlob) sawExcludingRotation = true;
            continue;
          }
          try {
            const plainB64 = await nip44.decrypt(set.rotator, blob.wrapped);
            // Scope binds INSIDE the ciphertext: a blob minted for another
            // channel (or the base) can never be spliced onto this one.
            const newKey = decodeWrappedKey(base64ToBytes(plainB64), ch.id, chNext);
            if (!adopted || lowerKeyWins(adopted, newKey) === newKey) adopted = newKey;
          } catch {
            if (couldCarryMyBlob) sawExcludingRotation = true;
          }
        }
        if (cancelled) return;

        if (adopted) {
          handled.current.add(key);
          const keyHex = bytesToHex(adopted);
          nextChannels = nextChannels.map((c) =>
            c.id.toLowerCase() === chIdHex ? { ...c, key: keyHex, epoch: Number(chNext) } : c,
          );
          changed = true;
        } else if (sawExcludingRotation) {
          // Removed from this channel: drop it so it visibly disappears
          // (CORD-06 §2). `seed` retains the original key; only `current`
          // forgets it.
          handled.current.add(key);
          nextChannels = nextChannels.filter((c) => c.id.toLowerCase() !== chIdHex);
          changed = true;
        }
      }

      if (!changed || cancelled) return;
      await updateList({ type: "refresh-channels", communityId: community.idHex, channels: nextChannels }).catch(
        () => undefined,
      );
      queryClient.invalidateQueries({ queryKey: ["concord2", "list"] });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community?.idHex, watchKey, user?.pubkey, folded, dissolved, query.data, entry?.added_at]);
}

/**
 * A Refounding (CORD-06 §3): roll the community_root to sever the excluded,
 * re-anchor the Control Plane by compaction, and seed the new Guestbook.
 * Requires BAN (or ownership) and a NIP-44 signer — pairwise blob wrapping is
 * one ECDH either side can compute, so bunkers rotate too.
 */
export function useRefound2(community: CommunityV2 | undefined) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const control = useControlFold2(community);
  const { data: dissolved } = useDissolved2(community);
  const { mutateAsync: updateList } = useUpdateCommunityList2();
  const entry = useCommunityEntry2(community?.idHex);
  const queryClient = useQueryClient();

  const refound = useMutation<void, Error, { keep: string[]; exclude: string[] }>({
    // A rotation is community-global: serialize every refound for this
    // community (a user-initiated ban racing the durable retry must queue,
    // not mint sibling epochs), and give the key a name the retry hook can
    // watch via useIsMutating.
    mutationKey: ["concord2-refound", community?.idHex],
    scope: { id: `concord2-refound:${community?.idHex}` },
    mutationFn: async ({ keep, exclude }) => {
      if (!user || !community) throw new Error("Not ready.");
      if (dissolved) throw new Error("This community was dissolved; no epoch advance past the tombstone is honored.");
      const nip44 = user.signer.nip44;
      if (!nip44) throw new Error("This signer can't rotate keys (NIP-44 unsupported).");
      const rendered = control.data;
      if (!rendered || control.isLoading || control.isFetching) {
        throw new Error("Still syncing the community's control plane; try again shortly.");
      }

      // Fold-all-or-abort (CORD-06 §3): the Refounder must compact a COMPLETE
      // picture — one forced whole-plane sweep, then a verification fold
      // floored at every head this client has accepted. An entity the relays
      // no longer serve (or serve gapped) ABORTS the Refounding; otherwise it
      // would be silently dropped from, or compacted stale into, the new epoch
      // — for every member, forever.
      try {
        await sweepControl(nostr, community);
      } catch {
        throw new Error("Couldn't re-fetch the community's control plane; check your connection and try again.");
      }
      if (controlSweepTruncated(community)) {
        throw new Error("The community's control plane is too deep to fetch fully right now; rotation aborted so nothing is lost.");
      }
      const stored = await queryByStreams(controlGroups(community).map((g) => g.pk));
      const verifySnap =
        community.rootEpoch > 0n
          ? new Set(stored.filter((ev) => ev.streamPk === currentControlGroup(community).pk).map((ev) => ev.rumorId))
          : undefined;
      const folded = foldControlState(openControlEditions(stored), community.id, community.owner, rendered.heads, verifySnap);
      if (folded.incomplete.length > 0) {
        throw new Error("Part of the community's state isn't reachable right now; rotation aborted so nothing is lost.");
      }

      const authorized = user.pubkey === folded.ownerHex || hasPermission(folded.roster, user.pubkey, Permissions.BAN);
      if (!authorized) throw new Error("You don't have permission to rotate this community's keys.");

      // Freshness guard: if the list entry has advanced past the epoch this
      // call captured (a prior rotation landed first), abort rather than mint a
      // sibling epoch off a stale root — the caller re-issues from the current
      // community. Serialization makes this the only residual concurrent case.
      if (entry && BigInt(entry.current.root_epoch) !== community.rootEpoch) {
        throw new Error("The community rotated since this action began; reopen it and try again.");
      }

      const excluded = new Set(exclude);
      const recipients = [...new Set([user.pubkey, ...keep])].filter((pk) => !excluded.has(pk));

      const newEpoch = community.rootEpoch + 1n;
      const newRoot = random32();
      const prevCommit = bytesToHex(epochKeyCommitment(community.rootEpoch, community.root));

      // Acquire everything BEFORE the first publish (resumable, never half-lost).
      const plain = bytesToBase64(encodeWrappedKey(ZERO_SCOPE, newEpoch, newRoot));
      const blobs: RekeyBlob[] = [];
      for (const pk of recipients) {
        const wrapped = await nip44.encrypt(pk, plain);
        blobs.push({ locator: myLocator(user.pubkey, pk, "0".repeat(64), newEpoch), wrapped });
      }

      // 1. The root roll: rekey blobs at the base address under the PRIOR root.
      const address = baseRekeyGroupKey(community.root, community.id, newEpoch);
      const rumors = buildRekeyRumors(
        user.pubkey,
        { scope: { kind: "root" }, newEpoch, prevEpoch: community.rootEpoch, prevCommit },
        blobs,
        Date.now(),
      );
      for (const rumor of rumors) {
        const wrap = wrapSeal(await sealRumor(rumor, KIND_SEAL_ENCRYPTED, address, user.signer), address);
        const results = await Promise.allSettled(
          community.relays.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(8000) })),
        );
        if (!results.some((r) => r.status === "fulfilled")) {
          throw new Error("No relay accepted the key rotation.");
        }
      }

      // 2. Compaction, only after the roll published: re-wrap each entity's
      // current head (plaintext seals keep the original signatures verifiable).
      const newControl = controlGroupKey(newRoot, community.id, newEpoch);
      for (const head of folded.headEditions.values()) {
        try {
          const rewrapped = rewrapSeal(head.opened.seal, newControl);
          await Promise.allSettled(
            community.relays.map((url) => nostr.relay(url).event(rewrapped, { signal: AbortSignal.timeout(8000) })),
          );
        } catch {
          // An encrypted-seal head can't re-wrap; control heads are plaintext
          // by construction, so this is defensive only.
        }
      }

      // 2b. Rotate every held Private Channel (CORD-06 §3: "all Private
      // Channels relevant to the removed user(s) are rekeyed"). This client
      // grants every private channel to every member (the invite bundle
      // carries them all), so every held channel is relevant to any removed
      // member — rotate them all. Each channel is independently keyed
      // (CORD-03), so each gets its own fresh key delivered by a
      // channel-scoped rekey, sealed and addressed under the PRIOR
      // community_root — never the freshly minted one — so a base-race loser
      // can still open it (§3). Public channels rotate with the base for free.
      const rotatedChannels: PrivateChannelKey[] = [];
      for (const ch of community.privateChannels) {
        const chEpoch = ch.epoch + 1n;
        const chKey = random32();
        const chIdHex = bytesToHex(ch.id);
        const chPlain = bytesToBase64(encodeWrappedKey(ch.id, chEpoch, chKey));
        const chBlobs: RekeyBlob[] = [];
        for (const pk of recipients) {
          chBlobs.push({ locator: myLocator(user.pubkey, pk, chIdHex, chEpoch), wrapped: await nip44.encrypt(pk, chPlain) });
        }
        const chAddress = channelRekeyGroupKey(community.root, ch.id, chEpoch);
        const chRumors = buildRekeyRumors(
          user.pubkey,
          {
            scope: { kind: "channel", channelId: ch.id },
            newEpoch: chEpoch,
            prevEpoch: ch.epoch,
            prevCommit: bytesToHex(epochKeyCommitment(ch.epoch, ch.key)),
          },
          chBlobs,
          Date.now(),
        );
        for (const rumor of chRumors) {
          const wrap = wrapSeal(await sealRumor(rumor, KIND_SEAL_ENCRYPTED, chAddress, user.signer), chAddress);
          const results = await Promise.allSettled(
            community.relays.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(8000) })),
          );
          if (!results.some((r) => r.status === "fulfilled")) {
            // Gating like the root roll: an unrotated channel leaves the
            // removed member reading it — the severance this Refounding
            // exists for. Resumable (CORD-06 §3), not atomic.
            throw new Error(`No relay accepted the #${ch.name} channel key rotation.`);
          }
        }
        rotatedChannels.push({ ...ch, key: chKey, epoch: chEpoch });
      }

      // 3. Guestbook snapshot: best-effort, non-gating (CORD-02 §5).
      try {
        const newGuestbook = guestbookGroupKey(newRoot, community.id, newEpoch);
        const snapId = bytesToHex(random32());
        for (const rumor of buildSnapshotRumors(user.pubkey, recipients, snapId, Date.now())) {
          const wrap = await sealGuestbook(rumor, newGuestbook, user.signer);
          await Promise.allSettled(
            community.relays.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(8000) })),
          );
        }
      } catch {
        // A Refounding succeeds with or without the snapshot.
      }

      // 3b. Refresh every live invite link's bundle to the new epoch (CORD-05
      // §2: "the creator re-posting under it refreshes the bundle — fresh keys
      // behind the same URL, e.g. after a Rekey — so a link shared once survives
      // every rotation"). Without this, a link minted at the old epoch keeps
      // vending stale keys and a fresh joiner lands on the superseded epoch.
      // The `signer_sk` for each link lives in the refounder's own Invite List
      // (§4), so a refounder refreshes exactly the links they created; other
      // creators' links refresh when they adopt this rotation (useRekeyWatch2).
      // Revoked links are tombstoned there and skipped, so a Public→Private
      // conversion (which retires the last link) never resurrects one.
      // Carries the POST-rotation channel keys (step 2b), never the severed ones.
      //
      // DURABLE (mirrors Vector): idempotent, so retry a transient failure —
      // a stranded link lands every new joiner on the DEAD pre-rotation epoch,
      // and there is no other trigger to heal it before the next Refounding. A
      // persistent failure warns the refounder (the rotation itself already
      // succeeded) so they can reopen the community to retry.
      {
        const fresh = {
          ...community,
          root: newRoot,
          rootEpoch: newEpoch,
          privateChannels: rotatedChannels,
        };
        let refreshed = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await refreshInviteBundlesFor(nostr, user, fresh, folded.metadata);
            refreshed = true;
            break;
          } catch {
            // transient — retry
          }
        }
        if (!refreshed) {
          toast({
            title: "Live invite links may serve the old keys",
            description:
              "Key rotation succeeded, but refreshing your invite links failed. Reopen the community to retry, or new joiners on those links could land on the previous epoch.",
            variant: "destructive",
          });
        }
      }

      // 4. Follow our own rotation forward.
      const rotated: CommunityV2 = {
        ...community,
        root: newRoot,
        rootEpoch: newEpoch,
        heldRoots: [{ epoch: newEpoch, key: newRoot }, ...community.heldRoots],
        privateChannels: rotatedChannels,
        refounder: user.pubkey,
      };
      await updateList({
        type: "refresh-current",
        current: toJoinMaterial(rotated, { prior: entry?.current, relays: entry?.current.relays }),
      });
      queryClient.invalidateQueries({ queryKey: ["concord2", "list"] });
    },
  });

  return {
    refound: refound.mutateAsync,
    isRefounding: refound.isPending,
    /** V2 rotations need only a NIP-44 signer (bunker-friendly), unlike V1's raw-nsec rule. */
    canRefound: Boolean(user?.signer.nip44),
  };
}

// Re-exported for the moderation hook's scope math.
export { rekeyScopeId };
