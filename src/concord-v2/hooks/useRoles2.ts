import { useNostr } from "@nostrify/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useControlFold2, citationFor, invalidateControl2, publishEdition2 } from "@/concord-v2/hooks/useControlPlane2";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { buildGrantEdition, buildMetadataEdition, buildRoleEdition } from "@/concord-v2/lib/control";
import { bytesToHex, grantLocator, hex32, random32 } from "@/concord-v2/lib/derive";
import { adminRole, canActOnMember, canActOnPosition, emptyRoles, moderatorRole, Permissions, type MemberGrant, type Role } from "@/concord-v2/lib/roles";
import type { CommunityMetadata, CommunityV2, ImagePointer } from "@/concord-v2/lib/types";

/**
 * Metadata mutations (vsk 0, MANAGE_METADATA): edit name / description /
 * icon / banner / relays, version-chained off the held head. Unknown fields
 * (`custom`, vendor extensions) round-trip untouched (CORD-02 §6).
 */
export function useMetadataActions2(community: CommunityV2 | undefined) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { data: folded } = useControlFold2(community);

  const updateMetadata = useMutation<
    void,
    Error,
    { name?: string; description?: string; icon?: ImagePointer | null; banner?: ImagePointer | null; relays?: string[] }
  >({
    mutationFn: async (patch) => {
      if (!user || !community) throw new Error("Not ready.");
      const current: CommunityMetadata =
        folded?.metadata ?? ({ name: community.name, relays: community.relays } as CommunityMetadata);

      const next: CommunityMetadata = { ...current }; // round-trips unknown fields
      if (patch.name !== undefined) next.name = patch.name.trim();
      if (patch.description !== undefined) next.description = patch.description.trim() || undefined;
      if (patch.icon !== undefined) next.icon = patch.icon ?? undefined;
      if (patch.banner !== undefined) next.banner = patch.banner ?? undefined;
      if (patch.relays !== undefined) next.relays = patch.relays;

      // A relay-list change fans out to old ∪ new: members still folding from
      // the old relays must see the edition that moves them.
      const publishRelays =
        patch.relays !== undefined ? [...new Set([...community.relays, ...patch.relays])] : undefined;

      const head = folded?.heads.get(community.idHex);
      await publishEdition2(
        nostr,
        community,
        user.signer,
        buildMetadataEdition(community.id, next, {
          actorPubkey: user.pubkey,
          version: head ? head.version + 1n : 1n,
          prevHash: head?.hash,
          authority: citationFor(community, folded, user.pubkey),
        }),
        publishRelays ? { relays: publishRelays } : undefined,
      );
      invalidateControl2(queryClient, community.idHex);
    },
  });

  return {
    metadata: folded?.metadata,
    updateMetadata: updateMetadata.mutateAsync,
    isUpdating: updateMetadata.isPending,
  };
}

/**
 * Roster mutations (vsk 1 Roles + vsk 3 Grants, MANAGE_ROLES): every member's
 * fold re-verifies the owner-rooted delegation chain, so a forged grant is
 * dropped network-wide.
 */
