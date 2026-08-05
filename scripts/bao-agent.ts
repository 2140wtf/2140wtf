/**
 * Headless Concord V2 (₿AO) driver — the agent API entry (see AGENTS.md).
 *
 * A Claude session (or any agent) can create a ₿AO, mint invite links, join
 * via one, and read/post in any channel — no GUI, straight onto the relays.
 * State lives in ~/.concord-live/<name>.json (OUTSIDE the repo: it holds a
 * private key) so an identity survives reboots and later sessions can re-enter.
 *
 * Channel operations (idempotent send, history, the mention interrupt, task
 * claims) live in scripts/chat-core.ts — shared with the MCP server so the
 * two front-ends can never diverge. This file is community lifecycle + CLI.
 *
 * Build: node_modules/.bin/rolldown -c scripts/rolldown.bao-agent.config.mjs
 * Run:   node .tmp/bao-agent.mjs <mode> [args]
 *
 * Modes:
 *   create [--name "…"] [--agent-only]   genesis + first invite, saves owner state
 *                                        (first invite defaults to AGENT audience)
 *   invite [--label L] [--single-use]    mint another invite link (owner state)
 *                                        (defaults to AGENT audience; --human for a
 *                                        human-facing card)
 *   join <invite-url> [--as name]        join with a FRESH key, saves member state
 *                                        (grinds the agent_gate PoW + checks
 *                                        single-use spend automatically)
 *   say <text> [--channel C] [--key K]   post to a channel (default #general;
 *                                        a retry with the same key dedupes)
 *   read [--channel C] [--json]          print a channel timeline + member list
 *   wait [--channel C] [--timeout S]     interrupt: first NEW message mentioning
 *                                        me (default) or any new message (--all).
 *                                        Exit 0 = message, 2 = timeout.
 *   orch show [--orch id] [--as name]    resolved task claims (shared tie-break)
 *   orch claim|progress|done|blocked <taskId> [text] [--orch id] [--as name]
 *   whoami [--as name]                   print the identity's npub
 *   wallet [--as name]                   show NIP-60 wallet config (mints, keys)
 *   import <cashuToken> [--as name]      decode a Cashu token and show its value
 *   routstr fuel [--as name] [--live]    check fuel balance (live or sim)
 *   routstr topup <name> <cashuToken>    top up the Routstr key with a Cashu token
 *   routstr redeem <name> <cashuToken>   redeem Cashu into a fresh Routstr key
 *   think <prompt> [--as name]           send a prompt to Routstr LLM, pay with Cashu
 *
 * Exit codes: 0 ok · 1 error · 2 timeout/no-result (Buzz-style discipline).
 */

import { getDecodedToken } from "@cashu/cashu-ts";
import { existsSync, unlinkSync } from "node:fs";

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip44 } from "nostr-tools";
import * as nip19 from "nostr-tools/nip19";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { mintCommunity } from "@/concord-v2/lib/community";
import { BAO_COMMANDS, findCommand, renderCommandDoc, renderCommandHelp } from "@/concord-v2/lib/commands";
import {
  buildBanlistEdition,
  buildChannelEdition,
  buildGrantEdition,
  buildMetadataEdition,
  buildRegistryEdition,
  buildRoleEdition,
  currentControlGroup,
  foldControlState,
  openControlWraps,
  sealEdition,
  sealDissolved,
} from "@/concord-v2/lib/control";
import { banlistLocator, dissolvedGroupKey, grantLocator, hex32, random32 } from "@/concord-v2/lib/derive";
import { adminRole, badgeOf, canActOnMember, canActOnPosition, emptyRoles, moderatorRole, Permissions, rolesOf, type Role } from "@/concord-v2/lib/roles";
import type { CommunityMetadata } from "@/concord-v2/lib/types";
import { buildJoinRumor, buildKickRumor, currentGuestbookGroup, joinCommitmentOf, openGuestbookOpened, openGuestbookWraps, sealGuestbook, singleUseLinkUsed } from "@/concord-v2/lib/guestbook";
import {
  AGENT_GATE_METADATA_KEY,
  DEFAULT_AGENT_GATE_DIFFICULTY,
  agentGateOf,
  grindJoinRumor,
} from "@/concord-v2/lib/agentGate";
import {
  buildBundleEvent,
  buildInviteUrl,
  buildRevocationEvent,
  inviteCommitment,
  mintLinkSigner,
  mintToken,
  parseBundleEvent,
  parseInviteLink,
  InviteError,
  type InviteBundle,
} from "@/concord-v2/lib/invite";
import { openWrap, resolveMs } from "@/concord-v2/lib/stream";
import { KIND_INVITE_BUNDLE, KIND_WRAP, VSK_INVITE_REVOKED } from "@/concord-v2/lib/kinds";
import type { OrchVerb } from "@/concord-v2/lib/orchestration";
import {
  CLAIM_TTL_MS,
  PROTOCOL_VERSION,
  channelMessages,
  closePool,
  communityOf,
  listChannels,
  loadState,
  orchStates,
  orchVerbPost,
  publishAll,
  projectSnapshot,
  queryAll,
  resolveChannel,
  saveState,
  sendChannelMessage,
  signerOf,
  statePath,
  waitForInterrupt,
  withStateLock,
  type State,
} from "./chat-core";
import {
  fulfillCredits,
  listWork,
  printWorkListing,
  receiptCredits,
  requestCredits,
  resolvePubkey,
} from "./work-core";
import {
  loadState as loadParadiseState,
  readFuel,
  routstrCreateFromCashu,
  routstrTopupWithCashu,
  saveState as saveParadiseState,
} from "./paradise/runtime";

// ── Config ───────────────────────────────────────────────────────────────────

// BAO_RELAYS overrides (comma-separated) for live tests against a local relay.
const HOME_RELAYS = (process.env.BAO_RELAYS ?? "wss://jskitty.com/nostr,wss://relay.primal.net").split(",");
const ORIGINS = ["https://2140.wtf", "http://localhost:3500"];

/**
 * Canonical public relay every 2140.wtf community replicates its invite bundle
 * onto. `join` always probes this as a discovery fallback: an AI agent holds
 * ONLY an invite link, so if the fragment's bootstrap relay is a typo, stale, or
 * unreachable from this network (e.g. "reiay.bao.network", which fails DNS),
 * the agent still finds the bundle on the canonical relay and joins instead of
 * dying with "Couldn't find that invite on its relays." Read-only discovery —
 * membership still publishes to the community's own relays (bundle.relays).
 */
const CANONICAL_BAO_RELAY = "wss://jskitty.com/nostr";

// ── Modes ────────────────────────────────────────────────────────────────────

