import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCommunityEntry2, useUpdateCommunityList2 } from "@/concord-v2/hooks/useCommunityList2";
import { useControlFold2, citationFor, invalidateControl2, publishEdition2 } from "@/concord-v2/hooks/useControlPlane2";
import { useGuestbookPublisher2 } from "@/concord-v2/hooks/useGuestbook2";
import { buildJoinRumor, currentGuestbookGroup, openGuestbookOpened, openGuestbookWraps, sealGuestbook, singleUseLinkUsed } from "@/concord-v2/lib/guestbook";
import {
  AGENT_GATE_METADATA_KEY,
  AgentOnlyCommunityError,
  DEFAULT_AGENT_GATE_DIFFICULTY,
  agentGateOf,
  grindJoinRumor,
} from "@/concord-v2/lib/agentGate";
import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchCreatorDmRelays } from "@/lib/creatorRelays";
import { APP_RELAYS } from "@/lib/platform";
import { APP_CURATED_FEED_RELAYS } from "@/lib/appRelays";
import { preferPortableRelays, unusableRelaysReason } from "@/lib/relayUsability";
import { toJoinMaterial, rehydrateCommunity, type CommunityListEntry, type JoinMaterial } from "@/concord-v2/lib/communityList";
import { mintCommunity } from "@/concord-v2/lib/community";
import {
  buildChannelEdition,
  buildMetadataEdition,
  sealDissolved,
} from "@/concord-v2/lib/control";
import { bytesToHex, hex32, random32 } from "@/concord-v2/lib/derive";
import {
  encodeFragment,
  inviteCommitment,
  parseBundleEvent,
  parseInviteLink,
  STOCK_RELAYS,
  type InviteBundle,
  type ParsedInviteLink,
} from "@/concord-v2/lib/invite";
import { KIND_INVITE_BUNDLE, VSK_INVITE_REVOKED } from "@/concord-v2/lib/kinds";
import { capRelays, type CommunityV2 } from "@/concord-v2/lib/types";
import { controlGroups, foldControlState, openControlWraps, type FoldedControl } from "@/concord-v2/lib/control";
import { registerStreamKeys } from "@/concord-v2/lib/streamAuth";
import { KIND_WRAP } from "@/concord-v2/lib/kinds";

import type { NostrEvent } from "@nostrify/nostrify";

/** Thrown when the joiner is on the community's folded Banlist (CORD-04 §4). */
export class BannedFromCommunityError extends Error {
  constructor() {
    super("You're banned from this community and can't rejoin.");
    this.name = "BannedFromCommunityError";
  }
}

/** Thrown when the control plane can't be read to verify access (retryable). */
export class ControlUnreadableError extends Error {
  constructor() {
    super("Couldn't verify your access to this community. Please try again.");
    this.name = "ControlUnreadableError";
  }
}

/** Thrown when a single-use invite link has already been spent (CORD-05 §2). */
export class SingleUseLinkUsedError extends Error {
  constructor() {
    super("This invite link was single-use and has already been used. Ask for a fresh one.");
    this.name = "SingleUseLinkUsedError";
  }
}

/**
 * Refuse to join a community whose CURRENT Banlist names me (CORD-04 §4). An
 * honest client MUST NOT publish a Join, record the entry, or emit anything
 * while banlisted — presence on the folded head is disqualifying regardless of
 * edition timestamps (the self-removal watcher's timestamp guard is for the
 * post-join replay race, NOT for entry). Fetch + fold the control plane and
 * throw before any side effect.
 *
 * Fail CLOSED: a real community always carries control editions (genesis
 * metadata + channel), so an empty read means the plane was withheld or
 * unreachable, NOT "no ban" — refuse-and-retry rather than wave a banned user
 * through. The read is NIP-42 authenticated (the stock relays gate stream
 * reads), scoped to the community's control-group keys.
 *
 * ORDERING INVARIANT: this must fold the FRESH bundle entry, before any merge
 * with a previously-held list entry. The fresh entry spans only the invite's
 * epoch, so the fold is single-epoch and needs no snapshot attribution; a
 * merged rejoin entry restores older roots and would need the full
 * cross-epoch fold semantics (see headCandidates' `snapshot`).
 */
