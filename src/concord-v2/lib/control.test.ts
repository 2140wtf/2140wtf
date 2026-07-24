import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey } from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import {
  buildBanlistEdition,
  buildChannelEdition,
  buildGrantEdition,
  buildMetadataEdition,
  buildRegistryEdition,
  buildRoleEdition,
  foldControlState,
  hasForeignLiveLinks,
  isCommunityPublic,
  isDissolved,
  openControlWraps,
  sealDissolved,
  sealEdition,
} from "@/concord-v2/lib/control";
import { bytesToHex, communityIdOf, controlGroupKey, grantLocator, hex32, random32, type GroupKey } from "@/concord-v2/lib/derive";
import { rewrapSeal, sealRumor, wrapSeal, type Rumor } from "@/concord-v2/lib/stream";
import { KIND_SEAL_ENCRYPTED, KIND_SEAL_PLAINTEXT } from "@/concord-v2/lib/kinds";
import { adminRole, badgeOf, hasPermission, isAdmin, moderatorRole, Permissions, type Role } from "@/concord-v2/lib/roles";

function signer(sk = generateSecretKey()) {
  return { sk, pubkey: getPublicKey(sk), signEvent: async (t: EventTemplate) => finalizeEvent(t, sk) };
}

async function makeCommunity() {
  const owner = signer();
  const ownerSalt = random32();
  const communityId = communityIdOf(hex32(owner.pubkey), ownerSalt);
  const root = random32();
  const control = controlGroupKey(root, communityId, 0);
  return { owner, ownerSalt, communityId, root, control };
}

/**
 * Mint a real edition plus a same-version fork whose rumor id undercuts it —
 * the fold's equal-version tiebreak (lower rumor id) is grindable via
 * created_at, which is exactly what a forger would do to evict the real
 * edition. (Two-sided so a pathologically low real id can't stall the mine.)
 */
async function grindFork(
  control: GroupKey,
  real: { build: (createdAtSecs: number) => Rumor; by: ReturnType<typeof signer> },
  forged: { build: (createdAtSecs: number) => Rumor; by: ReturnType<typeof signer> },
): Promise<{ realWrap: NostrEvent; forgedWrap: NostrEvent }> {
  let t = 1_800_000_000;
  for (;;) {
    const realWrap = await sealEdition(real.build(t++), control, real.by);
    const [realP] = openControlWraps([realWrap], [control]);
    const realId = bytesToHex(realP.rumorId);
    for (let i = 0; i < 8; i++) {
      const forgedWrap = await sealEdition(forged.build(t++), control, forged.by);
      const [forgedP] = openControlWraps([forgedWrap], [control]);
      if (bytesToHex(forgedP.rumorId) < realId) return { realWrap, forgedWrap };
    }
  }
}