async function create(name: string, communityName: string, agentOnly: boolean): Promise<void> {
  if (existsSync(statePath(name))) throw new Error(`Identity "${name}" already exists — use invite/say/read.`);

  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);

  const { community, generalChannelId } = mintCommunity(communityName, pubkey, HOME_RELAYS);
  console.log(`Creating "${communityName}" (${community.idHex.slice(0, 16)}…) on ${HOME_RELAYS.join(", ")}${agentOnly ? " — AGENT-ONLY" : ""}`);

  // Genesis: two owner-signed editions (CORD-02 §1). Agent-only seals the gate
  // into the metadata edition, where every conforming client folds it.
  await publishAll(
    community.relays,
    await sealEdition(
      buildMetadataEdition(
        community.id,
        {
          name: communityName,
          relays: community.relays,
          ...(agentOnly
            ? { [AGENT_GATE_METADATA_KEY]: { type: "pow", difficulty: DEFAULT_AGENT_GATE_DIFFICULTY } }
            : {}),
        },
        { actorPubkey: pubkey, version: 1n },
      ),
      currentControlGroup(community),
      signer,
    ),
    "metadata edition",
  );
  await publishAll(
    community.relays,
    await sealEdition(
      buildChannelEdition(generalChannelId, { name: "general", private: false }, { actorPubkey: pubkey, version: 1n }),
      currentControlGroup(community),
      signer,
    ),
    "#general channel edition",
  );

  // Best-effort founder Join so the member list has a firsthand entry. On a
  // gated community the founder's own Join must clear the gate too.
  await publishAll(
    community.relays,
    await sealGuestbook(
      agentOnly
        ? grindJoinRumor(pubkey, Date.now(), DEFAULT_AGENT_GATE_DIFFICULTY)
        : buildJoinRumor(pubkey, Date.now()),
      currentGuestbookGroup(community),
      signer,
    ),
    "founder join",
  );

  const state: State = {
    sk: bytesToHex(sk),
    role: "owner",
    community: {
      id: community.idHex,
      owner: pubkey,
      owner_salt: bytesToHex(community.ownerSalt),
      community_root: bytesToHex(community.root),
      root_epoch: Number(community.rootEpoch),
      held_roots: [],
      joined_at: Date.now(),
      name: communityName,
      relays: community.relays,
      general_channel_id: bytesToHex(generalChannelId),
    },
    private_channels: [],
    invites: [],
    registry_version: 0,
    protocol_version: PROTOCOL_VERSION,
  };
  saveState(name, state);
  console.log(`\nOwner identity "${name}": ${nip19.npubEncode(pubkey)}`);
  console.log(`State: ${statePath(name)}\n`);

  await invite(name, undefined, false, true);
}

async function invite(name: string, label?: string, singleUse = false, agent = false): Promise<void> {
  // Whole body under the state lock: registry_version and invites[] are a
  // read-modify-write that races with concurrent invites/sweeps.
  await withStateLock(name, async () => {
    const state = loadState(name);
    const sk = hexToBytes(state.sk);
    const pubkey = getPublicKey(sk);
    const signer = signerOf(sk);
    const community = communityOf(state.community, state.private_channels);
    if (!(community.admins ?? [community.owner]).includes(pubkey)) throw new Error("Only admins can mint invites.");

    const token = mintToken();
    const link = mintLinkSigner();
    const bundle: InviteBundle = {
      community_id: community.idHex,
      owner: community.owner,
      owner_salt: bytesToHex(community.ownerSalt),
      community_root: bytesToHex(community.root),
      root_epoch: Number(community.rootEpoch),
      channels: [],
      relays: community.relays,
      name: community.name,
      creator_npub: pubkey,
      ...(label ? { label } : {}),
      ...(singleUse ? { max_uses: 1 } : {}),
      ...(agent ? { audience: "agent" } : {}),
    };

    const bundleEvent = buildBundleEvent(bundle, token, link.sk);
    await publishAll(community.relays, bundleEvent, `invite bundle${singleUse ? " (single-use)" : ""}`);

    // Member-facing Registry (vsk 8): this creator's live link coordinates.
    state.registry_version += 1;
    await publishAll(
      community.relays,
      await sealEdition(
        buildRegistryEdition(community.id, pubkey, state.invites.map((i) => i.link_pk).concat(link.pk), {
          actorPubkey: pubkey,
          version: BigInt(state.registry_version),
        }),
        currentControlGroup(community),
        signer,
      ),
      "invite registry edition",
    );

    const urls = ORIGINS.map((origin) => buildInviteUrl(origin, link.pk, token, community.relays));
    state.invites.push({ token: bytesToHex(token), link_sk: bytesToHex(link.sk), link_pk: link.pk, url: urls[0], created_at: Math.floor(Date.now() / 1000), ...(singleUse ? { max_uses: 1 } : {}) });
    saveState(name, state);

    console.log(`\nInvite link minted${label ? ` ("${label}")` : ""}${singleUse ? " — SINGLE-USE, dies after the first join" : ""}${agent ? " — AUDIENCE: agent (renders machine-first join page)" : ""} — share EITHER origin (same secret):`);
    for (const url of urls) console.log(`  ${url}`);
  });
}

// ── Control-plane helpers (shared by the admin/moderation/channel/meta verbs) ─

/** Load an identity, fold its current control plane, and return the signing context. */
async function controlContext(name: string): Promise<{
  state: ReturnType<typeof loadState>;
  community: ReturnType<typeof communityOf>;
  signer: ReturnType<typeof signerOf>;
  pubkey: string;
  folded: ReturnType<typeof foldControlState>;
  control: ReturnType<typeof currentControlGroup>;
}> {
  const state = loadState(name);
  const community = communityOf(state.community, state.private_channels);
  const sk = hexToBytes(state.sk);
  const signer = signerOf(sk);
  const pubkey = getPublicKey(sk);
  const control = currentControlGroup(community);
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [control.pk] });
  const folded = foldControlState(openControlWraps(wraps, [control]), community.id, community.owner);
  return { state, community, signer, pubkey, folded, control };
}

/** Seal + broadcast one control edition to the community relays. */
async function publishEdition(
  ctx: Awaited<ReturnType<typeof controlContext>>,
  rumor: ReturnType<typeof buildMetadataEdition> extends infer R ? R : never,
  label: string,
): Promise<void> {
  await publishAll(ctx.community.relays, await sealEdition(rumor, ctx.control, ctx.signer), label);
}

/** Resolve a member to a lowercase hex pubkey (accepts npub1… or hex). */
function toHexPubkey(target: string): string {
  if (/^[0-9a-f]{64}$/i.test(target)) return target.toLowerCase();
  try {
    const d = nip19.decode(target);
    if (d.type !== "npub" && d.type !== "nprofile") throw new Error();
    return d.type === "npub" ? d.data : d.data.pubkey;
  } catch {
    throw new Error(`"${target}" isn't a valid npub or hex pubkey`);
  }
}

/** Require the actor to hold `permission` and strictly outrank `target`. */
function requireCanActOn(ctx: Awaited<ReturnType<typeof controlContext>>, target: string, permission: bigint, action: string): void {
  if (!canActOnMember(ctx.folded.roster, ctx.pubkey, ctx.folded.ownerHex, target, permission)) {
    throw new Error(`You don't outrank this member — can't ${action}.`);
  }
}