export async function assertNotBanned(
  nostr: ReturnType<typeof useNostr>["nostr"],
  community: CommunityV2,
  pubkey: string,
): Promise<void> {
  const folded = await fetchControlFold(nostr, community);
  if (folded.banned.has(pubkey)) throw new BannedFromCommunityError();
}

/**
 * Fetch + fold the control plane for a join preflight. Fail CLOSED: a real
 * community always carries control editions (genesis metadata + channel), so
 * an empty read means the plane was withheld or unreachable, NOT "no state" —
 * refuse-and-retry rather than wave anyone through.
 */
export async function fetchControlFold(
  nostr: ReturnType<typeof useNostr>["nostr"],
  community: CommunityV2,
): Promise<FoldedControl> {
  // Enforce the single-epoch invariant in code, not just prose: this fold omits
  // snapshot attribution, so a merged multi-epoch entry could anchor on a stale
  // old-epoch fragment and wave a banned rejoiner through. Fail closed.
  if (community.heldRoots.length !== 1) throw new ControlUnreadableError();
  const groups = controlGroups(community);
  // Answer the relays' NIP-42 challenge with the control-group keys, else a
  // gated relay serves nothing and the state goes unseen.
  registerStreamKeys(groups, community.relays);
  const authors = groups.map((g) => g.pk);
  const results = await Promise.all(
    community.relays.map((url) =>
      nostr
        .relay(url)
        .query([{ kinds: [KIND_WRAP], authors }], { signal: AbortSignal.timeout(12_000) })
        .catch(() => [] as NostrEvent[]),
    ),
  );
  const seen = new Set<string>();
  const wraps = results.flat().filter((e) => (seen.has(e.id) ? false : seen.add(e.id)));
  if (wraps.length === 0) throw new ControlUnreadableError();
  return foldControlState(openControlWraps(wraps, groups), community.id, community.owner);
}

/** A preview of where a V2 invite leads, resolved before joining. */
export interface InvitePreview2 {
  communityId: string;
  name: string;
  channelCount: number;
  relays: string[];
  bundle: InviteBundle;
}

/** Fetch + verify a V2 invite bundle from its bootstrap relays. */
export async function resolveBundle(
  nostr: ReturnType<typeof useNostr>["nostr"],
  invite: ParsedInviteLink,
  fallbackRelays: string[],
): Promise<InviteBundle> {
  const pool = invite.bootstrapRelays.length ? invite.bootstrapRelays : fallbackRelays;
  const results = await Promise.all(
    pool.map((url) =>
      nostr
        .relay(url)
        .query(
          // No limit: a relay's own "newest" pick between tied editions is
          // arbitrary — the tie must be broken by OUR rule below (tombstone
          // wins), never by what a relay happened to store first.
          [{ kinds: [KIND_INVITE_BUNDLE], authors: [invite.linkSigner], "#d": [""] }],
          { signal: AbortSignal.timeout(8000) },
        )
        .catch(() => [] as NostrEvent[]),
    ),
  );
  const flat = results.flat();
  if (flat.length === 0) throw new Error("Couldn't find that invite on its relays.");
  // The newest event at the coordinate wins: a refresh replaces the bundle, a
  // revocation tombstone replaces it terminally. At a created_at TIE (clocks
  // are second-granular; a revoke right after a refresh ties) the tombstone
  // beats the live bundle — only a STRICTLY newer live bundle (a re-mint)
  // overrides a revocation. Same rule as the agent CLI's join path.
  const maxTs = flat.reduce((m, e) => Math.max(m, e.created_at), 0);
  const atMax = flat.filter((e) => e.created_at === maxTs);
  const newest =
    atMax.find((e) => e.tags.some((t) => t[0] === "vsk" && t[1] === VSK_INVITE_REVOKED)) ?? atMax[0];
  return parseBundleEvent(newest, invite.linkSigner, invite.token, Date.now());
}