describe("control plane fold (CORD-04)", () => {
  it("folds the genesis metadata + #general channel", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const channelId = random32();

    const wraps: NostrEvent[] = [
      await sealEdition(
        buildMetadataEdition(communityId, { name: "Vector", relays: ["wss://a.example"] }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      ),
      await sealEdition(
        buildChannelEdition(channelId, { name: "general", private: false }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      ),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(folded.metadata?.name).toBe("Vector");
    expect(folded.channels.get(bytesToHex(channelId))?.name).toBe("general");
    expect(folded.channels.get(bytesToHex(channelId))?.isPrivate).toBe(false);
  });

  it("admits an admin's edits only through an owner-rooted grant", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const admin = signer();
    const stranger = signer();

    const role = adminRole(bytesToHex(random32()));
    const grantWrap = await sealEdition(
      buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [role.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
      control,
      owner,
    );
    // The admin must CITE the grant it acts under (CORD-04 §5 `vac`).
    const [grantParsed] = openControlWraps([grantWrap], [control]);
    const wraps: NostrEvent[] = [
      await sealEdition(buildRoleEdition(role, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      grantWrap,
      // The admin (MANAGE_METADATA holder) renames the community — honored,
      // because it cites its owner-rooted grant.
      await sealEdition(
        buildMetadataEdition(communityId, { name: "Renamed", relays: [] }, {
          actorPubkey: admin.pubkey,
          version: 1n,
          authority: { entityId: grantParsed.entityId, version: 1n, editionHash: grantParsed.selfHash },
        }),
        control,
        admin,
      ),
      // A stranger grants themselves a role — dropped (not owner-rooted).
      await sealEdition(
        buildGrantEdition(communityId, { member: stranger.pubkey, roleIds: [role.roleId] }, { actorPubkey: stranger.pubkey, version: 2n }),
        control,
        stranger,
      ),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(isAdmin(folded.roster, admin.pubkey)).toBe(true);
    expect(hasPermission(folded.roster, stranger.pubkey, Permissions.MANAGE_ROLES)).toBe(false);
    expect(folded.metadata?.name).toBe("Renamed");
  });

  it("drops a non-owner action with a MISSING or FORGED authority citation (CORD-04 §5 vac)", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const admin = signer();
    const role = adminRole(bytesToHex(random32()));
    const grantWrap = await sealEdition(
      buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [role.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
      control,
      owner,
    );
    const [grantParsed] = openControlWraps([grantWrap], [control]);
    const roleWrap = await sealEdition(buildRoleEdition(role, { actorPubkey: owner.pubkey, version: 1n }), control, owner);

    // (a) No citation at all → parked.
    const noCite = await sealEdition(
      buildMetadataEdition(communityId, { name: "NoCite", relays: [] }, { actorPubkey: admin.pubkey, version: 1n }),
      control,
      admin,
    );
    expect(
      foldControlState(openControlWraps([roleWrap, grantWrap, noCite], [control]), communityId, owner.pubkey).metadata?.name,
    ).not.toBe("NoCite");

    // (b) Forged hash for the (real) grant → parked.
    const forgedHash = await sealEdition(
      buildMetadataEdition(communityId, { name: "ForgedHash", relays: [] }, {
        actorPubkey: admin.pubkey,
        version: 1n,
        authority: { entityId: grantParsed.entityId, version: 1n, editionHash: random32() },
      }),
      control,
      admin,
    );
    expect(
      foldControlState(openControlWraps([roleWrap, grantWrap, forgedHash], [control]), communityId, owner.pubkey).metadata?.name,
    ).not.toBe("ForgedHash");

    // (c) Cites a grant version that never resolves (v5, only v1 present) → parked.
    const unresolved = await sealEdition(
      buildMetadataEdition(communityId, { name: "Unresolved", relays: [] }, {
        actorPubkey: admin.pubkey,
        version: 1n,
        authority: { entityId: grantParsed.entityId, version: 5n, editionHash: grantParsed.selfHash },
      }),
      control,
      admin,
    );
    expect(
      foldControlState(openControlWraps([roleWrap, grantWrap, unresolved], [control]), communityId, owner.pubkey).metadata?.name,
    ).not.toBe("Unresolved");

    // (d) The owner needs no citation — supreme.
    const ownerEdit = await sealEdition(
      buildMetadataEdition(communityId, { name: "OwnerNoCite", relays: [] }, { actorPubkey: owner.pubkey, version: 1n }),
      control,
      owner,
    );
    expect(
      foldControlState(openControlWraps([ownerEdit], [control]), communityId, owner.pubkey).metadata?.name,
    ).toBe("OwnerNoCite");
  });

  it("an admin can mint + grant the stock Moderator (position 2), but not a peer Admin", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const admin = signer();
    const mod = signer();
    const wannabe = signer();

    const adm = adminRole(bytesToHex(random32()));
    const mrole = moderatorRole(bytesToHex(random32()));
    const peerAdm = adminRole(bytesToHex(random32()));
    const wraps: NostrEvent[] = [
      // Owner roots the Admin.
      await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(
        buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      ),
      // The admin (position 1) mints Moderator (position 2) and grants it — honored.
      await sealEdition(buildRoleEdition(mrole, { actorPubkey: admin.pubkey, version: 1n }), control, admin),
      await sealEdition(
        buildGrantEdition(communityId, { member: mod.pubkey, roleIds: [mrole.roleId] }, { actorPubkey: admin.pubkey, version: 1n }),
        control,
        admin,
      ),
      // The admin mints a PEER Admin (position 1) — dropped (equal cannot act on equal).
      await sealEdition(buildRoleEdition(peerAdm, { actorPubkey: admin.pubkey, version: 1n }), control, admin),
      await sealEdition(
        buildGrantEdition(communityId, { member: wannabe.pubkey, roleIds: [peerAdm.roleId] }, { actorPubkey: admin.pubkey, version: 1n }),
        control,
        admin,
      ),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(badgeOf(folded.roster, admin.pubkey)).toBe("admin");
    expect(badgeOf(folded.roster, mod.pubkey)).toBe("moderator");
    expect(hasPermission(folded.roster, mod.pubkey, Permissions.BAN)).toBe(true);
    expect(hasPermission(folded.roster, mod.pubkey, Permissions.MANAGE_ROLES)).toBe(false);
    expect(badgeOf(folded.roster, wannabe.pubkey)).toBeUndefined();
  });

  it("a moderator (no MANAGE_ROLES) cannot grant roles", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const mod = signer();
    const friend = signer();

    const mrole = moderatorRole(bytesToHex(random32()));
    const wraps: NostrEvent[] = [
      await sealEdition(buildRoleEdition(mrole, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(
        buildGrantEdition(communityId, { member: mod.pubkey, roleIds: [mrole.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      ),
      // The moderator hands their friend the same role — dropped.
      await sealEdition(
        buildGrantEdition(communityId, { member: friend.pubkey, roleIds: [mrole.roleId] }, { actorPubkey: mod.pubkey, version: 1n }),
        control,
        mod,
      ),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(badgeOf(folded.roster, mod.pubkey)).toBe("moderator");
    expect(badgeOf(folded.roster, friend.pubkey)).toBeUndefined();
  });

  it("a roleless member cannot revoke a grant (an empty role_ids edition needs authority)", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const admin = signer();
    const rando = signer();

    const adm = adminRole(bytesToHex(random32()));
    const roleWrap = await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner);
    const grantWrap = await sealEdition(
      buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
      control,
      owner,
    );
    // The forged revoke chains off the REAL head (any member can read the plane).
    const [grantV1] = openControlWraps([grantWrap], [control]);
    const revokeWrap = await sealEdition(
      buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [] }, { actorPubkey: rando.pubkey, version: 2n, prevHash: grantV1.selfHash }),
      control,
      rando,
    );

    const folded = foldControlState(openControlWraps([roleWrap, grantWrap, revokeWrap], [control]), communityId, owner.pubkey);
    expect(isAdmin(folded.roster, admin.pubkey)).toBe(true); // the revoke was dropped
  });

  it("a lower-ranked MANAGE_ROLES holder cannot strip or demote a grant above their rank", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const lt = signer(); // position 2, holds MANAGE_ROLES
    const admin1 = signer(); // strip target
    const admin2 = signer(); // demote target
    const newbie = signer();

    const adm = adminRole(bytesToHex(random32()));
    const ltRole: Role = { roleId: bytesToHex(random32()), name: "Lieutenant", position: 2, permissions: Permissions.MANAGE_ROLES, scope: { kind: "server" }, color: 0 };
    const lowRole: Role = { roleId: bytesToHex(random32()), name: "Helper", position: 3, permissions: 0n, scope: { kind: "server" }, color: 0 };

    const wraps: NostrEvent[] = [
      await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildRoleEdition(ltRole, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildRoleEdition(lowRole, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      // The lieutenant's own authority settles BEFORE the victims' entities.
      await sealEdition(buildGrantEdition(communityId, { member: lt.pubkey, roleIds: [ltRole.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
    ];
    const g1 = await sealEdition(buildGrantEdition(communityId, { member: admin1.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner);
    const g2 = await sealEdition(buildGrantEdition(communityId, { member: admin2.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner);
    const [g1v1] = openControlWraps([g1], [control]);
    const [g2v1] = openControlWraps([g2], [control]);
    wraps.push(
      g1,
      g2,
      // Strip admin1 — dropped (a revoke acts on a rank the lieutenant doesn't outrank).
      await sealEdition(
        buildGrantEdition(communityId, { member: admin1.pubkey, roleIds: [] }, { actorPubkey: lt.pubkey, version: 2n, prevHash: g1v1.selfHash }),
        control,
        lt,
      ),
      // Demote admin2 to the Helper role — dropped (outranking the role handed OUT is not enough).
      await sealEdition(
        buildGrantEdition(communityId, { member: admin2.pubkey, roleIds: [lowRole.roleId] }, { actorPubkey: lt.pubkey, version: 2n, prevHash: g2v1.selfHash }),
        control,
        lt,
      ),
      // A fresh grant BELOW the lieutenant's rank — honored.
      await sealEdition(
        buildGrantEdition(communityId, { member: newbie.pubkey, roleIds: [lowRole.roleId] }, { actorPubkey: lt.pubkey, version: 1n }),
        control,
        lt,
      ),
    );

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(isAdmin(folded.roster, admin1.pubkey)).toBe(true);
    expect(badgeOf(folded.roster, admin2.pubkey)).toBe("admin");
    expect(folded.roster.grants.some((g) => g.member === newbie.pubkey && g.roleIds.includes(lowRole.roleId))).toBe(true);
  });

  it("a lower-ranked MANAGE_ROLES holder cannot reposition a role above their rank", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const admin = signer();
    const lt = signer();

    const adm = adminRole(bytesToHex(random32()));
    const ltRole: Role = { roleId: bytesToHex(random32()), name: "Lieutenant", position: 2, permissions: Permissions.MANAGE_ROLES, scope: { kind: "server" }, color: 0 };
    const mrole = moderatorRole(bytesToHex(random32())); // minted by the ADMIN (position 2)

    const modV1 = await sealEdition(buildRoleEdition(mrole, { actorPubkey: admin.pubkey, version: 1n }), control, admin);
    const [modV1Parsed] = openControlWraps([modV1], [control]);
    const wraps: NostrEvent[] = [
      await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildRoleEdition(ltRole, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildGrantEdition(communityId, { member: lt.pubkey, roleIds: [ltRole.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      modV1,
      // The lieutenant (position 2) shoves the peer Moderator role to position 5 — dropped.
      await sealEdition(
        buildRoleEdition({ ...mrole, position: 5, permissions: 0n }, { actorPubkey: lt.pubkey, version: 2n, prevHash: modV1Parsed.selfHash }),
        control,
        lt,
      ),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    const settled = folded.roster.roles.find((r) => r.roleId === mrole.roleId);
    expect(settled?.position).toBe(2);
    expect(settled?.permissions).toBe(mrole.permissions);
  });

  it("an outranking MANAGE_ROLES holder's revoke still lands", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const admin = signer();
    const mod = signer();

    const adm = adminRole(bytesToHex(random32()));
    const mrole = moderatorRole(bytesToHex(random32()));
    const modGrant = await sealEdition(
      buildGrantEdition(communityId, { member: mod.pubkey, roleIds: [mrole.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
      control,
      owner,
    );
    const [modGrantV1] = openControlWraps([modGrant], [control]);
    const wraps: NostrEvent[] = [
      await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildRoleEdition(mrole, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      modGrant,
      // The admin (position 1) strips the moderator (rank 2) — honored.
      await sealEdition(
        buildGrantEdition(communityId, { member: mod.pubkey, roleIds: [] }, { actorPubkey: admin.pubkey, version: 2n, prevHash: modGrantV1.selfHash }),
        control,
        admin,
      ),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(badgeOf(folded.roster, mod.pubkey)).toBeUndefined();
    expect(isAdmin(folded.roster, admin.pubkey)).toBe(true);
  });

  it("the standing gate holds regardless of edition arrival order (a delegate-minted target rank)", async () => {
    // The target's rank comes from a role a DELEGATE minted, so that role only
    // reaches the roster in a later fixpoint pass than the delegate's own
    // grant. A lower-ranked MANAGE_ROLES holder's revoke must drop in EVERY
    // ordering — the fold is a function of the edition set, not its arrival
    // order (else clients diverge and the gate is bypassable by reshuffling).
    const build = async () => {
      const { owner, communityId, control } = await makeCommunity();
      const deleg = signer(); // position 1, mints roles
      const lt = signer(); // position 2, holds MANAGE_ROLES (the attacker)
      const target = signer();

      const adm = adminRole(bytesToHex(random32()));
      const ltRole: Role = { roleId: bytesToHex(random32()), name: "Lieutenant", position: 2, permissions: Permissions.MANAGE_ROLES, scope: { kind: "server" }, color: 0 };
      // The delegate mints a peer-rank (position 2) role and hands it to the target.
      const mrole: Role = { roleId: bytesToHex(random32()), name: "Peer", position: 2, permissions: Permissions.KICK, scope: { kind: "server" }, color: 0 };

      const admRole = await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner);
      const ltRoleW = await sealEdition(buildRoleEdition(ltRole, { actorPubkey: owner.pubkey, version: 1n }), control, owner);
      const delegGrant = await sealEdition(buildGrantEdition(communityId, { member: deleg.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner);
      const ltGrant = await sealEdition(buildGrantEdition(communityId, { member: lt.pubkey, roleIds: [ltRole.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner);
      const mroleW = await sealEdition(buildRoleEdition(mrole, { actorPubkey: deleg.pubkey, version: 1n }), control, deleg);
      const targetGrant = await sealEdition(buildGrantEdition(communityId, { member: target.pubkey, roleIds: [mrole.roleId] }, { actorPubkey: deleg.pubkey, version: 1n }), control, deleg);
      const [tgV1] = openControlWraps([targetGrant], [control]);
      // The lieutenant (rank 2) tries to strip the target (rank 2) — equal rank,
      // so it must be dropped: a revoke needs STRICT outrank (CORD-04 §5).
      const revoke = await sealEdition(
        buildGrantEdition(communityId, { member: target.pubkey, roleIds: [] }, { actorPubkey: lt.pubkey, version: 2n, prevHash: tgV1.selfHash }),
        control,
        lt,
      );
      return { owner, communityId, control, target, editions: { admRole, ltRoleW, delegGrant, ltGrant, mroleW, targetGrant, revoke } };
    };

    // Attacker's authority settles BEFORE the target's grant is visited.
    const a = await build();
    const orderA = [a.editions.admRole, a.editions.ltRoleW, a.editions.delegGrant, a.editions.ltGrant, a.editions.mroleW, a.editions.targetGrant, a.editions.revoke];
    const foldedA = foldControlState(openControlWraps(orderA, [a.control]), a.communityId, a.owner.pubkey);

    // The target's grant is visited BEFORE the delegate's role/authority settle.
    const b = await build();
    const orderB = [b.editions.admRole, b.editions.ltRoleW, b.editions.mroleW, b.editions.targetGrant, b.editions.revoke, b.editions.delegGrant, b.editions.ltGrant];
    const foldedB = foldControlState(openControlWraps(orderB, [b.control]), b.communityId, b.owner.pubkey);

    // Both orders must agree: the equal-rank revoke is dropped, target keeps rank.
    expect(foldedA.roster.grants.some((g) => g.member === a.target.pubkey && g.roleIds.length > 0)).toBe(true);
    expect(foldedB.roster.grants.some((g) => g.member === b.target.pubkey && g.roleIds.length > 0)).toBe(true);
  });

  it("an admin's revoke lands even when the revoker's own grant folds last (author-rank deferral)", async () => {
    // The revoke's admissibility depends on the REVOKER's rank, which settles
    // from a different grant entity. If the target's entity is visited first,
    // the fixpoint must WAIT for the revoker's rank — not settle the target's
    // entity with the stale predecessor and drop a legitimate revoke on
    // arrival-order luck.
    const build = async () => {
      const { owner, communityId, control } = await makeCommunity();
      const admin = signer();
      const mod = signer();

      const adm = adminRole(bytesToHex(random32()));
      const mrole = moderatorRole(bytesToHex(random32()));
      const admRole = await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner);
      const modRole = await sealEdition(buildRoleEdition(mrole, { actorPubkey: owner.pubkey, version: 1n }), control, owner);
      const adminGrant = await sealEdition(
        buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      );
      const modGrant = await sealEdition(
        buildGrantEdition(communityId, { member: mod.pubkey, roleIds: [mrole.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      );
      const [modGrantV1] = openControlWraps([modGrant], [control]);
      // The admin (position 1) revokes the moderator (rank 2) — always legitimate.
      const revoke = await sealEdition(
        buildGrantEdition(communityId, { member: mod.pubkey, roleIds: [] }, { actorPubkey: admin.pubkey, version: 2n, prevHash: modGrantV1.selfHash }),
        control,
        admin,
      );
      return { owner, communityId, control, admin, mod, editions: { admRole, modRole, adminGrant, modGrant, revoke } };
    };

    // The revoker's own grant arrives (and would naively settle) FIRST.
    const a = await build();
    const orderA = [a.editions.admRole, a.editions.modRole, a.editions.adminGrant, a.editions.modGrant, a.editions.revoke];
    const foldedA = foldControlState(openControlWraps(orderA, [a.control]), a.communityId, a.owner.pubkey);

    // The target's grant entity (incl. the revoke) arrives FIRST.
    const b = await build();
    const orderB = [b.editions.modRole, b.editions.admRole, b.editions.modGrant, b.editions.revoke, b.editions.adminGrant];
    const foldedB = foldControlState(openControlWraps(orderB, [b.control]), b.communityId, b.owner.pubkey);

    for (const [folded, admin, mod] of [
      [foldedA, a.admin, a.mod],
      [foldedB, b.admin, b.mod],
    ] as const) {
      expect(isAdmin(folded.roster, admin.pubkey)).toBe(true);
      expect(badgeOf(folded.roster, mod.pubkey)).toBeUndefined(); // the revoke landed
    }
  });

  it("terminates a revocation cycle: equal-rank admins cannot strip each other", async () => {
    // A revokes B and B revokes A — each entity's gate waits on the other's
    // rank, a genuine cycle. The rank freeze must break the deadlock, and the
    // strict-outrank rule must drop BOTH revokes (equal cannot act on equal).
    const { owner, communityId, control } = await makeCommunity();
    const a = signer();
    const b = signer();

    const adm = adminRole(bytesToHex(random32()));
    const grantA = await sealEdition(
      buildGrantEdition(communityId, { member: a.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
      control,
      owner,
    );
    const grantB = await sealEdition(
      buildGrantEdition(communityId, { member: b.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
      control,
      owner,
    );
    const [gAv1] = openControlWraps([grantA], [control]);
    const [gBv1] = openControlWraps([grantB], [control]);
    const wraps: NostrEvent[] = [
      await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      grantA,
      grantB,
      await sealEdition(
        buildGrantEdition(communityId, { member: b.pubkey, roleIds: [] }, { actorPubkey: a.pubkey, version: 2n, prevHash: gBv1.selfHash }),
        control,
        a,
      ),
      await sealEdition(
        buildGrantEdition(communityId, { member: a.pubkey, roleIds: [] }, { actorPubkey: b.pubkey, version: 2n, prevHash: gAv1.selfHash }),
        control,
        b,
      ),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(isAdmin(folded.roster, a.pubkey)).toBe(true);
    expect(isAdmin(folded.roster, b.pubkey)).toBe(true);
  });

  it("a same-version fork with a ground rumor id cannot revoke a superior's grant", async () => {
    // The equal-version tiebreak (lower rumor id) is minable, so a forger can
    // win the fold head at the chain tip. The evicted real edition must stay a
    // candidate: fork siblings settle highest-authority-first, so the
    // lieutenant's empty-grant fork loses to the owner's grant it undercut.
    const { owner, communityId, control } = await makeCommunity();
    const lt = signer(); // position 2, holds MANAGE_ROLES
    const admin = signer();

    const adm = adminRole(bytesToHex(random32()));
    const ltRole: Role = { roleId: bytesToHex(random32()), name: "Lieutenant", position: 2, permissions: Permissions.MANAGE_ROLES, scope: { kind: "server" }, color: 0 };
    const { realWrap: adminGrant, forgedWrap: forged } = await grindFork(
      control,
      { build: (t) => buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n, createdAtSecs: t }), by: owner },
      { build: (t) => buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [] }, { actorPubkey: lt.pubkey, version: 1n, createdAtSecs: t }), by: lt },
    );
    const wraps: NostrEvent[] = [
      await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildRoleEdition(ltRole, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildGrantEdition(communityId, { member: lt.pubkey, roleIds: [ltRole.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      adminGrant,
      forged,
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(isAdmin(folded.roster, admin.pubkey)).toBe(true); // the fork lost to the real grant
  });

  it("a same-version fork with a ground rumor id cannot gut a superior's role definition", async () => {
    // Same grind against a ROLE entity: the lieutenant forks the owner's
    // position-1 Admin definition down to a powerless position 5. Winning the
    // tiebreak must not evict the real definition — every admin would be
    // demoted at once.
    const { owner, communityId, control } = await makeCommunity();
    const lt = signer();
    const admin = signer();

    const adm = adminRole(bytesToHex(random32()));
    const ltRole: Role = { roleId: bytesToHex(random32()), name: "Lieutenant", position: 2, permissions: Permissions.MANAGE_ROLES, scope: { kind: "server" }, color: 0 };
    const { realWrap: admRole, forgedWrap: forged } = await grindFork(
      control,
      { build: (t) => buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n, createdAtSecs: t }), by: owner },
      { build: (t) => buildRoleEdition({ ...adm, position: 5, permissions: 0n }, { actorPubkey: lt.pubkey, version: 1n, createdAtSecs: t }), by: lt },
    );
    const wraps: NostrEvent[] = [
      admRole,
      forged,
      await sealEdition(buildRoleEdition(ltRole, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildGrantEdition(communityId, { member: lt.pubkey, roleIds: [ltRole.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    const settled = folded.roster.roles.find((r) => r.roleId === adm.roleId);
    expect(settled?.position).toBe(1);
    expect(settled?.permissions).toBe(adm.permissions);
    expect(isAdmin(folded.roster, admin.pubkey)).toBe(true);
  });

  it("a same-version banlist fork from a non-BAN holder cannot empty the banlist", async () => {
    // The eviction hole applies to every gated plane: a roleless rando forking
    // the banlist tip with a ground id would previously knock the real list out
    // of candidacy entirely — silently unbanning everyone. The evicted sibling
    // must remain for the authority gate to pick.
    const { owner, communityId, control } = await makeCommunity();
    const rando = signer();
    const target = signer();

    const { realWrap: banlist, forgedWrap: forged } = await grindFork(
      control,
      { build: (t) => buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 1n, createdAtSecs: t }), by: owner },
      { build: (t) => buildBanlistEdition(communityId, [], { actorPubkey: rando.pubkey, version: 1n, createdAtSecs: t }), by: rando },
    );

    const folded = foldControlState(openControlWraps([banlist, forged], [control]), communityId, owner.pubkey);
    expect(folded.banned.has(target.pubkey)).toBe(true);
  });

  it("drops (never deadlocks on) a grant handing out a role that never settles", async () => {
    // The role is minted by a rando who never gains authority, so it never
    // reaches the roster. A grant handing it out defers, then — once no pass
    // can settle that role — is dropped, not left pending forever. The fold
    // must terminate and confer no rank.
    const { owner, communityId, control } = await makeCommunity();
    const rando = signer();
    const target = signer();
    const ghostRole = adminRole(bytesToHex(random32()));

    const wraps: NostrEvent[] = [
      // A role the owner NEVER authorized (rando has no grant).
      await sealEdition(buildRoleEdition(ghostRole, { actorPubkey: rando.pubkey, version: 1n }), control, rando),
      // The owner-signed grant hands out that ghost role — the grant is honored
      // for its signer (owner), but the role behind it never settles.
      await sealEdition(buildGrantEdition(communityId, { member: target.pubkey, roleIds: [ghostRole.roleId] }, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    // The role never settled → the target holds no effective (settled) role.
    expect(isAdmin(folded.roster, target.pubkey)).toBe(false);
    expect(folded.roster.roles.some((r) => r.roleId === ghostRole.roleId)).toBe(false);
  });

  it("still confers the real role from an owner grant that also names a dead role", async () => {
    // A grant naming one settling role and one role that never settles must not
    // be starved by the dead role: once roles freeze, the grant resolves and
    // the real role still applies.
    const { owner, communityId, control } = await makeCommunity();
    const rando = signer();
    const target = signer();
    const realRole = adminRole(bytesToHex(random32()));
    const ghostRole = moderatorRole(bytesToHex(random32()));

    const wraps: NostrEvent[] = [
      await sealEdition(buildRoleEdition(realRole, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      // Minted by a rando who never gains authority — never settles.
      await sealEdition(buildRoleEdition(ghostRole, { actorPubkey: rando.pubkey, version: 1n }), control, rando),
      await sealEdition(
        buildGrantEdition(communityId, { member: target.pubkey, roleIds: [realRole.roleId, ghostRole.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      ),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(isAdmin(folded.roster, target.pubkey)).toBe(true); // the real Admin role applies
    expect(folded.roster.roles.some((r) => r.roleId === ghostRole.roleId)).toBe(false);
  });

  it("drops a banned npub's authority editions (CORD-04 §4), banlist aside", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const admin = signer();

    const adm = adminRole(bytesToHex(random32()));
    const wraps: NostrEvent[] = [
      await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(
        buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      ),
      // The admin renames the community while still trusted.
      await sealEdition(
        buildMetadataEdition(communityId, { name: "By Admin", relays: [] }, { actorPubkey: admin.pubkey, version: 1n }),
        control,
        admin,
      ),
      // The owner bans the admin.
      await sealEdition(buildBanlistEdition(communityId, [admin.pubkey], { actorPubkey: owner.pubkey, version: 1n }), control, owner),
    ];

    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(folded.banned.has(admin.pubkey)).toBe(true);
    // The banned admin's metadata edition is dropped on the re-fold.
    expect(folded.metadata?.name).toBeUndefined();
    expect(isAdmin(folded.roster, admin.pubkey)).toBe(true); // still roled (owner didn't strip), but silenced
  });

  it("refuses a control edition carried in an ENCRYPTED seal (CORD-02 §5)", async () => {
    const { owner, communityId, control } = await makeCommunity();
    // Seal a well-formed metadata edition, but with the wrong (encrypted) seal.
    const rumor = buildMetadataEdition(communityId, { name: "Encrypted", relays: [] }, { actorPubkey: owner.pubkey, version: 1n });
    const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, control, owner);
    const wrap = wrapSeal(seal, control);

    const folded = foldControlState(openControlWraps([wrap], [control]), communityId, owner.pubkey);
    expect(folded.metadata).toBeUndefined(); // an encrypted-seal edition never enters the fold
  });

  it("refuses metadata whose name exceeds the 64-byte cap on read (CORD-02 §6)", async () => {
    const { owner, communityId, control } = await makeCommunity();
    // Build a valid edition, then tamper the content past the cap and re-hash
    // (the builder enforces the cap on WRITE; this proves the READ gate too).
    const good = buildMetadataEdition(communityId, { name: "ok", relays: [] }, { actorPubkey: owner.pubkey, version: 1n });
    const tampered = { ...good, content: JSON.stringify({ name: "x".repeat(65), relays: [] }) };
    const rehashed = { ...tampered, id: getEventHash(tampered) };
    const seal = await sealRumor(rehashed, KIND_SEAL_PLAINTEXT, control, owner);
    const wrap = wrapSeal(seal, control);

    const folded = foldControlState(openControlWraps([wrap], [control]), communityId, owner.pubkey);
    expect(folded.metadata).toBeUndefined();
  });

  it("refuses a downgrade: a replayed stale banlist never wins", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const target = signer();

    const v1 = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 1n });
    const v1Wrap = await sealEdition(v1, control, owner);
    const [v1Parsed] = openControlWraps([v1Wrap], [control]);
    const v2 = buildBanlistEdition(communityId, [], {
      actorPubkey: owner.pubkey,
      version: 2n,
      prevHash: v1Parsed.selfHash,
    });
    const v2Wrap = await sealEdition(v2, control, owner);

    // Both editions present (a relay replaying the stale v1 alongside v2).
    const all = openControlWraps([v1Wrap, v2Wrap], [control]);
    const folded = foldControlState(all, communityId, owner.pubkey);
    expect(folded.banned.has(target.pubkey)).toBe(false); // v2 (the unban) wins
  });

  it("ignores a banlist from a non-BAN holder (fail closed)", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const rando = signer();
    const wraps = [
      await sealEdition(buildBanlistEdition(communityId, [owner.pubkey], { actorPubkey: rando.pubkey, version: 1n }), control, rando),
    ];
    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(folded.banned.size).toBe(0);
  });

  it("registry: each creator owns exactly their own list; the aggregate is the Public flag", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const linkSigner = bytesToHex(random32());
    const forger = signer();

    const wraps = [
      await sealEdition(buildRegistryEdition(communityId, owner.pubkey, [linkSigner], { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      // A forger publishing at the OWNER's registry coordinate is dropped.
      await sealEdition(buildRegistryEdition(communityId, owner.pubkey, ["ff".repeat(32)], { actorPubkey: forger.pubkey, version: 2n }), control, forger),
    ];
    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(folded.liveInviteLinks.has(linkSigner)).toBe(true);
    expect(folded.liveInviteLinks.has("ff".repeat(32))).toBe(false);
  });

  it("a banned creator's registry drops from the aggregate: the ban itself can flip the mode Private (CORD-05 §5)", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const admin = signer();
    const adm = adminRole(bytesToHex(random32()));
    const linkSigner = bytesToHex(random32());

    const authorityWraps = [
      await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(
        buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      ),
    ];
    // A non-owner edition must cite its own grant (vac), so fold for the head first.
    const grantEid = grantLocator(communityId, hex32(admin.pubkey));
    const grantHead = foldControlState(openControlWraps(authorityWraps, [control]), communityId, owner.pubkey)
      .heads.get(bytesToHex(grantEid))!;
    const preBan = [
      ...authorityWraps,
      await sealEdition(
        buildRegistryEdition(communityId, admin.pubkey, [linkSigner], {
          actorPubkey: admin.pubkey,
          version: 1n,
          authority: { entityId: grantEid, version: grantHead.version, editionHash: grantHead.hash },
        }),
        control,
        admin,
      ),
    ];
    const before = foldControlState(openControlWraps(preBan, [control]), communityId, owner.pubkey);
    expect(before.liveInviteLinks.has(linkSigner)).toBe(true);
    expect(isCommunityPublic(before)).toBe(true);
    // The ban gate's view: judged as if the target's registry were already gone.
    expect(isCommunityPublic(before, admin.pubkey)).toBe(false);

    const wraps = [
      ...preBan,
      await sealEdition(buildBanlistEdition(communityId, [admin.pubkey], { actorPubkey: owner.pubkey, version: 1n }), control, owner),
    ];
    const after = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);
    expect(after.liveInviteLinks.has(linkSigner)).toBe(false);
    expect(isCommunityPublic(after)).toBe(false);
  });

  it("isCommunityPublic: no registries and an emptied registry both read Private", async () => {
    const { owner, communityId, control } = await makeCommunity();
    expect(isCommunityPublic(foldControlState([], communityId, owner.pubkey))).toBe(false);

    const emptied = await sealEdition(
      buildRegistryEdition(communityId, owner.pubkey, [], { actorPubkey: owner.pubkey, version: 1n }),
      control,
      owner,
    );
    const folded = foldControlState(openControlWraps([emptied], [control]), communityId, owner.pubkey);
    expect(isCommunityPublic(folded)).toBe(false);
  });

  it("hasForeignLiveLinks: own links never block a rotation, anyone else's do", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const wraps = [
      await sealEdition(
        buildRegistryEdition(communityId, owner.pubkey, [bytesToHex(random32())], { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      ),
    ];
    const folded = foldControlState(openControlWraps(wraps, [control]), communityId, owner.pubkey);

    // The community reads Public, but every live link is the owner's own —
    // their rotation refreshes their own bundles, so nothing gets stranded.
    expect(isCommunityPublic(folded)).toBe(true);
    expect(hasForeignLiveLinks(folded, owner.pubkey)).toBe(false);

    // Any other rotator would strand the owner's link.
    const otherAdmin = bytesToHex(random32());
    expect(hasForeignLiveLinks(folded, otherAdmin)).toBe(true);
    // ...unless the link creator is the very target of the ban being judged.
    expect(hasForeignLiveLinks(folded, otherAdmin, owner.pubkey)).toBe(false);
  });

  it("a compaction re-wrap folds for a fresh joiner despite the dangling prev", async () => {
    const { owner, communityId, root, control } = await makeCommunity();

    // Two chained metadata editions at epoch 0.
    const m1 = buildMetadataEdition(communityId, { name: "One", relays: [] }, { actorPubkey: owner.pubkey, version: 1n });
    const p1 = openControlWraps([await sealEdition(m1, control, owner)], [control])[0];
    const m2 = buildMetadataEdition(communityId, { name: "Two", relays: [] }, { actorPubkey: owner.pubkey, version: 2n, prevHash: p1.selfHash });
    const p2 = openControlWraps([await sealEdition(m2, control, owner)], [control])[0];

    // Refounding: re-wrap ONLY the head into epoch 1 (plaintext seal survives).
    const control1 = controlGroupKey(root, communityId, 1); // (test shortcut: same root, new epoch address)
    const rewrapped = rewrapSeal(p2.opened.seal, control1);

    const joinerView = openControlWraps([rewrapped], [control1]);
    const folded = foldControlState(joinerView, communityId, owner.pubkey);
    expect(folded.metadata?.name).toBe("Two"); // accepted despite prev citing an absent edition
  });

  it("a TRACKING client fails closed on a withheld-middle chain — no downgrade to a dangling head (CORD-04 §1)", async () => {
    // The steady-state counterpart to the fresh-joiner case above: a client
    // that already holds v1 must NOT be pushed onto a higher DANGLING edition a
    // hostile relay serves after withholding the middle of the chain. It holds
    // at its last-known-good head and refetches instead.
    const { owner, communityId, control } = await makeCommunity();

    // First fold: the client legitimately advances to v1 "Real".
    const v1 = buildMetadataEdition(communityId, { name: "Real", relays: [] }, { actorPubkey: owner.pubkey, version: 1n });
    const v1Wrap = await sealEdition(v1, control, owner);
    const firstFold = foldControlState(openControlWraps([v1Wrap], [control]), communityId, owner.pubkey);
    const eid = bytesToHex(communityId); // metadata eid = community_id
    expect(firstFold.metadata?.name).toBe("Real");

    // Attacker serves ONLY a v3 whose prev cites a v2 the client never saw.
    const v3 = buildMetadataEdition(communityId, { name: "Hijacked", relays: [] }, {
      actorPubkey: owner.pubkey,
      version: 3n,
      prevHash: random32(), // dangling
    });
    const v3Wrap = await sealEdition(v3, control, owner);

    // Fed the prior fold's heads as the high-water floor, the tracking client
    // rejects the dangling v3 and keeps v1 "Real".
    const trackingFold = foldControlState(
      openControlWraps([v1Wrap, v3Wrap], [control]),
      communityId,
      owner.pubkey,
      firstFold.heads,
    );
    expect(trackingFold.metadata?.name).toBe("Real");
    expect(trackingFold.heads.get(eid)?.version).toBe(1n);

    // Even if the relay drops v1 entirely and serves only the dangling v3, the
    // floor still holds the entity at v1 (nothing at/above the floor links).
    const onlyDangling = foldControlState(
      openControlWraps([v3Wrap], [control]),
      communityId,
      owner.pubkey,
      firstFold.heads,
    );
    expect(onlyDangling.metadata?.name).not.toBe("Hijacked");
  });

  it("a rejoiner holding partial old roots folds the compacted snapshot, not the stale fragment (CORD-06 §3)", async () => {
    // The chain's middle lives in an epoch the rejoiner never held: they kept
    // epoch 0 (member then), missed epoch 1 (banned), rejoined at epoch 2. The
    // compaction re-wrap is the only readable carrier of the current head.
    const { owner, communityId, root, control } = await makeCommunity();
    const target = signer();

    // e0: v1 bans target (readable — the rejoiner held this root).
    const b1 = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 1n });
    const w1 = await sealEdition(b1, control, owner);
    const p1 = openControlWraps([w1], [control])[0];

    // e1 (never held): v2 churn, v3 unban.
    const control1 = controlGroupKey(root, communityId, 1);
    const b2 = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 2n, prevHash: p1.selfHash });
    const p2 = openControlWraps([await sealEdition(b2, control1, owner)], [control1])[0];
    const b3 = buildBanlistEdition(communityId, [], { actorPubkey: owner.pubkey, version: 3n, prevHash: p2.selfHash });
    const p3 = openControlWraps([await sealEdition(b3, control1, owner)], [control1])[0];

    // e2 Refounding: compaction re-wraps the head (v3) under the new epoch.
    const control2 = controlGroupKey(root, communityId, 2);
    const rewrapped = rewrapSeal(p3.opened.seal, control2);

    // The rejoiner's readable view: e0 fragment + e2 snapshot; e1 is dark.
    const view = [...openControlWraps([w1], [control]), ...openControlWraps([rewrapped], [control2])];

    // Without attribution the walk anchors on the old fragment: stale ban.
    const unaware = foldControlState(view, communityId, owner.pubkey);
    expect(unaware.banned.has(target.pubkey)).toBe(true);

    // With the current-epoch snapshot anchoring the fold: the unban wins.
    const snapshotIds = new Set([bytesToHex(p3.rumorId)]);
    const aware = foldControlState(view, communityId, owner.pubkey, undefined, snapshotIds);
    expect(aware.banned.has(target.pubkey)).toBe(false);
    expect(aware.heads.get(bytesToHex(p3.entityId))?.version).toBe(3n);

    // A hostile keyholder re-wraps the OLD banning edition into the current
    // epoch to poison the subset. Version anchoring defeats it: a re-wrap
    // can't raise the version inside the signed seal, so v1 loses to v3.
    const poison = rewrapSeal(p1.opened.seal, control2);
    const poisonedView = [...view, ...openControlWraps([poison], [control2])];
    const poisonedSnap = new Set([bytesToHex(p3.rumorId), bytesToHex(p1.rumorId)]);
    const resistant = foldControlState(poisonedView, communityId, owner.pubkey, undefined, poisonedSnap);
    expect(resistant.banned.has(target.pubkey)).toBe(false);
    expect(resistant.heads.get(bytesToHex(p3.entityId))?.version).toBe(3n);
  });

  it("a floor minted off a stale fragment can't wedge the arriving snapshot (version-only refuse-downgrade)", async () => {
    // The rejoiner's FIRST fold runs before the compaction re-wrap arrives:
    // the store seed serves only the old fragment, and its head raises the
    // floor. The snapshot must still win on version when it lands.
    const { owner, communityId, root, control } = await makeCommunity();
    const target = signer();

    const b1 = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 1n });
    const w1 = await sealEdition(b1, control, owner);
    const p1 = openControlWraps([w1], [control])[0];
    const control1 = controlGroupKey(root, communityId, 1);
    const b2 = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 2n, prevHash: p1.selfHash });
    const p2 = openControlWraps([await sealEdition(b2, control1, owner)], [control1])[0];
    const b3 = buildBanlistEdition(communityId, [], { actorPubkey: owner.pubkey, version: 3n, prevHash: p2.selfHash });
    const p3 = openControlWraps([await sealEdition(b3, control1, owner)], [control1])[0];
    const control2 = controlGroupKey(root, communityId, 2);
    const rewrapped = rewrapSeal(p3.opened.seal, control2);

    // Fold 1: only the old fragment is readable; no current-epoch editions yet.
    const first = foldControlState(
      openControlWraps([w1], [control]),
      communityId,
      owner.pubkey,
      undefined,
      new Set<string>(),
    );
    expect(first.banned.has(target.pubkey)).toBe(true);

    // Fold 2: the snapshot lands; fold with the stale floor fed back in.
    const view = [...openControlWraps([w1], [control]), ...openControlWraps([rewrapped], [control2])];
    const second = foldControlState(view, communityId, owner.pubkey, first.heads, new Set([bytesToHex(p3.rumorId)]));
    expect(second.banned.has(target.pubkey)).toBe(false);
    expect(second.incomplete).toEqual([]);
  });

  it("a poison-only subset can't outrank a higher head held in the client's own store", async () => {
    // Colluding relays withhold the compacted head's re-wrap and serve only a
    // keyholder's re-wrap of an old edition. An established member's store
    // still holds the full chain — the higher version must win the bootstrap.
    const { owner, communityId, root, control } = await makeCommunity();

    const m1 = buildMetadataEdition(communityId, { name: "One", relays: [] }, { actorPubkey: owner.pubkey, version: 1n });
    const p1 = openControlWraps([await sealEdition(m1, control, owner)], [control])[0];
    const m2 = buildMetadataEdition(communityId, { name: "Two", relays: [] }, { actorPubkey: owner.pubkey, version: 2n, prevHash: p1.selfHash });
    const w2 = await sealEdition(m2, control, owner);
    const control1 = controlGroupKey(root, communityId, 1);
    const poison = rewrapSeal(p1.opened.seal, control1);

    // View: the store's full e0 chain + the poison; only the poison is
    // current-epoch-attributed.
    const view = [
      ...openControlWraps([await sealEdition(m1, control, owner), w2], [control]),
      ...openControlWraps([poison], [control1]),
    ];
    const folded = foldControlState(view, communityId, owner.pubkey, undefined, new Set([bytesToHex(p1.rumorId)]));
    expect(folded.metadata?.name).toBe("Two");
  });

  it("the snapshot arm still fails closed when the floored head vanishes, and never downgrades below the floor", async () => {
    const { owner, communityId, root, control } = await makeCommunity();

    // e0 chain v1→v2, refounded into e1 carrying the v2 head.
    const m1 = buildMetadataEdition(communityId, { name: "One", relays: [] }, { actorPubkey: owner.pubkey, version: 1n });
    const p1 = openControlWraps([await sealEdition(m1, control, owner)], [control])[0];
    const m2 = buildMetadataEdition(communityId, { name: "Two", relays: [] }, { actorPubkey: owner.pubkey, version: 2n, prevHash: p1.selfHash });
    const p2 = openControlWraps([await sealEdition(m2, control, owner)], [control])[0];
    const control1 = controlGroupKey(root, communityId, 1);
    const rewrapV2 = rewrapSeal(p2.opened.seal, control1);
    const snapView = openControlWraps([rewrapV2], [control1]);
    const tracked = foldControlState(snapView, communityId, owner.pubkey, undefined, new Set([bytesToHex(p2.rumorId)]));
    expect(tracked.metadata?.name).toBe("Two");

    // The relay then serves only a re-wrap of the OLD v1: nothing at/above the
    // floor remains — the entity holds (no downgrade) and flags incomplete.
    const rewrapV1 = rewrapSeal(p1.opened.seal, control1);
    const starved = foldControlState(
      openControlWraps([rewrapV1], [control1]),
      communityId,
      owner.pubkey,
      tracked.heads,
      new Set([bytesToHex(p1.rumorId)]),
    );
    expect(starved.metadata?.name).not.toBe("Two"); // v2 wasn't served; v1 is below the floor
    expect(starved.incomplete).toContain(bytesToHex(communityId));
  });

  it("incomplete excludes a floored entity that was served but authority-rejected (CORD-04 §4)", async () => {
    // The strip flow: a creator's registry legitimately vanishes from the fold
    // when their grant is revoked. That absence is deliberate, not data loss —
    // it must NOT read as incomplete, or the ban→refound flow false-aborts.
    const { owner, communityId, control } = await makeCommunity();
    const admin = signer();
    const adm = adminRole(bytesToHex(random32()));

    const authorityWraps = [
      await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(
        buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      ),
    ];
    const grantEid = grantLocator(communityId, hex32(admin.pubkey));
    const grantHead = foldControlState(openControlWraps(authorityWraps, [control]), communityId, owner.pubkey)
      .heads.get(bytesToHex(grantEid))!;
    const registryWrap = await sealEdition(
      buildRegistryEdition(communityId, admin.pubkey, [bytesToHex(random32())], {
        actorPubkey: admin.pubkey,
        version: 1n,
        authority: { entityId: grantEid, version: grantHead.version, editionHash: grantHead.hash },
      }),
      control,
      admin,
    );
    const first = foldControlState(openControlWraps([...authorityWraps, registryWrap], [control]), communityId, owner.pubkey);
    expect(first.registriesByCreator.has(admin.pubkey)).toBe(true);

    // The owner strips the admin, then the refound-gate fold re-runs with the
    // pre-strip heads as its floor. Everything is served; the registry is
    // rejected on authority alone — the gate must see a complete plane.
    const strip = await sealEdition(
      buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [] }, { actorPubkey: owner.pubkey, version: 2n, prevHash: grantHead.hash }),
      control,
      owner,
    );
    const folded = foldControlState(
      openControlWraps([...authorityWraps, registryWrap, strip], [control]),
      communityId,
      owner.pubkey,
      first.heads,
    );
    expect(folded.registriesByCreator.has(admin.pubkey)).toBe(false);
    expect(folded.incomplete).toEqual([]);
  });

  it("incomplete flags a floored entity the served set can't settle (the refound gate)", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const m1 = buildMetadataEdition(communityId, { name: "Real", relays: [] }, { actorPubkey: owner.pubkey, version: 1n });
    const w1 = await sealEdition(m1, control, owner);
    const first = foldControlState(openControlWraps([w1], [control]), communityId, owner.pubkey);
    expect(first.incomplete).toEqual([]);

    // The floored entity's editions vanish from the served set entirely.
    const starved = foldControlState([], communityId, owner.pubkey, first.heads);
    expect(starved.incomplete).toContain(bytesToHex(communityId));

    // Served complete again: the flag clears.
    const healed = foldControlState(openControlWraps([w1], [control]), communityId, owner.pubkey, first.heads);
    expect(healed.incomplete).toEqual([]);
  });

  it("bannedAt records the newest AUTHORIZED ban time per npub; forgeries excluded", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const target = signer();
    const rando = signer();

    const b1 = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 1n, createdAtSecs: 1000 });
    const w1 = await sealEdition(b1, control, owner);
    const p1 = openControlWraps([w1], [control])[0];
    // A newer authorized edition still naming the target.
    const b2 = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 2n, prevHash: p1.selfHash, createdAtSecs: 2000 });
    const w2 = await sealEdition(b2, control, owner);
    // A forged banlist edition by an unauthorized author, dated far in the future.
    const forged = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: rando.pubkey, version: 3n, createdAtSecs: 9999 });
    const wf = await sealEdition(forged, control, rando);

    const folded = foldControlState(openControlWraps([w1, w2, wf], [control]), communityId, owner.pubkey);
    expect(folded.banned.has(target.pubkey)).toBe(true);
    // Newest AUTHORIZED edition wins (2000), never the forged 9999.
    expect(folded.bannedAt.get(target.pubkey)).toBe(2000);
    // The forger's own edition contributes nothing.
    expect(folded.bannedAt.has(rando.pubkey)).toBe(false);
  });

  it("bannedAt survives an unban (the phantom-suppression signal outlives the ban)", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const target = signer();
    const b1 = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 1n, createdAtSecs: 1000 });
    const w1 = await sealEdition(b1, control, owner);
    const p1 = openControlWraps([w1], [control])[0];
    const unban = buildBanlistEdition(communityId, [], { actorPubkey: owner.pubkey, version: 2n, prevHash: p1.selfHash, createdAtSecs: 2000 });
    const w2 = await sealEdition(unban, control, owner);

    const folded = foldControlState(openControlWraps([w1, w2], [control]), communityId, owner.pubkey);
    expect(folded.banned.has(target.pubkey)).toBe(false); // currently unbanned
    expect(folded.bannedAt.get(target.pubkey)).toBe(1000); // but the ban history remains
  });

  it("bannedAt spans held epochs: a later ban in a DIFFERENT epoch's control group wins", async () => {
    const { owner, communityId, root } = await makeCommunity();
    const target = signer();
    const control0 = controlGroupKey(root, communityId, 0);
    const control1 = controlGroupKey(root, communityId, 1); // (test shortcut: same root, new epoch address)

    const b0 = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 1n, createdAtSecs: 1000 });
    const w0 = await sealEdition(b0, control0, owner);
    const p0 = openControlWraps([w0], [control0])[0];
    // A newer ban published under epoch 1's control group.
    const b1 = buildBanlistEdition(communityId, [target.pubkey], { actorPubkey: owner.pubkey, version: 2n, prevHash: p0.selfHash, createdAtSecs: 2000 });
    const w1 = await sealEdition(b1, control1, owner);

    // Both epoch groups held → the fold sees both editions; newest ban wins.
    const folded = foldControlState(openControlWraps([w0, w1], [control0, control1]), communityId, owner.pubkey);
    expect(folded.bannedAt.get(target.pubkey)).toBe(2000);
  });

  it("bannedAt never names the owner — an authorized ban of the owner can't durably hide them", async () => {
    const { owner, communityId, control } = await makeCommunity();
    const admin = signer();
    const adm = adminRole(bytesToHex(random32()));
    const authWraps = [
      await sealEdition(buildRoleEdition(adm, { actorPubkey: owner.pubkey, version: 1n }), control, owner),
      await sealEdition(
        buildGrantEdition(communityId, { member: admin.pubkey, roleIds: [adm.roleId] }, { actorPubkey: owner.pubkey, version: 1n }),
        control,
        owner,
      ),
    ];
    const grantEid = grantLocator(communityId, hex32(admin.pubkey));
    const grantHead = foldControlState(openControlWraps(authWraps, [control]), communityId, owner.pubkey)
      .heads.get(bytesToHex(grantEid))!;
    // The admin (BAN authority) publishes a banlist edition naming the OWNER.
    const evil = buildBanlistEdition(communityId, [owner.pubkey], {
      actorPubkey: admin.pubkey,
      version: 1n,
      authority: { entityId: grantEid, version: grantHead.version, editionHash: grantHead.hash },
    });
    const folded = foldControlState(
      openControlWraps([...authWraps, await sealEdition(evil, control, admin)], [control]),
      communityId,
      owner.pubkey,
    );
    expect(folded.bannedAt.has(owner.pubkey)).toBe(false);
  });
});

describe("dissolution (CORD-02 §9)", () => {
  it("only the owner's tombstone counts", async () => {
    const { owner, communityId } = await makeCommunity();
    const impostor = signer();

    const real = await sealDissolved(communityId, owner.pubkey, owner);
    const fake = await sealDissolved(communityId, impostor.pubkey, impostor);

    expect(isDissolved([fake], communityId, owner.pubkey)).toBe(false);
    expect(isDissolved([fake, real], communityId, owner.pubkey)).toBe(true);
  });
});