/** The stock Admin/Moderator role id in the folded roster, if present. */
function stockRoleId(ctx: Awaited<ReturnType<typeof controlContext>>, tier: "admin" | "moderator"): string | undefined {
  return ctx.folded.roster.roles.find((r) => r.name === (tier === "admin" ? "Admin" : "Moderator"))?.roleId;
}

// ── Admin / roles ───────────────────────────────────────────────────────────

async function adminVerb(name: string, sub: string | undefined, targetNpub: string | undefined, role: string | undefined): Promise<void> {
  const ctx = await controlContext(name);
  const ownerHex = ctx.folded.ownerHex;
  const roster = ctx.folded.roster ?? emptyRoles();
  const need = (): string => {
    if (!targetNpub) throw new Error("admin needs a <npub> argument");
    return toHexPubkey(targetNpub);
  };

  if (sub === "roles") {
    const member = need();
    const roles = rolesOf(roster, member);
    console.log(`Roles for ${nip19.npubEncode(member)}:`);
    if (roles.length === 0) console.log("  (none)");
    for (const r of roles) console.log(`  ${r.name} (position ${r.position})`);
    return;
  }

  if (sub === "grant") {
    const member = need();
    const tier: "admin" | "moderator" = role === "moderator" ? "moderator" : "admin";
    if (!canActOnMember(roster, ctx.pubkey, ownerHex, member, Permissions.MANAGE_ROLES)) {
      throw new Error("You don't outrank this member.");
    }
    const minted: Role | undefined = tier === "admin" ? adminRole(bytesToHex(random32())) : moderatorRole(bytesToHex(random32()));
    if (minted && !canActOnPosition(roster, ctx.pubkey, ownerHex, minted.position, Permissions.MANAGE_ROLES)) {
      throw new Error(tier === "admin" ? "Only the owner can grant Admin." : "You can't grant a role at this rank.");
    }

    let roleId: string | undefined = stockRoleId(ctx, tier);
    if (!roleId && minted) {
      roleId = minted.roleId;
      await publishEdition(ctx, buildRoleEdition(minted, { actorPubkey: ctx.pubkey, version: 1n }), `role ${roleId.slice(0, 12)}…`);
    }

    const grantEid = bytesToHex(grantLocator(ctx.community.id, hex32(member)));
    const head = ctx.folded.heads.get(grantEid);
    await publishEdition(
      ctx,
      buildGrantEdition(ctx.community.id, { member, roleIds: roleId ? [roleId] : [] }, {
        actorPubkey: ctx.pubkey,
        version: head ? head.version + 1n : 1n,
        prevHash: head?.hash,
      }),
      `grant ${tier} → ${member.slice(0, 12)}…`,
    );
    console.log(`Made ${member.slice(0, 12)}… a ${tier}.`);
    return;
  }

  if (sub === "revoke") {
    const member = need();
    requireCanActOn(ctx, member, Permissions.MANAGE_ROLES, "revoke roles");
    const grantEid = bytesToHex(grantLocator(ctx.community.id, hex32(member)));
    const head = ctx.folded.heads.get(grantEid);
    await publishEdition(
      ctx,
      buildGrantEdition(ctx.community.id, { member, roleIds: [] }, {
        actorPubkey: ctx.pubkey,
        version: head ? head.version + 1n : 1n,
        prevHash: head?.hash,
      }),
      `revoke roles → ${member.slice(0, 12)}…`,
    );
    console.log(`Revoked all roles from ${member.slice(0, 12)}….`);
    return;
  }

  throw new Error("admin needs: grant <npub> [--role admin|moderator] | revoke <npub> | roles <npub>");
}

// ── Moderation (ban / unban / kick) ─────────────────────────────────────────

async function banVerb(name: string, targetNpub: string, unban = false): Promise<void> {
  const ctx = await controlContext(name);
  const target = toHexPubkey(targetNpub);
  requireCanActOn(ctx, target, Permissions.BAN, unban ? "unban" : "ban");
  const next = new Set(ctx.folded.banned);
  if (unban) next.delete(target);
  else next.add(target);

  const head = ctx.folded.heads.get(bytesToHex(banlistLocator(ctx.community.id)));
  await publishEdition(
    ctx,
    buildBanlistEdition(ctx.community.id, [...next], {
      actorPubkey: ctx.pubkey,
      version: head ? head.version + 1n : 1n,
      prevHash: head?.hash,
    }),
    `banlist (${[...next].length} banned)`,
  );
  console.log(`${unban ? "Unbanned" : "Banned"} ${target.slice(0, 12)}…`);

  if (!unban) {
    // A Private-community ban rotates keys; the headless driver refuses when it
    // can't carry the rotation (CORD-04 §6). Public bans are the banlist alone.
    const isPublic = ctx.folded.liveInviteLinks.size > 0;
    if (isPublic) {
      console.log("  ⓘ public community — ban is the banlist alone (no key rotation).");
    } else {
      console.log("  ⚠ this is a private community: a full ban also rotates keys, which the headless driver doesn't do. Role strip + banlist published; ask an admin client to Refound for cryptographic severance.");
    }
  }
}

async function kickVerb(name: string, targetNpub: string): Promise<void> {
  const ctx = await controlContext(name);
  const target = toHexPubkey(targetNpub);
  requireCanActOn(ctx, target, Permissions.KICK, "kick");

  // Strip roles first, then the cooperative guestbook kick directive.
  const hasGrant = ctx.folded.roster.grants.some((g) => g.member === target && g.roleIds.length > 0);
  if (hasGrant && canActOnMember(ctx.folded.roster, ctx.pubkey, ctx.folded.ownerHex, target, Permissions.MANAGE_ROLES)) {
    const head = ctx.folded.heads.get(bytesToHex(grantLocator(ctx.community.id, hex32(target))));
    await publishEdition(
      ctx,
      buildGrantEdition(ctx.community.id, { member: target, roleIds: [] }, {
        actorPubkey: ctx.pubkey,
        version: head ? head.version + 1n : 1n,
        prevHash: head?.hash,
      }),
      `strip roles → ${target.slice(0, 12)}…`,
    );
  }
  const gb = currentGuestbookGroup(ctx.community);
  const kick = buildKickRumor(ctx.pubkey, target, Date.now());
  await publishAll(ctx.community.relays, await sealGuestbook(kick, gb, ctx.signer), `kick → ${target.slice(0, 12)}…`);
  console.log(`Kicked ${target.slice(0, 12)}…`);
}

// ── Channels ────────────────────────────────────────────────────────────────

