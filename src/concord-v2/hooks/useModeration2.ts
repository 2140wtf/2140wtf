import { useNostr } from "@nostrify/react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useControlFold2, citationFor, invalidateControl2, publishEdition2 } from "@/concord-v2/hooks/useControlPlane2";
import { useGuestbookPublisher2 } from "@/concord-v2/hooks/useGuestbook2";
import { useRefound2 } from "@/concord-v2/hooks/useRekey2";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { buildBanlistEdition, buildGrantEdition, hasForeignLiveLinks } from "@/concord-v2/lib/control";
import { banlistLocator, bytesToHex, grantLocator, hex32 } from "@/concord-v2/lib/derive";
import { addReadCutPending, clearReadCutPending, readCutPending } from "@/concord-v2/lib/readCutPending";
import { canActOnMember, Permissions } from "@/concord-v2/lib/roles";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { toast } from "@/hooks/useToast";

/**
 * The Three Removals, composed in the order their guarantees arrive
 * (CORD-04 §6):
 *
 *   - KICK: Role Removal (grant strip) then the cooperative Guestbook
 *     directive — polite, unenforced, re-joinable.
 *   - BAN: the Banlist edition FIRST (silencing is instant and free), the
 *     grant strip alongside, the Refounding LAST (severance is heavy and
 *     asynchronous; it propagates while the target is already silenced) —
 *     and ONLY in a Private community. A Public ban is the Banlist alone
 *     (CORD-05 §5): with live links the rotation can't sever, it only
 *     strands future link joiners on a dead epoch.
 *   - UNBAN: a Banlist edition dropping the npub (access needs a re-invite —
 *     the rotation is one-way).
 *
 * `recipients` is who should KEEP access after a ban's Refounding.
 */
/** The ban's steps, in execution order, for progress UI. */
export type BanPhase = "silence" | "roles" | "rekey";

