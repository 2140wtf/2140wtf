import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useControlFold2, citationFor, invalidateControl2, publishEdition2 } from "@/concord-v2/hooks/useControlPlane2";
import { useCommunity2 } from "@/concord-v2/hooks/useCommunityList2";
import { resolveBundle } from "@/concord-v2/hooks/useCommunityActions2";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { buildRegistryEdition } from "@/concord-v2/lib/control";
import { isAuthorized, Permissions } from "@/concord-v2/lib/roles";
import { bytesToHex, grantLocator, hexToBytes, inviteLinksLocator, hex32 } from "@/concord-v2/lib/derive";
import {
  buildDirectInviteRumor,
  sealDirectInvite,
  wrapDirectInvite,
} from "@/concord-v2/lib/directInvite";
import {
  buildBundleEvent,
  buildInviteUrl,
  buildRevocationEvent,
  EMPTY_INVITE_LIST,
  inviteCommitment,
  mergeInviteLists,
  mintLinkSigner,
  mintToken,
  parseInviteLink,
  type InviteBundle,
  type InviteList,
} from "@/concord-v2/lib/invite";
import { singleUseLinkUsed } from "@/concord-v2/lib/guestbook";
import { useGuestbook2 } from "@/concord-v2/hooks/useGuestbook2";
import { KIND_INVITE_LIST } from "@/concord-v2/lib/kinds";
import { inviteDeliveryRelays, recipientInboxRelays } from "@/concord-v2/lib/inviteRelays";
import { toast } from "@/hooks/useToast";
import { shareOrigin } from "@/lib/shareOrigin";
import type { CommunityV2 } from "@/concord-v2/lib/types";

import type { NostrEvent } from "@nostrify/nostrify";
import type { NUser } from "@nostrify/react/login";

/**
 * The creator's Invite List (kind 13303, CORD-05 §4): private bookkeeping for
 * minted links — the unlock token AND the link-signer secret live here, synced
 * across the creator's devices, NIP-44-encrypted to self.
 */
const inviteListKey = (pubkey: string | undefined) => ["concord2", "invite-list", pubkey] as const;

async function readInviteList(
  event: NostrEvent | null,
  signer: NUser["signer"],
  selfPubkey: string,
): Promise<InviteList | null> {
  if (!event?.content || !signer.nip44) return null;
  try {
    const decrypted = await signer.nip44.decrypt(selfPubkey, event.content);
    const parsed = JSON.parse(decrypted) as Partial<InviteList>;
    return {
      ...parsed,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
    } as InviteList;
  } catch {
    return null;
  }
}

/**
 * Fetch and decrypt the user's Invite List, MERGING every copy the pool
 * returns rather than trusting a single newest event: tombstones union and win
 * terminally (CORD-05 §4), so a relay whose "newest" copy predates another
 * device's revocation can never resurrect the revoked link. Also returns the
 * newest `created_at` seen, for replaceable-event monotonicity on write.
 */
export async function fetchInviteList(
  nostr: ReturnType<typeof useNostr>["nostr"],
  user: NUser,
  signal?: AbortSignal,
): Promise<{ list: InviteList; newestCreatedAt: number }> {
  const events = await nostr.query(
    [{ kinds: [KIND_INVITE_LIST], authors: [user.pubkey], limit: 1 }],
    { signal: signal ?? AbortSignal.timeout(8000) },
  );
  let list = EMPTY_INVITE_LIST;
  let newestCreatedAt = 0;
  // Oldest → newest, so the newest copy's unknown top-level fields win the merge.
  for (const event of events.sort((a, b) => a.created_at - b.created_at)) {
    // Monotonicity counts EVERY copy, even an undecryptable one: a relay keeps
    // only the newest replaceable per author, so a rewrite must outbid
    // whatever sits there, readable or not.
    newestCreatedAt = Math.max(newestCreatedAt, event.created_at);
    const copy = await readInviteList(event, user.signer, user.pubkey);
    if (!copy) continue;
    list = mergeInviteLists(list, copy);
  }
  return { list, newestCreatedAt };
}

export function useInviteList2() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery<InviteList>({
    queryKey: inviteListKey(user?.pubkey),
    enabled: Boolean(user?.signer.nip44),
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { list } = await fetchInviteList(nostr, user!, AbortSignal.any([signal, AbortSignal.timeout(8000)]));
      return list;
    },
  });
}