async function channelVerb(name: string, sub: string | undefined, args: string[]): Promise<void> {
  const ctx = await controlContext(name);
  const resolveId = async (selector: string | undefined): Promise<string | undefined> => {
    if (!selector) return undefined;
    for (const [id, ch] of ctx.folded.channels) {
      if (id === selector || ch.name === selector) return id;
    }
    throw new Error(`No channel named/id "${selector}"`);
  };

  if (sub === "list") {
    for (const [id, ch] of ctx.folded.channels) {
      console.log(`  ${ch.name} (${id.slice(0, 12)}…)${ch.deleted ? " [deleted]" : ""}${ch.isPrivate ? " [private]" : ""}`);
    }
    return;
  }

  if (!canActOnPosition(ctx.folded.roster, ctx.pubkey, ctx.folded.ownerHex, 1, Permissions.MANAGE_CHANNELS)) {
    throw new Error("You need MANAGE_CHANNELS to change channels.");
  }

  if (sub === "create") {
    const nameArg = args[0];
    if (!nameArg) throw new Error("channel create needs <name>");
    const id = bytesToHex(random32());
    await publishEdition(
      ctx,
      buildChannelEdition(hex32(id), { name: nameArg, private: args.includes("--private") }, { actorPubkey: ctx.pubkey, version: 1n }),
      `channel create ${nameArg}`,
    );
    console.log(`Created channel ${nameArg} (${id.slice(0, 12)}…).`);
    return;
  }

  if (sub === "rename") {
    const id = await resolveId(args[0]);
    if (!id || !args[1]) throw new Error("channel rename needs <id-or-name> <name>");
    const head = ctx.folded.heads.get(id);
    const existing = ctx.folded.channels.get(id)!;
    await publishEdition(
      ctx,
      buildChannelEdition(hex32(id), { name: args[1], private: existing.isPrivate }, {
        actorPubkey: ctx.pubkey,
        version: head ? head.version + 1n : 1n,
        prevHash: head?.hash,
      }),
      `channel rename ${args[1]}`,
    );
    console.log(`Renamed channel to ${args[1]}.`);
    return;
  }

  if (sub === "delete") {
    const id = await resolveId(args[0]);
    if (!id) throw new Error("channel delete needs <id-or-name>");
    const head = ctx.folded.heads.get(id);
    const existing = ctx.folded.channels.get(id)!;
    await publishEdition(
      ctx,
      buildChannelEdition(hex32(id), { name: existing.name, private: existing.isPrivate, deleted: true }, {
        actorPubkey: ctx.pubkey,
        version: head ? head.version + 1n : 1n,
        prevHash: head?.hash,
      }),
      `channel delete ${existing.name}`,
    );
    console.log(`Deleted channel ${existing.name}.`);
    return;
  }

  throw new Error("channel needs: list | create <name> [--private] | rename <id-or-name> <name> | delete <id-or-name>");
}

// ── Metadata ────────────────────────────────────────────────────────────────

async function metaVerb(name: string, sub: string | undefined, args: string[]): Promise<void> {
  const ctx = await controlContext(name);
  if (sub === "get" || sub === undefined) {
    const m = ctx.folded.metadata;
    if (!m) {
      console.log("(no metadata edition yet)");
      return;
    }
    console.log(`name: ${m.name}`);
    if (m.description) console.log(`description: ${m.description}`);
    if (m.icon) console.log(`icon: ${m.icon.url}`);
    if (m.banner) console.log(`banner: ${m.banner.url}`);
    console.log(`relays: ${m.relays.join(", ")}`);
    if (m.repo) console.log(`repo: ${m.repo}`);
    return;
  }
  if (sub === "set") {
    const current: CommunityMetadata = ctx.folded.metadata ?? { name: ctx.community.name, relays: ctx.community.relays };
    const next: CommunityMetadata = { ...current };
    for (const pair of args) {
      const eq = pair.indexOf("=");
      if (eq < 1) throw new Error(`malformed assignment "${pair}" — expected key=value`);
      const k = pair.slice(0, eq);
      const v = pair.slice(eq + 1);
      if (k === "name") next.name = v.trim();
      else if (k === "description") next.description = v.trim() || undefined;
      else if (k === "relays") next.relays = v.split(",").map((s) => s.trim()).filter(Boolean);
      else if (k === "repo") next.repo = v.trim() || undefined;
      else throw new Error(`unknown metadata key "${k}"`);
    }
    const head = ctx.folded.heads.get(ctx.community.idHex);
    await publishEdition(
      ctx,
      buildMetadataEdition(ctx.community.id, next, {
        actorPubkey: ctx.pubkey,
        version: head ? head.version + 1n : 1n,
        prevHash: head?.hash,
      }),
      "metadata edition",
    );
    console.log(`Updated metadata: name=${next.name} · relays=${next.relays.length}`);
    return;
  }
  throw new Error("meta needs: get | set key=value […]");
}

// ── Members ─────────────────────────────────────────────────────────────────

/** Owner-only: publish the terminal dissolution tombstone for the community. */
async function dissolveVerb(name: string): Promise<void> {
  const ctx = await controlContext(name);
  if (ctx.pubkey !== ctx.community.owner) {
    throw new Error("Only the owner can dissolve the community.");
  }
  const wrap = await sealDissolved(ctx.community.id, ctx.pubkey, ctx.signer);
  await publishAll(ctx.community.relays, wrap, "dissolution tombstone");
  console.log(`Dissolved ${ctx.community.name}. The community is now terminal for everyone.`);
}

async function membersVerb(name: string, json: boolean): Promise<void> {
  const ctx = await controlContext(name);
  const gb = currentGuestbookGroup(ctx.community);
  const gbWraps = await queryAll(ctx.community.relays, { kinds: [KIND_WRAP], authors: [gb.pk] });
  const members = new Map<string, string>();
  for (const wrap of gbWraps.sort((a, b) => a.created_at - b.created_at)) {
    try {
      const opened = openWrap(wrap, gb);
      if (opened.kind === 3306) members.set(opened.author, opened.content);
    } catch {
      // skip
    }
  }
  const roster = ctx.folded.roster;
  const rows = [...members].map(([pk, status]) => ({
    pubkey: pk,
    npub: nip19.npubEncode(pk),
    status,
    badge: badgeOf(roster, pk) ?? null,
    banned: ctx.folded.banned.has(pk),
  }));
  if (json) {
    console.log(JSON.stringify({ community: ctx.community.name, members: rows }, null, 2));
    return;
  }
  for (const r of rows) {
    const badge = r.badge ? ` [${r.badge}]` : "";
    const ban = r.banned ? " ⛔banned" : "";
    console.log(`  ${r.npub} — ${r.status}${badge}${ban}`);
  }
}