/** Turn a verified bundle into the membership-list join material + entry. */
export function bundleToEntry(bundle: InviteBundle, opts?: { inviteRef?: string }): CommunityListEntry {
  const jm: JoinMaterial = {
    community_id: bundle.community_id,
    owner: bundle.owner,
    owner_salt: bundle.owner_salt,
    community_root: bundle.community_root,
    root_epoch: bundle.root_epoch,
    channels: Array.isArray(bundle.channels)
      ? bundle.channels.map((ch) => ({ id: ch.id, key: ch.key, epoch: ch.epoch, name: ch.name }))
      : [],
    relays: capRelays(bundle.relays),
    name: bundle.name,
  };
  return {
    community_id: jm.community_id,
    seed: jm,
    current: jm,
    added_at: Date.now(),
    // Remember the link joined through (bare `naddr#fragment`), so a member
    // stranded on a superseded epoch can re-resolve the SAME link once its
    // creator refreshes the bundle (CORD-05 §2) — see useStrandedRecovery2.
    ...(opts?.inviteRef ? { invite_ref: opts.inviteRef } : {}),
  };
}

/** The domain-agnostic bare form of a parsed invite link: `<naddr>#<fragment>`. */
export function inviteRefOf(invite: ParsedInviteLink): string {
  return `${invite.naddr}#${encodeFragment(invite.token, invite.bootstrapRelays)}`;
}

/**
 * The curated-feed relay set, offered as extra community-home candidates in
 * the create dialog's advanced relay menu. These are the large public relays
 * the feed already uses, so they are known write-open homes where the genesis
 * gift wrap (kind 1059) lands. Portable-filtered so a stray non-`wss://`
 * entry can never lock https members out (#47). Consumed from
 * `@/lib/appRelays` — the relay set itself is owned by the feed config.
 */
export const FEED_RELAY_CANDIDATES: string[] = preferPortableRelays(APP_CURATED_FEED_RELAYS);

/**
 * The default home-relay set for a NEW community: the creator's app relays,
 * the curated-feed relay candidates, and the CORD stock set (the wss://
 * interop relays every CORD client shares — jskitty, asia.vectorapp, ditto,
 * dreamith) as the reliable base, then the creator's NIP-17 DM relays. A
 * creator's inbox relays alone can be a poor community home: an auth-gated
 * or DM-only relay rejects the genesis gift wrap (kind 1059), and if that's
 * the whole set the create strands with "No relay accepted the change."
 * Leading with known write-open relays guarantees the genesis lands.
 * Portable-filtered so a stray `ws://` dev relay can't lock https members
 * out (#47), deduped, and capped to the recommended community relay count.
 */
export function defaultCreateRelays(appRelays: string[], dmRelays: string[]): string[] {
  return capRelays(preferPortableRelays([...appRelays, ...FEED_RELAY_CANDIDATES, ...STOCK_RELAYS, ...dmRelays]));
}

/**
 * The candidate relays the advanced create menu pre-selects: the same set
 * {@link defaultCreateRelays} the create path would pick on its own, resolved
 * for display so the user can pare it down or add to it before minting. Gated
 * behind `enabled` so a user who never opens the advanced menu pays no DM-relay
 * lookup.
 */
export function useCreateRelayCandidates2(enabled = true) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const appRelays = config.appRelays.length > 0 ? config.appRelays : APP_RELAYS;
  return useQuery<string[]>({
    queryKey: ["concord2", "create-relays", user?.pubkey ?? null, appRelays],
    enabled: enabled && Boolean(user),
    staleTime: 60_000,
    queryFn: async () => {
      const dm = user ? await fetchCreatorDmRelays(nostr, user.pubkey).catch(() => []) : [];
      return defaultCreateRelays(appRelays, dm);
    },
  });
}

/**
 * Create / preview / join for Concord V2 communities. Creating publishes the
 * genesis Control Plane — EXACTLY two owner-signed editions, the metadata and
 * one public `#general` (CORD-02 §1) — plus the creator's own Guestbook Join,
 * and records the keys in the Community List (the only durable record).
 */