/**
 * The epoch each of my live links CURRENTLY vends, keyed by token (CORD-05 §2).
 * A link's coordinate is re-posted on rekey, so its bundle's `root_epoch` may
 * lag the community while the creator hasn't refreshed it (offline during a
 * rotation, a non-NIP-44 signer, etc.) — comparing this against the community's
 * live `rootEpoch` is how the UI flags a link a fresh joiner would land behind.
 * Best-effort per link: an unresolvable link (revoked/expired/offline relay) is
 * simply absent from the map rather than failing the whole query.
 */
export function useMyLinkEpochs2(community: CommunityV2 | undefined) {
  const { nostr } = useNostr();
  const inviteList = useInviteList2();

  const links = (inviteList.data?.entries ?? []).filter((e) => e.community_id === community?.idHex);

  return useQuery<Record<string, number>>({
    queryKey: ["concord2", "invite-epochs", community?.idHex, links.map((e) => e.token).sort()],
    enabled: Boolean(community && links.length > 0),
    staleTime: 60_000,
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all(
        links.map(async (e) => {
          const parsed = parseInviteLink(e.url);
          if (!parsed) return;
          try {
            const bundle = await resolveBundle(nostr, parsed, community!.relays);
            if (typeof bundle.root_epoch === "number") out[e.token] = bundle.root_epoch;
          } catch {
            // Revoked/expired/offline: leave it absent (no notice, not "behind").
          }
        }),
      );
      return out;
    },
  });
}

/** Read-merge-write the Invite List (serialized on one scope). */
function useUpdateInviteList2() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMutation({
    scope: { id: "concord2-invite-list" },
    mutationFn: async (patch: InviteList) => {
      if (!user?.signer.nip44) throw new Error("NIP-44 unsupported.");
      const { list: remote, newestCreatedAt } = await fetchInviteList(nostr, user);
      const cached = queryClient.getQueryData<InviteList>(inviteListKey(user.pubkey)) ?? EMPTY_INVITE_LIST;
      const next = mergeInviteLists(mergeInviteLists(remote, cached), patch);

      const createdAt = Math.max(Math.floor(Date.now() / 1000), newestCreatedAt + 1);
      const content = await user.signer.nip44.encrypt(user.pubkey, JSON.stringify(next));
      const event = await user.signer.signEvent({ kind: KIND_INVITE_LIST, content, tags: [], created_at: createdAt });
      queryClient.setQueryData(inviteListKey(user.pubkey), next);
      await nostr.event(event, { signal: AbortSignal.timeout(8000) });
      return next;
    },
  });
}


/**
 * Invite actions for one community (CORD-05) — public links + direct handoffs:
 *
 *   - MINT: fresh 16-byte token + fresh link-signer keypair; the encrypted
 *     bundle posts at `(33301, link_signer, d="")` on the community's relays;
 *     the link is `<base>/invite/<naddr>#<fragment>`; the Invite List records
 *     the secrets; the member-facing Registry (vsk 8) lists the coordinate.
 *   - REVOKE: the coordinate is re-posted as a tombstone (creator-only — needs
 *     the link-signer secret), the Registry drops it, the Invite List
 *     tombstones it. Retiring the last live link is what flips the Community
 *     back to Private.
 *   - DIRECT: the bundle giftwraps straight to a known npub (CORD-05 §6) —
 *     no link, no Registry entry, nothing revocable, never flips Public.
 */