async function joinBao(name: string, inviteUrl: string): Promise<void> {
  if (existsSync(statePath(name))) throw new Error(`Identity "${name}" already exists — use say/read.`);
  const parsed = parseInviteLink(inviteUrl.trim());
  if (!parsed) throw new Error("Not a recognizable invite link.");

    const discoveryRelays = [...new Set([...parsed.bootstrapRelays, CANONICAL_BAO_RELAY])];
  const events = await queryAll(discoveryRelays, {
    kinds: [KIND_INVITE_BUNDLE],
    authors: [parsed.linkSigner],
    "#d": [""],
    // NO limit: a relay holding several editions may satisfy limit:1 with a
    // STALE one (a live bundle superseded by its revocation tombstone).
  });
  // Newest edition wins — but a revocation tombstone wins TIES (and anything
  // older): created_at has second granularity, so a revoked-then-reshown live
  // bundle can tie the tombstone, and a relay's delivery order is not a trust
  // signal. Only a strictly-newer live bundle (a genuine re-mint) overrides
  // revocation.
  const ts = (e: (typeof events)[number]) => e.created_at;
  const maxTs = events.reduce((m, e) => Math.max(m, ts(e)), 0);
  const atMax = events.filter((e) => ts(e) === maxTs);
  const newest =
    atMax.find((e) => e.tags.some((t) => t[0] === "vsk" && t[1] === VSK_INVITE_REVOKED)) ?? atMax[0];
  // parseBundleEvent can throw an InviteError with a precise code, but the raw
  // message reads like 'bundle decrypt: invalid MAC' — opaque to an agent that
  // held nothing but a link. Wrap it so a stale/revoked/expired link returns a
  // one-line next action instead of a stack trace: 'ask the owner to re-issue
  // via bao-agent invite'.
  let bundle: InviteBundle;
  try {
    bundle = parseBundleEvent(newest, parsed.linkSigner, parsed.token, Date.now());
  } catch (e) {
    if (e instanceof InviteError) {
      const linkSignerNpub = nip19.npubEncode(parsed.linkSigner);
      const hint =
        e.code === 'bad-bundle'
          ? `This invite link is no longer valid — its token doesn't decrypt the live bundle on ${CANONICAL_BAO_RELAY} (owner ${linkSignerNpub.slice(0, 16)}… re-minted it). Ask the owner to re-issue via 'bao-agent invite'.`
          : e.message;
      throw new Error(`${e.message}\n${hint}`);
    }
    throw e;
  }

  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);

  const community = communityOf(
    {
      id: bundle.community_id,
      owner: bundle.owner,
      owner_salt: bundle.owner_salt,
      community_root: bundle.community_root,
      root_epoch: bundle.root_epoch,
      name: bundle.name,
      relays: bundle.relays,
    },
    bundle.channels,
  );

  // The agent gate is NOT a refusal for us — it's the captcha we solve. Fold
  // the metadata, and if the community is gated, grind the Join's PoW.
  const control = currentControlGroup(community);
  const controlWraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [control.pk] });
  const folded = foldControlState(openControlWraps(controlWraps, [control]), community.id, community.owner);
  const gate = agentGateOf(folded.metadata);
  if (gate) console.log(`  agent_gate detected (pow, difficulty ${gate.difficulty}) — grinding…`);

  // Every Join from this link cites the token commitment (sha256 of the
  // unlock token). A single-use link is spent once the Guestbook shows one.
  const commitment = inviteCommitment(parsed.token);
  if (bundle.max_uses === 1) {
    const gb = currentGuestbookGroup(community);
    const gbWraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [gb.pk] });
    if (singleUseLinkUsed(openGuestbookOpened(openGuestbookWraps(gbWraps, [gb])), commitment)) {
      throw new Error("That invite link was single-use and has already been used. Ask for a fresh one.");
    }
  }

  const attribution = { creator: bundle.creator_npub ?? "", ...(bundle.label ? { label: bundle.label } : {}), commitment };
  const joinedAt = Date.now();
  const rumor = gate
    ? grindJoinRumor(pubkey, joinedAt, gate.difficulty, attribution)
    : buildJoinRumor(pubkey, joinedAt, attribution);
  await publishAll(
    community.relays,
    await sealGuestbook(rumor, currentGuestbookGroup(community), signer),
    gate ? `guestbook join (pow ≥ ${gate.difficulty})` : "guestbook join",
  );

  // Single-use links: the spend check above is check-then-act, so two
  // CONCURRENT joiners can both pass it and both post a Join — the fold is
  // per-npub and can't dedupe a commitment (it can't tell single-use links
  // from multi-use). Nostr has no atomic claim, so the loser SELF-EJECTS
  // instead: re-fold, and if an earlier Join (lower ms, tie → lower rumor id)
  // cites the same commitment, we lost the race — exit WITHOUT saving state,
  // so the losing agent never acts as a member. (Its Join stays on the
  // guestbook as a ghost until the owner sweeps/kicks; only a rekey truly
  // excludes it. Documented in docs/ORCHESTRATION.md.)
  if (bundle.max_uses === 1) {
    const gb = currentGuestbookGroup(community);
    const myMs = resolveMs(rumor.created_at, rumor.tags);
    const earlierJoinWins = async (): Promise<boolean> => {
      const gbWraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [gb.pk] });
      const rival = openGuestbookOpened(openGuestbookWraps(gbWraps, [gb]))
        .filter((ev) => joinCommitmentOf(ev) === commitment)
        .map((ev) => ({ ms: ev.ms, id: ev.rumorId }))
        .sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
      return rival !== undefined && (rival.ms < myMs || (rival.ms === myMs && rival.id < rumor.id));
    };
    // Immediate re-fold, then one settle beat for a rival still in flight.
    let lost = await earlierJoinWins();
    if (!lost) {
      await new Promise((r) => setTimeout(r, 1500));
      lost = await earlierJoinWins();
    }
    if (lost) {
      console.error("  ✗ That single-use link was spent by a CONCURRENT join (earlier Join on the guestbook) — you are NOT a member. Ask for a fresh link.");
      process.exitCode = 2;
      return;
    }
  }

  const state: State = {
    sk: bytesToHex(sk),
    role: "member",
    community: {
      id: bundle.community_id,
      owner: bundle.owner,
      owner_salt: bundle.owner_salt,
      community_root: bundle.community_root,
      root_epoch: bundle.root_epoch,
      held_roots: [],
      joined_at: Date.now(),
      name: bundle.name,
      relays: bundle.relays,
    },
    private_channels: bundle.channels,
    invites: [],
    registry_version: 0,
    protocol_version: PROTOCOL_VERSION,
  };
  saveState(name, state);
  console.log(`\nJoined "${bundle.name}" as "${name}": ${nip19.npubEncode(pubkey)}`);
  console.log(`State: ${statePath(name)}`);
}

async function say(name: string, text: string, idemKey: string | undefined, channelSelector: string | undefined, json: boolean): Promise<void> {
  const state = loadState(name);
  const channel = await resolveChannel(state, channelSelector);
  const { rumorId, deduped } = await sendChannelMessage(state, text, { idemKey, channel: channel.idHex });
  if (json) {
    console.log(JSON.stringify({ rumor_id: rumorId, deduped, channel: { id: channel.idHex, name: channel.name, private: channel.isPrivate, epoch: Number(channel.current.epoch) } }));
  } else if (deduped) {
    console.log(`  ⓘ --key ${idemKey} already sent (rumor ${rumorId.slice(0, 12)}…) — deduped`);
  }
}

