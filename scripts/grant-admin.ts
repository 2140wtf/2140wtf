/**
 * Grant the stock Admin role to a member of a ₿AO the current identity owns.
 *
 * Built with the app's rolldown bundle (resolves the `@` alias), mirroring
 * scripts/bao-agent.ts:
 *   node_modules/.bin/rolldown -c scripts/rolldown.grant-admin.config.mjs
 *   node .tmp/grant-admin.mjs <owner-name> <target-pubkey-hex>
 *
 * Signs BOTH control editions as the owner (no authority citation needed):
 *   1. the Admin role (vsk 1) — minted only if the roster has no "Admin" yet;
 *   2. the grant (vsk 3) handing that role to the target member.
 * Each edition is version-chained off its folded head and sealed+wrapped to
 * the current control group, then broadcast to the community relays.
 */
import { getPublicKey } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { adminRole } from "@/concord-v2/lib/roles";
import { grantLocator, hex32, random32 } from "@/concord-v2/lib/derive";
import {
  buildGrantEdition,
  buildRoleEdition,
  currentControlGroup,
  foldControlState,
  openControlWraps,
  sealEdition,
} from "@/concord-v2/lib/control";
import { KIND_WRAP } from "@/concord-v2/lib/kinds";
import { communityOf, loadState, publishAll, queryAll, signerOf } from "./chat-core";

async function main(): Promise<void> {
  const [ownerName, target] = process.argv.slice(2);
  if (!ownerName || !target) {
    throw new Error("usage: grant-admin <owner-name> <target-pubkey-hex>");
  }
  if (!/^[0-9a-f]{64}$/i.test(target)) throw new Error("target must be a 64-char lowercase hex pubkey");
  const targetHex = target.toLowerCase();

  const state = loadState(ownerName);
  if (state.role !== "owner") throw new Error(`"${ownerName}" is a ${state.role}, not an owner — only the owner can grant Admin.`);

  const community = communityOf(state.community, state.private_channels);
  console.error(`  ⓘ ${ownerName} owns ${community.name}; granting Admin to ${targetHex.slice(0, 16)}… on ${community.relays.join(", ")}`);
  const sk = hexToBytes(state.sk);
  const signer = signerOf(sk);
  const ownerPubkey = getPublicKey(sk);

  // Fold the control plane to read the current heads for version chaining.
  const controls = [currentControlGroup(community)];
  console.error("  ⓘ folding control plane…");
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: controls.map((c) => c.pk) });
  const folded = foldControlState(openControlWraps(wraps, controls), community.id, community.owner);

  // 1. Admin role — reuse an existing "Admin" role if the roster has one.
  const existing = folded.roster.roles.find((r) => r.name === "Admin");
  let roleId: string;
  if (existing) {
    roleId = existing.roleId;
    console.error(`  ⓘ reusing existing Admin role ${roleId.slice(0, 12)}…`);
  } else {
    const role = adminRole(bytesToHex(random32()));
    roleId = role.roleId;
    const wrap = await sealEdition(
      buildRoleEdition(role, { actorPubkey: ownerPubkey, version: 1n }),
      currentControlGroup(community),
      signer,
    );
    await publishAll(community.relays, wrap, `admin role ${roleId.slice(0, 12)}…`);
  }

  // 2. Grant the role to the target member (version-chained off their grant head).
  const grantEid = bytesToHex(grantLocator(community.id, hex32(targetHex)));
  const head = folded.heads.get(grantEid);
  const grantWrap = await sealEdition(
    buildGrantEdition(community.id, { member: targetHex, roleIds: [roleId] }, {
      actorPubkey: ownerPubkey,
      version: head ? head.version + 1n : 1n,
      prevHash: head?.hash,
    }),
    currentControlGroup(community),
    signer,
  );
  await publishAll(community.relays, grantWrap, `grant Admin → ${targetHex.slice(0, 12)}…`);

  console.log(`\nGranted Admin role ${roleId} to ${targetHex} (${community.name}).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