export function useInviteActions2(community: CommunityV2 | undefined) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { data: folded } = useControlFold2(community);
  const inviteList = useInviteList2();
  const { mutateAsync: updateInviteList } = useUpdateInviteList2();
  // The freshest membership snapshot from the live Community List vault. The
  // `community` prop is a memoized snapshot that can lag a just-adopted rekey
  // (staleTime/poll/render windows), and a bundle minted from a stale snapshot
  // would embed an OLD epoch — the exact defect that strands a fresh joiner on
  // a dead epoch (CORD-05 §2 requires the CURRENT keys). Reconcile against this.
  const fresh = useCommunity2(community?.idHex);

  /**
   * The community to mint a bundle from: whichever of the caller's snapshot and
   * the live-list entry holds the HIGHER epoch. Monotonic — never mints below
   * what either source knows, so a lagging snapshot can't emit a stale bundle.
   */
  const bundleSource = (): CommunityV2 | undefined => {
    if (!community) return fresh;
    if (!fresh) return community;
    return fresh.rootEpoch > community.rootEpoch ? fresh : community;
  };

  /** The §1 CommunityInvite bundle: everything membership is (link + direct alike). */
  const buildBundle = (opts?: { expiresAtMs?: number; label?: string; maxUses?: number }): InviteBundle => {
    if (!user) throw new Error("Not ready.");
    const src = bundleSource();
    if (!src) throw new Error("Not ready.");
    return {
      community_id: src.idHex,
      owner: src.owner,
      owner_salt: bytesToHex(src.ownerSalt),
      community_root: bytesToHex(src.root),
      root_epoch: Number(src.rootEpoch),
      channels: src.privateChannels.map((ch) => ({
        id: bytesToHex(ch.id),
        key: bytesToHex(ch.key),
        epoch: Number(ch.epoch),
        name: ch.name,
      })),
      relays: src.relays,
      name: folded?.metadata?.name ?? src.name,
      ...(folded?.metadata?.icon ? { icon: folded.metadata.icon } : {}),
      ...(opts?.expiresAtMs ? { expires_at: opts.expiresAtMs } : {}),
      ...(opts?.maxUses ? { max_uses: opts.maxUses } : {}),
      creator_npub: user.pubkey,
      ...(opts?.label ? { label: opts.label } : {}),
    };
  };

  /** Link-signer pubkeys of MY expired links for this community. */
  const myExpiredSigners = (): Set<string> => {
    const out = new Set<string>();
    const now = Math.floor(Date.now() / 1000);
    for (const e of inviteList.data?.entries ?? []) {
      if (e.community_id !== community?.idHex || !e.expires_at || e.expires_at > now) continue;
      const p = parseInviteLink(e.url);
      if (p) out.add(p.linkSigner);
    }
    return out;
  };

  /**
   * Publish this creator's registry (vsk 8) with the given live link set.
   * Expired links are pruned first: they can't be joined, so they must not
   * keep the community reading Public (CORD-05 §5).
   */
  const publishRegistry = async (linkSigners: string[]) => {
    if (!user || !community) return;
    const expired = myExpiredSigners();
    const live = linkSigners.filter((s) => !expired.has(s));
    const eid = bytesToHex(inviteLinksLocator(community.id, hex32(user.pubkey)));
    const head = folded?.heads.get(eid);
    await publishEdition2(
      nostr,
      community,
      user.signer,
      buildRegistryEdition(community.id, user.pubkey, live, {
        actorPubkey: user.pubkey,
        version: head ? head.version + 1n : 1n,
        prevHash: head?.hash,
        authority: citationFor(community, folded, user.pubkey),
      }),
    ).catch(() => undefined);
    invalidateControl2(queryClient, community.idHex);
  };

  const createLink = useMutation<string, Error, { expiresAtMs?: number; label?: string; maxUses?: number }>({
    mutationFn: async ({ expiresAtMs, label, maxUses }) => {
      if (!user || !community) throw new Error("Not ready.");
      if (!user.signer.nip44) throw new Error("This signer can't mint invite links (NIP-44 unsupported).");

      // Warn (don't refuse — localhost/LAN quickstarts are a supported flow)
      // when the invite will embed relays that secure platforms can't reach:
      // Android/desktop builds run on a secure origin where ws:// is blocked
      // as mixed content, so an all-ws:// community is dead for them (#47).
      const insecure = community.relays.filter((url) => !/^wss:\/\//i.test(url));
      if (insecure.length > 0) {
        const fatal = insecure.length === community.relays.length;
        toast({
          title: fatal ? "This invite won't work on mobile" : "Some relays won't work on mobile",
          description:
            `${insecure.join(", ")} ${insecure.length === 1 ? "is" : "are"} not wss:// — ` +
            `mobile and desktop apps can't connect to insecure relays` +
            (fatal ? ", so members joining from them won't be able to participate at all." : "."),
          variant: fatal ? "destructive" : undefined,
        });
      }

      const token = mintToken();
      const link = mintLinkSigner();
      const bundle = buildBundle({ expiresAtMs, label, maxUses });

      const bundleEvent = buildBundleEvent(bundle, token, link.sk);
      const results = await Promise.allSettled(
        community.relays.map((url) => nostr.relay(url).event(bundleEvent, { signal: AbortSignal.timeout(15_000) })),
      );
      if (!results.some((r) => r.status === "fulfilled")) {
        throw new Error(`Couldn't reach any of the community's ${community.relays.length} relays — check your connection and retry.`);
      }

      const url = buildInviteUrl(shareOrigin(), link.pk, token, community.relays);

      // The creator's private bookkeeping (the merge key is the token).
      await updateInviteList({
        entries: [
          {
            token: bytesToHex(token),
            signer_sk: bytesToHex(link.sk),
            community_id: community.idHex,
            url,
            ...(label ? { label } : {}),
            created_at: Math.floor(Date.now() / 1000),
            ...(expiresAtMs ? { expires_at: Math.floor(expiresAtMs / 1000) } : {}),
            ...(maxUses ? { max_uses: maxUses } : {}),
          },
        ],
        tombstones: [],
      });

      // The member-facing Registry: this creator's live coordinates.
      const mine = new Set(folded?.registriesByCreator.get(user.pubkey) ?? []);
      mine.add(link.pk);
      await publishRegistry([...mine]);

      return url;
    },
  });

  const revokeLink = useMutation<void, Error, { url: string }>({
    mutationFn: async ({ url }) => {
      if (!user || !community) throw new Error("Not ready.");
      const parsed = parseInviteLink(url);
      if (!parsed) throw new Error("Not a recognizable invite link.");

      // The signer secret lives in the Invite List (only the creator holds it).
      const entry = inviteList.data?.entries.find(
        (e) => e.community_id === community.idHex && parseInviteLink(e.url)?.linkSigner === parsed.linkSigner,
      );
      if (!entry) throw new Error("This device doesn't hold that link's signing secret.");

      const tomb = buildRevocationEvent(hexToBytes(entry.signer_sk));
      const results = await Promise.allSettled(
        community.relays.map((relay) => nostr.relay(relay).event(tomb, { signal: AbortSignal.timeout(15_000) })),
      );
      if (!results.some((r) => r.status === "fulfilled")) {
        throw new Error(`Couldn't reach any of the community's ${community.relays.length} relays — check your connection and retry.`);
      }

      await updateInviteList({
        entries: [],
        tombstones: [{ token: entry.token, community_id: community.idHex }],
      });

      const mine = new Set(folded?.registriesByCreator.get(user.pubkey) ?? []);
      mine.delete(parsed.linkSigner);
      await publishRegistry([...mine]);
    },
  });

  /**
   * Hand the keys straight to an npub (CORD-05 §6): the same §1 bundle, sealed
   * by the sender's REAL key (the seal's verified npub is what proves who
   * invited them) inside an ephemeral, `k`-tagged giftwrap the recipient can
   * look up indexed. No coordinate, no token, no Registry entry — a Direct
   * Invite never flips the community Public, which is what lets a Private
   * community grow one npub at a time. Unrevocable once landed.
   */
  const sendDirectInvite = useMutation<void, Error, { recipientPubkey: string; expiresAtMs?: number }>({
    mutationFn: async ({ recipientPubkey, expiresAtMs }) => {
      if (!user || !community) throw new Error("Not ready.");
      if (!user.signer.nip44) throw new Error("This signer can't send direct invites (NIP-44 unsupported).");

      const bundle = buildBundle({ expiresAtMs });
      const rumor = buildDirectInviteRumor(bundle, user.pubkey);
      const seal = await sealDirectInvite(rumor, recipientPubkey, user.signer);
      const wrap = wrapDirectInvite(seal, recipientPubkey, { expiresAtMs });

      // Deliver to the recipient's giftwrap inbox (their 10050 DM relays, else
      // NIP-65 reads), or the stock interop floor when they've published
      // neither — the same set their own scanner resolves (CORD-05 §6).
      const inbox = await recipientInboxRelays(nostr, recipientPubkey);
      // A FAILED inbox lookup is not "no list": falling back to stock here would
      // silently misdeliver a list-having recipient's invite (and report
      // success). Fail loudly so the user retries once the network settles.
      if (inbox === null) throw new Error("Couldn't reach the network to send the invite. Please try again.");
      const relays = inviteDeliveryRelays(inbox);
      const results = await Promise.allSettled(
        relays.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(8000) })),
      );
      if (!results.some((r) => r.status === "fulfilled")) {
        throw new Error("No relay accepted the invite.");
      }
    },
  });

  /** This creator's live links for THIS community (from the private list). */
  const myLinks = (inviteList.data?.entries ?? []).filter((e) => e.community_id === community?.idHex);

  /**
   * Whether revoking this link would empty the aggregate live-link set,
   * flipping the community Private (CORD-05 §2): the caller should warn
   * before crossing that line, since bans start rotating keys past it.
   */
  const revokeWouldPrivatize = (url: string): boolean => {
    const parsed = parseInviteLink(url);
    if (!parsed || !folded || folded.liveInviteLinks.size === 0) return false;
    const remaining = new Set(folded.liveInviteLinks);
    remaining.delete(parsed.linkSigner);
    return remaining.size === 0;
  };

  return {
    createLink: createLink.mutateAsync,
    isCreatingLink: createLink.isPending,
    revokeLink: revokeLink.mutateAsync,
    isRevoking: revokeLink.isPending,
    sendDirectInvite: sendDirectInvite.mutateAsync,
    isSendingInvite: sendDirectInvite.isPending,
    myLinks,
    /** Whether ANY live public link exists — the community's Public/Private flag. */
    isPublic: (folded?.liveInviteLinks.size ?? 0) > 0,
    revokeWouldPrivatize,
  };
}