export function useCommunityActions2() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { mutateAsync: updateList } = useUpdateCommunityList2();
  const queryClient = useQueryClient();

  // Fallback relays for resolving an invite bundle when the fragment carries no
  // bootstrap relays of its own. Prefer the user's configured app relays (so a
  // removed relay isn't silently reused) and fall back to the stock interop set
  // (not the app defaults) when the user has emptied their list — a relayless
  // link must still resolve against the relays every CORD client shares.
  const bootstrapRelays = config.appRelays.length > 0 ? config.appRelays : STOCK_RELAYS;

  const create = useMutation<{ communityId: string; name: string }, Error, { name: string; relays?: string[]; agentOnly?: boolean }>({
    mutationFn: async ({ name, relays: chosen, agentOnly }) => {
      if (!user) throw new Error("Sign in to start an encrypted community.");
      if (!user.signer.nip44) throw new Error("This signer can't hold encrypted communities (NIP-44 unsupported).");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name your community first.");

      // The community's home relays. When the advanced menu supplied an
      // explicit set, honor it (portable-filtered all the same). Otherwise seed
      // the app relays UNIONED with the creator's NIP-17 DM relays: inbox
      // relays are curated for sealed, privacy-expecting traffic like Concord's,
      // but a creator whose only DM relays are auth-gated or DM-only will have
      // the genesis gift wrap rejected everywhere, so always including the app
      // relays guarantees a write-open home. Prefer the wss:// subset: a stray
      // ws:// dev relay sealed into the bundle is permanently unreachable for
      // every member on a secure origin, however reachable it is for the
      // creator (#47).
      const appRelays = config.appRelays.length > 0 ? config.appRelays : APP_RELAYS;
      const relays = chosen && chosen.length > 0
        ? preferPortableRelays(chosen)
        : defaultCreateRelays(appRelays, await fetchCreatorDmRelays(nostr, user.pubkey));
      const { community, generalChannelId } = mintCommunity(trimmed, user.pubkey, relays);

      // Genesis: two owner-signed editions, nothing more (CORD-02 §1). An
      // agent-only create seals the gate INTO the metadata edition: every
      // conforming client then drops Guestbook Joins that lack the PoW.
      await publishEdition2(
        nostr,
        community,
        user.signer,
        buildMetadataEdition(
          community.id,
          {
            name: trimmed,
            relays: community.relays,
            ...(agentOnly
              ? { [AGENT_GATE_METADATA_KEY]: { type: "pow", difficulty: DEFAULT_AGENT_GATE_DIFFICULTY } }
              : {}),
          },
          { actorPubkey: user.pubkey, version: 1n },
        ),
      );
      await publishEdition2(
        nostr,
        community,
        user.signer,
        buildChannelEdition(
          generalChannelId,
          { name: "general", private: false },
          { actorPubkey: user.pubkey, version: 1n },
        ),
      );

      // Record membership FIRST (the vault), then announce presence.
      const jm = toJoinMaterial(community, { relays: community.relays });
      await updateList({
        type: "add",
        entry: { community_id: community.idHex, seed: jm, current: jm, added_at: Date.now() },
      });

      // Best-effort founder Join, so the member list has a firsthand entry.
      // On a gated community the founder's own Join must clear the gate too —
      // the fold shows no favoritism.
      void (async () => {
        const rumor = agentOnly
          ? grindJoinRumor(user.pubkey, Date.now(), DEFAULT_AGENT_GATE_DIFFICULTY)
          : buildJoinRumor(user.pubkey, Date.now());
        const wrap = await sealGuestbook(rumor, currentGuestbookGroup(community), user.signer);
        await Promise.allSettled(
          community.relays.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(8000) })),
        );
      })().catch(() => undefined);

      return { communityId: community.idHex, name: trimmed };
    },
  });

  const preview = useMutation<InvitePreview2, Error, { invite: ParsedInviteLink }>({
    mutationFn: async ({ invite }) => {
      const bundle = await resolveBundle(nostr, invite, bootstrapRelays);
      // Fail loudly when this platform can't reach ANY of the community's
      // relays (#47) — e.g. a ws://-only dev community opened on the APK,
      // where mixed content silently blocks every connection.
      const unusable = unusableRelaysReason(bundle.relays);
      if (unusable) throw new Error(unusable);
      return {
        communityId: bundle.community_id,
        name: bundle.name,
        channelCount: Array.isArray(bundle.channels) ? bundle.channels.length : 0,
        relays: bundle.relays,
        bundle,
      };
    },
  });

  const join = useMutation<{ communityId: string; name: string }, Error, { invite: ParsedInviteLink; grindAgentPow?: boolean }>({
    mutationFn: async ({ invite, grindAgentPow }) => {
      if (!user) throw new Error("Sign in to join an encrypted community.");
      const bundle = await resolveBundle(nostr, invite, bootstrapRelays);
      const unusable = unusableRelaysReason(bundle.relays);
      if (unusable) throw new Error(unusable);
      const entry = bundleToEntry(bundle, { inviteRef: inviteRefOf(invite) });
      // A banned npub must not join (CORD-04 §4), and a gated ₿AO refuses
      // human joins (agent_gate) — check BOTH before recording the entry or
      // publishing anything. One fold serves both checks.
      const community = rehydrateCommunity(entry);
      // The commitment every Join from this link will cite (sha256 of the
      // unlock token) — lets the Guestbook tell which link a member used.
      const commitment = inviteCommitment(invite.token);
      // Set when the community is agent-gated AND the caller opted to grind
      // (an agent-audience invite): the Guestbook Join then carries the PoW.
      let grindDifficulty: number | undefined;
      if (community) {
        const folded = await fetchControlFold(nostr, community);
        if (folded.banned.has(user.pubkey)) throw new BannedFromCommunityError();
        const gate = agentGateOf(folded.metadata);
        // The human app path refuses on purpose: the gate's proof-of-work is
        // the captcha only agents solve. Agent tooling (AGENTS.md) grinds it,
        // and the agent invite fast path (audience: "agent") passes
        // grindAgentPow to grind it right in the join page.
        if (gate) {
          if (!grindAgentPow) throw new AgentOnlyCommunityError(gate.difficulty);
          grindDifficulty = gate.difficulty;
        }
        // A single-use link is spent once the Guestbook shows a Join citing
        // its token commitment. Honest-client enforcement: a modified client
        // skips this, so creators should rotate keys when it truly matters.
        if (bundle.max_uses === 1) {
          const group = currentGuestbookGroup(community);
          const wraps = await nostr.query([{ kinds: [KIND_WRAP], authors: [group.pk] }], {
            signal: AbortSignal.timeout(8000),
          });
          if (singleUseLinkUsed(openGuestbookOpened(openGuestbookWraps(wraps, [group])), commitment)) {
            throw new SingleUseLinkUsedError();
          }
        }
      }
      await updateList({ type: "add", entry });
      queryClient.invalidateQueries({ queryKey: ["concord2", "list"] });

      // Best-effort self-signed Guestbook Join, echoing the link's attribution
      // (CORD-02 §5 / CORD-05 §1) — the coalesce self-heals if it never lands.
      if (community) {
        void (async () => {
          const attribution = bundle.creator_npub
            ? { creator: bundle.creator_npub, label: bundle.label, commitment }
            : { creator: "", label: bundle.label, commitment };
          const rumor =
            grindDifficulty !== undefined
              ? grindJoinRumor(user.pubkey, Date.now(), grindDifficulty, attribution)
              : buildJoinRumor(user.pubkey, Date.now(), attribution);
          const wrap = await sealGuestbook(rumor, currentGuestbookGroup(community), user.signer);
          await Promise.allSettled(
            community.relays.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(8000) })),
          );
        })().catch(() => undefined);
      }

      return { communityId: bundle.community_id, name: bundle.name };
    },
  });

  return {
    create: create.mutateAsync,
    isCreating: create.isPending,
    preview: preview.mutateAsync,
    isPreviewing: preview.isPending,
    join: join.mutateAsync,
    isJoining: join.isPending,
  };
}