export function useRoles2(community: CommunityV2 | undefined) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { data: folded, isLoading } = useControlFold2(community);

  const invalidate = () => {
    if (community) invalidateControl2(queryClient, community.idHex);
  };

  const grantHeadOf = (member: string) =>
    community ? folded?.heads.get(bytesToHex(grantLocator(community.id, hex32(member)))) : undefined;

  /** The stock Admin role id in the current roster, if one exists. */
  const adminRoleId = folded?.roster.roles.find((r) => r.name === "Admin")?.roleId;
  /** The stock Moderator role id in the current roster, if one exists. */
  const moderatorRoleId = folded?.roster.roles.find((r) => r.name === "Moderator")?.roleId;

  const saveRole = useMutation<string, Error, { role: Role }>({
    mutationFn: async ({ role }) => {
      if (!user || !community) throw new Error("Not ready.");
      const head = folded?.heads.get(role.roleId);
      await publishEdition2(
        nostr,
        community,
        user.signer,
        buildRoleEdition(role, {
          actorPubkey: user.pubkey,
          version: head ? head.version + 1n : 1n,
          prevHash: head?.hash,
          authority: citationFor(community, folded, user.pubkey),
        }),
      );
      return role.roleId;
    },
    onSuccess: invalidate,
  });

  const setMemberRoles = useMutation<void, Error, { member: string; roleIds: string[] }>({
    mutationFn: async ({ member, roleIds }) => {
      if (!user || !community) throw new Error("Not ready.");
      const head = grantHeadOf(member);
      const grant: MemberGrant = { member, roleIds };
      await publishEdition2(
        nostr,
        community,
        user.signer,
        buildGrantEdition(community.id, grant, {
          actorPubkey: user.pubkey,
          version: head ? head.version + 1n : 1n,
          prevHash: head?.hash,
          authority: citationFor(community, folded, user.pubkey),
        }),
      );
    },
    onSuccess: invalidate,
  });

  /**
   * Promote/demote a member to a stock tier: "admin" (position 1, owner-grantable
   * only), "moderator" (position 2, grantable by any strict outranker holding
   * MANAGE_ROLES), or null (revoke — an empty grant). Pre-checks the same
   * authority rules every fold enforces (CORD-04 §3), so an action a verifier
   * would drop fails HERE with a readable error instead of publishing a grant
   * the whole network silently discards.
   */
  const setTier = useMutation<void, Error, { member: string; tier: "admin" | "moderator" | null }>({
    mutationFn: async ({ member, tier }) => {
      if (!user || !community) throw new Error("Not ready.");
      const ownerHex = folded?.ownerHex ?? community.owner;
      const roster = folded?.roster ?? emptyRoles();

      // The fold's gate, applied up-front: changing someone's roles means
      // acting on them (strict outrank), and granting a role means outranking
      // the position it sits at.
      if (!canActOnMember(roster, user.pubkey, ownerHex, member, Permissions.MANAGE_ROLES)) {
        throw new Error("You don't outrank this member.");
      }
      const minted = tier === "admin" ? adminRole(bytesToHex(random32())) : tier === "moderator" ? moderatorRole(bytesToHex(random32())) : undefined;
      if (minted && !canActOnPosition(roster, user.pubkey, ownerHex, minted.position, Permissions.MANAGE_ROLES)) {
        throw new Error(tier === "admin" ? "Only the owner can grant Admin." : "You can't grant a role at this rank.");
      }

      // Ensure the stock role exists (mint + publish if absent).
      let roleId: string | undefined;
      if (minted) {
        roleId = tier === "admin" ? adminRoleId : moderatorRoleId;
        if (!roleId) {
          roleId = minted.roleId;
          await publishEdition2(
            nostr,
            community,
            user.signer,
            buildRoleEdition(minted, {
              actorPubkey: user.pubkey,
              version: 1n,
              authority: citationFor(community, folded, user.pubkey),
            }),
          );
        }
      }

      const head = grantHeadOf(member);
      const grant: MemberGrant = { member, roleIds: roleId ? [roleId] : [] };
      await publishEdition2(
        nostr,
        community,
        user.signer,
        buildGrantEdition(community.id, grant, {
          actorPubkey: user.pubkey,
          version: head ? head.version + 1n : 1n,
          prevHash: head?.hash,
          authority: citationFor(community, folded, user.pubkey),
        }),
      );
    },
    onSuccess: invalidate,
  });

  return {
    folded,
    isLoading,
    setTier: setTier.mutateAsync,
    isSettingTier: setTier.isPending,
    saveRole: saveRole.mutateAsync,
    isSavingRole: saveRole.isPending,
    setMemberRoles: setMemberRoles.mutateAsync,
    isSettingRoles: setMemberRoles.isPending,
    newRoleId: () => bytesToHex(random32()),
  };
}