/**
 * Honest-client compliance: revoke MY OWN live links when I no longer hold
 * CREATE_INVITE.
 *
 * The Registry fold already stops honoring a stripped creator's links (the
 * community reads Private, CORD-05 §5) — but the BUNDLE keeps vending keys at
 * its coordinate, and only this creator's `signer_sk` can tombstone it. An
 * owner stripping the permission flips the flag; this watcher is the only
 * thing that can close the door. Mirrors banlist self-removal: authority
 * decided, my client complies.
 *
 * The action is destructive and irreversible (a tombstone kills a shared URL),
 * so it fires only on POSITIVE evidence of a strip, never on authority absence:
 * a genuine strip folds a revoke edition at my grant coordinate, while a cold
 * device or a relay gap folds nothing there. Requiring my grant HEAD present
 * (on a settled fold) distinguishes "demoted" from "not yet synced."
 */
export function useLinkAuthorityWatch2(community: CommunityV2 | undefined): void {
  const { user } = useCurrentUser();
  const control = useControlFold2(community);
  const folded = control.data;
  const { myLinks, revokeLink } = useInviteActions2(community);
  // Guards only the in-flight revoke per link; a failure retries on the next
  // fold/list change.
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!user || !community || !folded || myLinks.length === 0) return;
    if (control.isLoading || control.isFetching) return; // an in-flight fold under-authorizes
    if (user.pubkey === folded.ownerHex) return; // the owner is always authorized
    if (isAuthorized(folded.roster, user.pubkey, folded.ownerHex, Permissions.CREATE_INVITE)) return;
    // Positive-evidence gate: my grant must actually be in the fold (a strip
    // folds a revoke edition here; a sync gap folds nothing). Without it, a
    // partial fold's authority-absence would wrongly tombstone live links.
    if (!folded.heads.has(bytesToHex(grantLocator(community.id, hex32(user.pubkey))))) return;
    for (const entry of myLinks) {
      if (handled.current.has(entry.token)) continue;
      handled.current.add(entry.token);
      revokeLink({ url: entry.url }).catch(() => {
        handled.current.delete(entry.token);
      });
    }
  }, [user, community, folded, control.isLoading, control.isFetching, myLinks, revokeLink]);
}