/** Per-community actions: leave, dissolve, and channel management. */
export function useCommunityManagement2(community: CommunityV2 | undefined) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: updateList } = useUpdateCommunityList2();
  const { data: folded } = useControlFold2(community);
  const publisher = useGuestbookPublisher2(community);
  const entry = useCommunityEntry2(community?.idHex);
  const queryClient = useQueryClient();

  const leave = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!user || !community) throw new Error("Not ready.");
      // Best-effort Leave (the tombstone is the authoritative local act).
      await publisher.mutateAsync({ type: "leave" }).catch(() => undefined);
      await updateList({ type: "remove", communityId: community.idHex });
    },
  });

  const dissolve = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!user || !community) throw new Error("Not ready.");
      if (user.pubkey !== community.owner) throw new Error("Only the owner can dissolve the community.");
      const wrap = await sealDissolved(community.id, user.pubkey, user.signer);
      const results = await Promise.allSettled(
        community.relays.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(8000) })),
      );
      if (!results.some((r) => r.status === "fulfilled")) {
        throw new Error("No relay accepted the dissolution.");
      }
      await updateList({ type: "remove", communityId: community.idHex });
    },
  });

  const createChannel = useMutation<{ channelIdHex: string }, Error, { name: string }>({
    mutationFn: async ({ name }) => {
      if (!user || !community) throw new Error("Not ready.");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Channel name is required.");
      const channelId = random32();
      await publishEdition2(
        nostr,
        community,
        user.signer,
        buildChannelEdition(
          channelId,
          { name: trimmed, private: false },
          { actorPubkey: user.pubkey, version: 1n, authority: citationFor(community, folded, user.pubkey) },
        ),
      );
      invalidateControl2(queryClient, community.idHex);
      return { channelIdHex: bytesToHex(channelId) };
    },
  });

  const renameChannel = useMutation<void, Error, { channelIdHex: string; name: string }>({
    mutationFn: async ({ channelIdHex, name }) => {
      if (!user || !community) throw new Error("Not ready.");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Channel name is required.");
      const def = folded?.channels.get(channelIdHex);
      const head = folded?.heads.get(channelIdHex);
      await publishEdition2(
        nostr,
        community,
        user.signer,
        buildChannelEdition(
          hex32(channelIdHex),
          // Round-trip the flags a rename doesn't touch (CORD-02 §6 discipline).
          { name: trimmed, private: def?.isPrivate ?? false },
          {
            actorPubkey: user.pubkey,
            version: head ? head.version + 1n : 1n,
            prevHash: head?.hash,
            authority: citationFor(community, folded, user.pubkey),
          },
        ),
      );
      invalidateControl2(queryClient, community.idHex);
    },
  });

  const deleteChannel = useMutation<void, Error, { channelIdHex: string }>({
    mutationFn: async ({ channelIdHex }) => {
      if (!user || !community) throw new Error("Not ready.");
      const def = folded?.channels.get(channelIdHex);
      const head = folded?.heads.get(channelIdHex);
      await publishEdition2(
        nostr,
        community,
        user.signer,
        buildChannelEdition(
          hex32(channelIdHex),
          {
            name: def?.name ?? "deleted",
            private: def?.isPrivate ?? false,
            deleted: true,
          },
          {
            actorPubkey: user.pubkey,
            version: head ? head.version + 1n : 1n,
            prevHash: head?.hash,
            authority: citationFor(community, folded, user.pubkey),
          },
        ),
      );
      invalidateControl2(queryClient, community.idHex);
    },
  });

  return {
    leave: leave.mutateAsync,
    isLeaving: leave.isPending,
    dissolve: dissolve.mutateAsync,
    isDissolving: dissolve.isPending,
    createChannel: createChannel.mutateAsync,
    isAddingChannel: createChannel.isPending,
    renameChannel: renameChannel.mutateAsync,
    isRenaming: renameChannel.isPending,
    deleteChannel: deleteChannel.mutateAsync,
    entry,
  };
}