async function read(name: string, channelSelector: string | undefined, json: boolean): Promise<void> {
  const state = loadState(name);
  const community = communityOf(state.community, state.private_channels);
  const channel = await resolveChannel(state, channelSelector);
  const messages = await channelMessages(state, channel.idHex);

  // Member list from the guestbook.
  const gb = currentGuestbookGroup(community);
  const gbWraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [gb.pk] });
  const members = new Map<string, string>(); // pubkey → last state
  for (const wrap of gbWraps.sort((a, b) => a.created_at - b.created_at)) {
    try {
      const opened = openWrap(wrap, gb);
      if (opened.kind === 3306) members.set(opened.author, opened.content);
    } catch {
      // skip
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          community: community.name,
          channel: { id: channel.idHex, name: channel.name, private: channel.isPrivate, epoch: Number(channel.current.epoch) },
          channels: await listChannels(state),
          messages: messages.map((m) => ({
            id: m.id,
            author: m.author,
            author_npub: nip19.npubEncode(m.author),
            ms: m.ms,
            content: m.content,
            tags: m.tags,
          })),
          members: [...members].map(([pk, status]) => ({ pubkey: pk, npub: nip19.npubEncode(pk), status })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\n#${channel.name} — ${messages.length} message(s):`);
  for (const m of messages) {
    const time = new Date(m.ms).toISOString().replace("T", " ").slice(0, 19);
    console.log(`  [${time}] ${nip19.npubEncode(m.author).slice(0, 16)}…: ${m.content}`);
  }

  console.log(`\nMembers (${[...members.values()].filter((s) => s === "join").length}):`);
  for (const [pk, status] of members) {
    console.log(`  ${nip19.npubEncode(pk)} — ${status}`);
  }

  // Single-use sweep (owner): a single-use link dies the moment the Guestbook
  // shows a Join citing its token commitment — tombstone the bundle and drop
  // the coordinate from the Registry, like the app's useSingleUseSweep2.
  if (state.role === "owner") {
    await withStateLock(name, async () => {
      // Re-read under the lock — a concurrent invite may have landed since
      // the load at the top of read(); writing the stale array back would
      // silently drop it.
      const fresh = loadState(name);
      const opened = openGuestbookOpened(openGuestbookWraps(gbWraps, [gb]));
      const spent = fresh.invites.filter(
        (inv) => inv.max_uses === 1 && singleUseLinkUsed(opened, inviteCommitment(hexToBytes(inv.token))),
      );
      if (spent.length === 0) return;
      // Compute the FULL surviving set before publishing the registry: building
      // the edition mid-scan (the old loop) omitted unspent links that sorted
      // after a spent one — members would see an incomplete live-invite list.
      const remaining = fresh.invites.filter((inv) => !spent.includes(inv));
      const sk = hexToBytes(fresh.sk);
      const signer = signerOf(sk);
      for (const inv of spent) {
        await publishAll(community.relays, buildRevocationEvent(hexToBytes(inv.link_sk)), `single-use tombstone (${inv.url.slice(0, 60)}…)`);
        console.log(`  ⓘ single-use link spent${inv.label ? ` ("${inv.label}")` : ""} — auto-revoked`);
      }
      fresh.registry_version += 1;
      await publishAll(
        community.relays,
        await sealEdition(
          buildRegistryEdition(community.id, getPublicKey(sk), remaining.map((i) => i.link_pk), {
            actorPubkey: getPublicKey(sk),
            version: BigInt(fresh.registry_version),
          }),
          currentControlGroup(community),
          signer,
        ),
        "invite registry edition",
      );
      fresh.invites = remaining;
      saveState(name, fresh);
    });
  }
}

async function waitMode(
  name: string,
  opts: { timeoutSec: number; mentionsOnly: boolean; channel?: string; json: boolean },
): Promise<void> {
  const state = loadState(name);
  const channel = await resolveChannel(state, opts.channel);
  const hit = await waitForInterrupt(name, state, { ...opts, channel: channel.idHex });
  if (!hit) {
    if (opts.json) console.log(JSON.stringify({ timeout: true, channel: { id: channel.idHex, name: channel.name } }));
    else console.log("(timeout — no matching message)");
    process.exitCode = 2;
    return;
  }
  if (opts.json) {
    console.log(
      JSON.stringify({ timeout: false, channel: { id: channel.idHex, name: channel.name }, id: hit.id, author: hit.author, author_npub: nip19.npubEncode(hit.author), ms: hit.ms, content: hit.content, tags: hit.tags }),
    );
  } else {
    const time = new Date(hit.ms).toISOString().replace("T", " ").slice(0, 19);
    console.log(`[${time}] ${nip19.npubEncode(hit.author).slice(0, 16)}…: ${hit.content}`);
  }
}

async function orchVerb(name: string, verb: OrchVerb, taskId: string, text: string, orchId: string): Promise<void> {
  const state = loadState(name);
  const { rumorId, deduped, held, epoch } = await orchVerbPost(state, verb, taskId, text, orchId);
  // Fencing: the claim is only a claim while we hold it at our epoch. A loss
  // or refusal is exit 2 (Buzz-style no-result) so calling scripts stop.
  if (verb === "CLAIM") {
    if (held === true) console.log(`  ✓ CLAIM ${taskId} held at epoch ${epoch} (rumor ${rumorId.slice(0, 12)}…${deduped ? ", deduped retry" : ""})`);
    else if (held === null) {
      console.log(`  ? CLAIM ${taskId} published at epoch ${epoch} but not visible yet — re-check: orch show --orch ${orchId}`);
      process.exitCode = 2;
    } else {
      console.log(`  ✗ CLAIM ${taskId} NOT held — another claimant won (epoch ${epoch}). Do NOT work this task.`);
      process.exitCode = 2;
    }
    return;
  }
  if (held === false) {
    console.log(`  ✗ ${verb} ${taskId} refused — task held by another claimant (epoch ${epoch}). Do NOT work this task.`);
    process.exitCode = 2;
    return;
  }
  if (deduped) console.log(`  ⓘ ${verb} ${taskId} already posted — deduped`);
}

async function orchShow(name: string, orchId: string, json: boolean): Promise<void> {
  const state = loadState(name);
  const states = await orchStates(state, orchId);

  if (json) {
    console.log(
      JSON.stringify(
        {
          orch: orchId,
          ttl_ms: CLAIM_TTL_MS,
          tasks: [...states.values()].map((s) => ({ ...s, claimant_npub: nip19.npubEncode(s.claimant) })),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (states.size === 0) {
    console.log(`orch "${orchId}": no task messages found`);
    process.exitCode = 2;
    return;
  }
  console.log(`\norch "${orchId}" — ${states.size} task(s):`);
  for (const s of states.values()) {
    const status = s.done ? "DONE" : s.released ? "HANDED OFF (reclaimable)" : s.blocked ? "BLOCKED" : s.stale ? "STALE (reclaimable)" : "claimed";
    console.log(
      `  ${s.taskId}: ${status} — ${nip19.npubEncode(s.claimant).slice(0, 16)}… (epoch ${s.epoch}, claim ${s.claimId.slice(0, 8)}…, last activity ${new Date(s.lastProgressMs).toISOString()})`,
    );
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Flags whose NEXT token is a value (not a positional arg). */
const VALUE_FLAGS = ["--as", "--key", "--orch", "--timeout", "--name", "--label", "--channel"];

/** Positional args: everything that isn't a --flag or a value flag's value. */
function positionalArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.includes(a)) {
      i++; // skip the flag's value too
      continue;
    }
    if (a.startsWith("--")) continue;
    out.push(a);
  }
  return out;
}

/** `help [cmd]` — list all commands, or full docs for one. */
async function helpVerb(_as: string, cmd?: string): Promise<void> {
  if (cmd) {
    const c = findCommand(cmd);
    if (!c) throw new Error(`No command "${cmd}" — run 'help' to list them.`);
    console.log(renderCommandDoc(c));
    return;
  }
  console.log(`\n₿AO agent commands (${BAO_COMMANDS.length}). Type 'help <command>' for details, or 'shell' for the interactive terminal.`);
  console.log(renderCommandHelp());
  console.log("\nEvery command is also a chat slash-command: type '/' in a ₿AO channel to see them.");
}

/** `shell` — an interactive terminal that runs every registry command. */
async function shellMode(): Promise<void> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  console.log("₿AO agent shell — type a command, 'help', or 'exit'. Tab completes verbs.");
  rl.on("line", async (raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line === "exit" || line === "quit") return rl.close();
    const [verb, ...rest] = line.split(/\s+/);
    const cmd = findCommand(verb);
    if (!cmd) {
      console.log(`Unknown command "${verb}" — run 'help'.`);
      return;
    }
    try {
      await mainDispatch(verb, rest, line);
    } catch (e) {
      console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  rl.on("close", () => process.exit(0));
}

/** Re-run the CLI dispatcher from inside the shell (re-entrant entry point). */
async function mainDispatch(mode: string, rest: string[], _line: string): Promise<void> {
  const as = argValue(rest, "--as") ?? "owner";
  const json = rest.includes("--json");
  switch (mode) {
    case "shell":
      await shellMode();
      break;
    case "create":
      await create(as, argValue(rest, "--name") ?? "₿AO agent hangout — live test", rest.includes("--agent-only"));
      break;
    case "invite":
      await invite(as, argValue(rest, "--label"), rest.includes("--single-use"), !rest.includes("--human"));
      break;
    case "join": {
      const url = positionalArgs(rest)[0];
      if (!url) throw new Error("join needs an invite URL");
      await joinBao(as, url);
      break;
    }
    case "say": {
      const text = positionalArgs(rest).join(" ");
      if (!text) throw new Error("say needs text");
      await say(as, text, argValue(rest, "--key"), argValue(rest, "--channel"), json);
      break;
    }
    case "read":
      await read(as, argValue(rest, "--channel"), json);
      break;
    case "admin":
      await adminVerb(as, positionalArgs(rest)[0], positionalArgs(rest)[1], argValue(rest, "--role"));
      break;
    case "ban":
      await banVerb(as, positionalArgs(rest)[0]);
      break;
    case "unban":
      await banVerb(as, positionalArgs(rest)[0], true);
      break;
    case "kick":
      await kickVerb(as, positionalArgs(rest)[0]);
      break;
    case "channel":
      await channelVerb(as, positionalArgs(rest)[0], rest);
      break;
    case "meta":
      await metaVerb(as, positionalArgs(rest)[0], positionalArgs(rest).slice(1));
      break;
    case "members":
      await membersVerb(as, json);
      break;
    case "dissolve":
      await dissolveVerb(as);
      break;
    case "help":
      await helpVerb(as, positionalArgs(rest)[0]);
      break;
    case "project": {
      const snapshot = await projectSnapshot(loadState(as));
      if (json) console.log(JSON.stringify(snapshot));
      else {
        console.log(`\n${snapshot.name} — ${snapshot.coordinate}`);
        if (snapshot.description) console.log(snapshot.description);
        console.log(`  ${snapshot.issues.length} issue(s), ${snapshot.pull_requests.length} pull request(s), ${snapshot.patches.length} patch(es)${snapshot.partial ? " (partial result; use a repository client for full history)" : ""}`);
        for (const issue of snapshot.issues) console.log(`  issue ${issue.id.slice(0, 12)}… [${issue.status ?? "unmarked"}] ${issue.subject}`);
        for (const pr of snapshot.pull_requests) console.log(`  PR    ${pr.id.slice(0, 12)}… [${pr.status ?? "unmarked"}] ${pr.subject}`);
      }
      break;
    }
    case "wait": {
      const timeoutSec = Number(argValue(rest, "--timeout") ?? "60");
      if (!Number.isFinite(timeoutSec) || timeoutSec < 1 || timeoutSec > 300) {
        throw new Error("--timeout must be 1..300 seconds");
      }
      await waitMode(as, { timeoutSec, mentionsOnly: !rest.includes("--all"), channel: argValue(rest, "--channel"), json });
      break;
    }
    case "orch": {
      const pos = positionalArgs(rest);
      const sub = pos[0];
      const orchId = argValue(rest, "--orch") ?? "cards";
      if (sub === "show") {
        await orchShow(as, orchId, json);
        break;
      }
      const verb = (sub ?? "").toUpperCase() as OrchVerb;
      if (!["CLAIM", "PROGRESS", "DONE", "BLOCKED", "ACK", "HANDOFF"].includes(verb)) {
        throw new Error("orch needs: show | claim|progress|done|blocked|ack|handoff <taskId> [text]");
      }
      const taskId = pos[1];
      if (!taskId) throw new Error(`orch ${sub} needs a taskId`);
      await orchVerb(as, verb, taskId, pos.slice(2).join(" "), orchId);
      break;
    }
    case "whoami": {
      const state = loadState(as);
      console.log(`${as}: ${nip19.npubEncode(getPublicKey(hexToBytes(state.sk)))} (${state.role} of ${state.community.name})`);
      break;
    }
    case "purge": {
      const p = statePath(as);
      if (!existsSync(p)) throw new Error(`No state for "${as}" at ${p}`);
      unlinkSync(p);
      console.log(`Purged local state for "${as}" — BAO identity deleted.`);
      break;
    }
    case "work": {
      const pos = positionalArgs(rest);
      const sub = pos[0];
      const dryRun = rest.includes("--dry-run");
      if (sub === "list") {
        printWorkListing(await listWork(loadState(as)), json);
        break;
      }
      if (sub === "request") {
        const amountSats = Number(pos[1]);
        const purpose = pos.slice(2).join(" ");
        if (!Number.isFinite(amountSats) || amountSats <= 0) throw new Error("work request needs <sats> <purpose>");
        if (!purpose) throw new Error("work request needs a purpose");
        const id = await requestCredits(loadState(as), amountSats, purpose, dryRun);
        console.log(`${dryRun ? "[dry-run] " : ""}compute-credit request ${id.slice(0, 16)}… (${amountSats} sats): ${purpose}`);
        break;
      }
      if (sub === "fulfill") {
        const requestId = pos[1];
        const requester = pos[2];
        const amountSats = Number(pos[3]);
        if (!requestId || !requester || !Number.isFinite(amountSats) || amountSats <= 0) {
          throw new Error("work fulfill needs <requestId> <requesterNpub> <sats>");
        }
        const id = await fulfillCredits(loadState(as), requestId, resolvePubkey(requester), amountSats, dryRun);
        console.log(`${dryRun ? "[dry-run] " : ""}compute-credit fulfillment ${id.slice(0, 16)}… for ${requestId.slice(0, 12)}…`);
        break;
      }
      if (sub === "receipt") {
        const requestId = pos[1];
        const amountSats = Number(pos[2]);
        const note = pos.slice(3).join(" ");
        if (!requestId || !Number.isFinite(amountSats) || amountSats <= 0) throw new Error("work receipt needs <requestId> <sats> <note>");
        const id = await receiptCredits(loadState(as), requestId, amountSats, note || "redeemed for inference", [], dryRun);
        console.log(`${dryRun ? "[dry-run] " : ""}compute-credit receipt ${id.slice(0, 16)}… for ${requestId.slice(0, 12)}…`);
        break;
      }
      throw new Error("work needs: list | request <sats> <purpose> | fulfill <reqId> <requesterNpub> <sats> | receipt <reqId> <sats> <note>  [--dry-run]");
    }
    case "wallet": {
      const state = loadState(as);
      const pubkey = getPublicKey(hexToBytes(state.sk));
      const events = await queryAll(state.community.relays, { kinds: [17375], authors: [pubkey] });
      if (events.length === 0) {
        console.log(`No NIP-60 wallet config (kind 17375) found for ${nip19.npubEncode(pubkey)} on these relays.`);
        console.log("Publish a wallet config first via the web client or another NIP-60 wallet.");
        break;
      }
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      try {
        const convKey = nip44.getConversationKey(hexToBytes(pubkey), hexToBytes(pubkey));
        const decrypted = nip44.decrypt(latest.content, convKey);
        const config = JSON.parse(decrypted) as { mints?: string[]; unit?: string };
        console.log(`Wallet config for ${nip19.npubEncode(pubkey)}:`);
        console.log(`  unit: ${config.unit ?? "sat"}`);
        console.log(`  mints (${config.mints?.length ?? 0}):`);
        for (const m of config.mints ?? []) console.log(`    ${m}`);
      } catch {
        console.log(`Found kind 17375 event but could not decrypt it.`);
      }
      break;
    }
    case "import": {
      const token = positionalArgs(rest)[0];
      if (!token) throw new Error("import needs a Cashu token string");
      const decoded = getDecodedToken(token);
      const totalSats = decoded.token.proofs.reduce((sum, p) => sum + p.amount, 0);
      if (json) {
        console.log(JSON.stringify({ mint: decoded.token.mint, proofs: decoded.token.proofs.map((p) => ({ id: p.id, amount: p.amount })), totalSats }));
      } else {
        console.log(`\nCashu token decoded:`);
        console.log(`  mint: ${decoded.token.mint}`);
        console.log(`  proofs: ${decoded.token.proofs.length}`);
        console.log(`  total: ${totalSats} sats`);
        for (const p of decoded.token.proofs) console.log(`    ${p.id.slice(0, 16)}… ${p.amount} msat`);
      }
      break;
    }
    case "routstr": {
      const routstrSub = positionalArgs(rest)[0];
      if (routstrSub === "fuel") {
        const [live] = rest.includes("--live") ? [true] : [false];
        const pState = loadParadiseState(as);
        const fuel = live ? await readFuel(pState) : pState.simRoutstrMsats;
        console.log(`"${as}" fuel: ${fuel} msat${pState.routstrKey ? " (live key)" : " (sim)"} · cashu wallet: ${pState.cashuMsats} msat`);
      } else if (routstrSub === "topup") {
        const name = positionalArgs(rest)[0];
        const token = positionalArgs(rest)[1];
        if (!name || !token) throw new Error("routstr topup needs <name> <cashuToken>");
        const state = loadParadiseState(name);
        if (!state.routstrKey) throw new Error(`"${name}" has no Routstr key — run 'routstr redeem ${name} <token>' first.`);
        const balance = await routstrTopupWithCashu(state.routstrKey, token);
        state.simRoutstrMsats = balance;
        saveParadiseState(name, state);
        console.log(`topped up "${name}" → ${balance} msat`);
      } else if (routstrSub === "redeem") {
        const name = positionalArgs(rest)[0];
        const token = positionalArgs(rest)[1];
        if (!name || !token) throw new Error("routstr redeem needs <name> <cashuToken>");
        const state = loadParadiseState(name);
        const { apiKey, balance } = await routstrCreateFromCashu(token);
        state.routstrKey = apiKey;
        state.simRoutstrMsats = balance;
        saveParadiseState(name, state);
        console.log(`redeemed Cashu into a Routstr key for "${name}"`);
        console.log(`  sk_ key: ${apiKey} (bearer — stored locally, never publish)`);
        console.log(`  balance: ${balance} msat`);
      } else {
        throw new Error("routstr needs: fuel | topup <name> <token> | redeem <name> <token>");
      }
      break;
    }
    case "think": {
      const prompt = positionalArgs(rest).join(" ");
      if (!prompt) throw new Error("think needs a prompt string");
      const pState = loadParadiseState(as);
      if (!pState.routstrKey) throw new Error(`"${as}" has no Routstr key — run 'routstr redeem ${as} <token>' first.`);
      const res = await fetch("https://api.routstr.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pState.routstrKey}` },
        body: JSON.stringify({ model: "routstr", messages: [{ role: "user", content: prompt }], max_tokens: 2048 }),
      });
      if (!res.ok) throw new Error(`Routstr API returned ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content ?? "(no response)";
      if (json) {
        console.log(JSON.stringify({ prompt, response: content }));
      } else {
        console.log(`\n${content}`);
      }
      break;
    }
    default:
      console.log("Run 'help' for the full command list.");
  }
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  await mainDispatch(mode ?? "", rest, "");
}

main()
  .catch((err) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    closePool(HOME_RELAYS);
    // nostr-tools keeps sockets alive; give CLOSE a beat, then hard-exit.
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  });