export function useModeration2(community: CommunityV2 | undefined, recipients: string[]) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { data: folded } = useControlFold2(community);
  const guestbook = useGuestbookPublisher2(community);
  const { refound, canRefound } = useRefound2(community);

  const canActOn = (target: string, permission: bigint): boolean =>
    Boolean(user && folded && canActOnMember(folded.roster, user.pubkey, folded.ownerHex, target, permission));

  const invalidate = () => {
    if (community) {
      invalidateControl2(queryClient, community.idHex);
      queryClient.invalidateQueries({ queryKey: ["concord2", "guestbook", community.idHex] });
    }
  };

  /** Publish the whole banlist, replaced entire, chained off the held head. */
  const publishBanlist = async (banned: string[]) => {
    if (!user || !community) throw new Error("Not ready.");
    const head = folded?.heads.get(bytesToHex(banlistLocator(community.id)));
    await publishEdition2(
      nostr,
      community,
      user.signer,
      buildBanlistEdition(community.id, banned, {
        actorPubkey: user.pubkey,
        version: head ? head.version + 1n : 1n,
        prevHash: head?.hash,
        authority: citationFor(community, folded, user.pubkey),
      }),
    );
  };

  /**
   * Strip every role from a member (Role Removal). Best-effort — skipped when
   * the fold would drop it (a revoke needs MANAGE_ROLES + strict outrank,
   * CORD-04 §5; a KICK/BAN holder without it still kicks/bans, the target just
   * keeps their rank until an authorized strip lands).
   */
  const stripRoles = async (target: string) => {
    if (!user || !community) return;
    const hasGrant = folded?.roster.grants.some((g) => g.member === target && g.roleIds.length > 0);
    if (!hasGrant) return;
    if (!canActOn(target, Permissions.MANAGE_ROLES)) return;
    const head = folded?.heads.get(bytesToHex(grantLocator(community.id, hex32(target))));
    await publishEdition2(
      nostr,
      community,
      user.signer,
      buildGrantEdition(
        community.id,
        { member: target, roleIds: [] },
        {
          actorPubkey: user.pubkey,
          version: head ? head.version + 1n : 1n,
          prevHash: head?.hash,
          authority: citationFor(community, folded, user.pubkey),
        },
      ),
    ).catch(() => undefined);
  };

  const ban = useMutation<
    { rekeyed: boolean; publicBan: boolean },
    Error,
    { target: string; onPhase?: (phase: BanPhase) => void }
  >({
    mutationFn: async ({ target, onPhase }) => {
      if (!user || !community) throw new Error("Not ready.");
      if (!canActOn(target, Permissions.BAN)) throw new Error("You don't have permission to ban this member.");

      // Fail-fast BEFORE publishing anything: a rotating ban must read-cut, and
      // a rotation needs a NIP-44 signer. Publishing the banlist first would
      // leave a "banned but still readable" member with no cut coming.
      const willRotate = !!folded && !hasForeignLiveLinks(folded, user.pubkey, target);
      if (willRotate && !canRefound) {
        throw new Error(
          "Banning from a private community rotates the community keys, which your signer can't do. Ask an admin whose signer supports encryption to carry out the ban.",
        );
      }

      // 1. Banlist first: silencing is instant and free.
      onPhase?.("silence");
      const next = new Set(folded?.banned ?? []);
      next.add(target);
      await publishBanlist([...next]);

      // 2. Role removal alongside.
      onPhase?.("roles");
      await stripRoles(target);

      // 3. The Refounding last: the cryptographic severance — but never while
      // a FOREIGN live link exists (only its creator's signer_sk can refresh
      // its bundle, so a rotation would strand its future joiners on a dead
      // epoch). My own links rotate safely: the refound refreshes their
      // bundles behind the same URLs. Judged as-of after this ban: the
      // target's registry dies with their authority.
      if (folded && hasForeignLiveLinks(folded, user.pubkey, target)) return { rekeyed: false, publicBan: true };
      if (!canRefound) return { rekeyed: false, publicBan: false };
      onPhase?.("rekey");
      // Durable intent: mark BEFORE the attempt (with the keep-list captured
      // NOW, while the roster is warm and user-initiated), clear only on
      // success — a rotation lost to a relay outage is retried on the next
      // visit from this persisted list, never a cold surface's roster.
      const keep = recipients.filter((pk) => pk !== target);
      addReadCutPending(user.pubkey, community.idHex, target, keep);
      try {
        await refound({ keep, exclude: [target] });
        clearReadCutPending(user.pubkey, community.idHex);
        return { rekeyed: true, publicBan: false };
      } catch {
        return { rekeyed: false, publicBan: false };
      }
    },
    onSuccess: invalidate,
  });

  const unban = useMutation<void, Error, { target: string }>({
    mutationFn: async ({ target }) => {
      if (!canActOn(target, Permissions.BAN)) throw new Error("You don't have permission.");
      const next = new Set(folded?.banned ?? []);
      next.delete(target);
      await publishBanlist([...next]);
    },
    onSuccess: invalidate,
  });

  const kick = useMutation<void, Error, { target: string }>({
    mutationFn: async ({ target }) => {
      if (!community || !user) throw new Error("Not ready.");
      if (!canActOn(target, Permissions.KICK)) throw new Error("You don't have permission to kick this member.");
      // Strip first, so the target's rank is gone before the departure lands.
      await stripRoles(target);
      const citation = citationFor(community, folded, user.pubkey);
      await guestbook.mutateAsync({
        type: "kick",
        target,
        vac: citation
          ? { eid: bytesToHex(citation.entityId), version: citation.version, hash: bytesToHex(citation.editionHash) }
          : undefined,
      });
    },
    onSuccess: invalidate,
  });

  return {
    banned: folded?.banned ?? new Set<string>(),
    canRekey: canRefound,
    ban: ban.mutateAsync,
    isBanning: ban.isPending,
    unban: unban.mutateAsync,
    kick: kick.mutateAsync,
    isKicking: kick.isPending,
    canBan: (target: string) => canActOn(target, Permissions.BAN),
    canKick: (target: string) => canActOn(target, Permissions.KICK),
  };
}

/**
 * Retry an outstanding read-cut once per community visit — the durable half of
 * a rotating ban's severance (a Refounding lost to a relay outage). Mount ONCE
 * per community (ConcordV2Page), never from a roster-less surface: the retry
 * rotates from the keep-list PERSISTED at ban time, so a cold page can't sever
 * live members by rebuilding a thin recipient set.
 *
 * Moot (and cleared) if a foreign live link has since appeared — rotating then
 * would strand its joiners. Serialized against a user-initiated ban's refound
 * via the shared mutation scope, and skipped outright while one is in flight.
 */
export function useReadCutRetry2(community: CommunityV2 | undefined): void {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { data: folded } = useControlFold2(community);
  const { refound, canRefound } = useRefound2(community);
  const refoundsInFlight = useIsMutating({ mutationKey: ["concord2-refound", community?.idHex] });
  const retried = useRef(false);

  useEffect(() => {
    if (retried.current || !user || !community || !folded || !canRefound) return;
    if (refoundsInFlight > 0) return; // a user ban is mid-rotation — let it finish
    const pending = readCutPending(user.pubkey, community.idHex);
    if (!pending) return;
    retried.current = true;
    if (hasForeignLiveLinks(folded, user.pubkey)) {
      clearReadCutPending(user.pubkey, community.idHex);
      return;
    }
    refound({ keep: pending.keep, exclude: pending.targets })
      .then(() => {
        clearReadCutPending(user.pubkey, community.idHex);
        if (community) invalidateControl2(queryClient, community.idHex);
        toast({ title: "Key rotation completed", description: "An earlier ban's key rotation has now finished." });
      })
      .catch(() => {
        // Still failing — retry again next visit.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, community, folded, canRefound, refoundsInFlight]);
}