/**
 * Self-heal for a STRANDED member (a stale invite dropped them onto an epoch a
 * pre-join Refounding already superseded — see useRekeyWatch2): re-resolve the
 * SAME link they joined through (`entry.invite_ref`), and when its creator has
 * refreshed the bundle to a higher epoch (CORD-05 §2, now guaranteed on the
 * creator's next community open by useLinkRefreshWatch2), merge it forward.
 *
 * The merge rides the ordinary `add` (epoch-monotonic: `freshest` keeps the
 * higher epoch, `seed` keeps the earliest root), so a still-stale bundle is a
 * no-op and nothing can move backward. After a successful catch-up, a fresh
 * Join is announced on the NEW epoch's Guestbook — the stranded Join landed on
 * the superseded epoch's plane, invisible to current members, and re-following
 * a link announces exactly like a first join (CORD-05 §1).
 *
 * Polls at a relaxed cadence while stranded (the banner also exposes a manual
 * "Check again"). Inert unless `stranded` and the entry carries a link ref.
 */
export function useStrandedRecovery2(
  community: CommunityV2 | undefined,
  stranded: boolean,
): { canRecover: boolean; checking: boolean; checkNow: () => Promise<boolean> } {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { mutateAsync: updateList } = useUpdateCommunityList2();
  const entry = useCommunityEntry2(community?.idHex);
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);

  const inviteRef = typeof entry?.invite_ref === "string" ? entry.invite_ref : undefined;
  const canRecover = Boolean(stranded && inviteRef && user && community);
  const bootstrapRelays = config.appRelays.length > 0 ? config.appRelays : STOCK_RELAYS;

  /** One recovery attempt. Resolves true when a fresher epoch was merged in. */
  const checkNow = useCallback(async (): Promise<boolean> => {
    if (!community || !user || !inviteRef || inFlight.current) return false;
    const invite = parseInviteLink(inviteRef);
    if (!invite) return false;
    inFlight.current = true;
    setChecking(true);
    try {
      const bundle = await resolveBundle(nostr, invite, bootstrapRelays);
      // Still vending the epoch we hold (or older): the creator hasn't
      // refreshed yet. Nothing to do — the next poll re-asks.
      if (BigInt(bundle.root_epoch) <= community.rootEpoch) return false;

      const fresh = bundleToEntry(bundle, { inviteRef });
      await updateList({ type: "add", entry: fresh });
      queryClient.invalidateQueries({ queryKey: ["concord2", "list"] });

      // Announce on the epoch we can now read: the stranded Join went to the
      // superseded epoch's Guestbook, which current members never watch.
      void (async () => {
        const rehydrated = rehydrateCommunity(fresh);
        if (!rehydrated) return;
        const attribution = bundle.creator_npub
          ? { creator: bundle.creator_npub, label: bundle.label }
          : undefined;
        const rumor = buildJoinRumor(user.pubkey, Date.now(), attribution);
        const wrap = await sealGuestbook(rumor, currentGuestbookGroup(rehydrated), user.signer);
        await Promise.allSettled(
          rehydrated.relays.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(8000) })),
        );
      })().catch(() => undefined);
      return true;
    } catch {
      // Unreachable relays / revoked / expired: leave the banner up — a revoked
      // link can never heal this member, only a fresh invite can.
      return false;
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community?.idHex, community?.rootEpoch, user?.pubkey, inviteRef]);

  // Relaxed poll while stranded: the heal depends on the link's creator coming
  // online, which can happen any time — but never poll a closed banner.
  useEffect(() => {
    if (!canRecover) return;
    const timer = setInterval(() => void checkNow(), 60_000);
    return () => clearInterval(timer);
  }, [canRecover, checkNow]);

  return { canRecover, checking, checkNow };
}