/**
 * Single-use sweeper (CORD-05 §2): auto-revoke MY single-use links the moment
 * the Guestbook shows a Join citing their token commitment. Serverless
 * "one-time link": honest joiners already refuse a spent link (the join path
 * checks the same commitment), and this closes the bundle itself so the link
 * stops vending keys even to dishonest ones — while this device is online.
 * Neither is a hard boundary against someone who resolved the bundle earlier;
 * a key rotation is. Only the creator's device can run it (it holds the
 * link-signer secret in the Invite List).
 */
export function useSingleUseSweep2(community: CommunityV2 | undefined): void {
  const { user } = useCurrentUser();
  const inviteList = useInviteList2();
  const { data: opened } = useGuestbook2(community);
  const { revokeLink } = useInviteActions2(community);
  // Guards only the in-flight revoke per link; a failure retries on the next
  // guestbook/list change.
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!user || !community || !opened || opened.length === 0) return;
    const singles = (inviteList.data?.entries ?? []).filter(
      (e) => e.community_id === community.idHex && e.max_uses === 1,
    );
    for (const entry of singles) {
      if (handled.current.has(entry.token)) continue;
      let used = false;
      try {
        used = singleUseLinkUsed(opened, inviteCommitment(hexToBytes(entry.token)));
      } catch {
        continue; // a malformed stored entry can't be swept; skip it
      }
      if (!used) continue;
      handled.current.add(entry.token);
      revokeLink({ url: entry.url })
        .then(() => {
          toast({
            title: "Single-use link spent",
            description: entry.label
              ? `"${entry.label}" was used to join and has auto-revoked.`
              : "Your single-use invite link was used to join and has auto-revoked.",
          });
        })
        .catch(() => {
          handled.current.delete(entry.token);
        });
    }
  }, [user, community, opened, inviteList.data, revokeLink]);
}
