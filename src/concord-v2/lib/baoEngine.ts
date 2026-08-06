/**
 * ₿AO Engine — the single, transport-agnostic implementation of every command
 * the headless CLI, the in-page terminal (`window.bao`) and the `/` palette
 * can run. Built once here, driven from anywhere via {@link BaoRelay} and
 * {@link BaoStore}.
 *
 * Before this file, `scripts/bao-agent.ts` (Node) and `src/lib/baoTermDispatch.ts`
 * (browser) each reimplemented create/invite/join/say/read on different
 * transports. That duplication is gone: every verb lives here, and the two
 * surfaces are thin adapters over the same two seams.
 */

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { mintCommunity } from "@/concord-v2/lib/community";
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
import { banlistLocator, grantLocator, hex32, random32 } from "@/concord-v2/lib/derive";
import {
  adminRole,
  badgeOf,
  canActOnMember,
  canActOnPosition,
  emptyRoles,
  moderatorRole,
  Permissions,
  rolesOf,
  type Role,
} from "@/concord-v2/lib/roles";
import type { CommunityMetadata } from "@/concord-v2/lib/types";
import {
  buildJoinRumor,
  buildKickRumor,
  currentGuestbookGroup,
  joinCommitmentOf,
  openGuestbookOpened,
  openGuestbookWraps,
  sealGuestbook,
  singleUseLinkUsed,
} from "@/concord-v2/lib/guestbook";
import {
  buildBundleEvent,
  buildInviteUrl,
  inviteCommitment,
  mintLinkSigner,
  mintToken,
  parseBundleEvent,
  parseInviteLink,
  type InviteBundle,
} from "@/concord-v2/lib/invite";
import {
  AGENT_GATE_METADATA_KEY,
  DEFAULT_AGENT_GATE_DIFFICULTY,
  agentGateOf,
  grindJoinRumor,
} from "@/concord-v2/lib/agentGate";
import { channelsView } from "@/concord-v2/lib/community";
import {
  buildRumor,
  channelBindingTags,
  checkChannelBinding,
  openWrap,
  resolveMs,
  sealRumor,
  wrapSeal,
  type OpenedEvent,
  type StreamSigner,
} from "@/concord-v2/lib/stream";
import { KIND_INVITE_BUNDLE, KIND_JOIN_LEAVE, KIND_WRAP, VSK_INVITE_REVOKED } from "@/concord-v2/lib/kinds";
import type { ChannelV2, CommunityV2 } from "@/concord-v2/lib/types";

import {
  err,
  ok,
  resolveIdentity,
  toHexPubkey,
  validateIdentityName,
  HOME_RELAYS_DEFAULT,
  type BaoIdentity,
  type BaoRelay,
  type BaoResult,
  type BaoStore,
} from "./baoCore";
import { BAO_COMMANDS, findCommand, renderCommandHelp } from "./commands";

// ── Pure helpers shared by every verb ────────────────────────────────────────

function signerOf(sk: Uint8Array): StreamSigner {
  return {
    signEvent: async (template) => {
      const { finalizeEvent } = await import("nostr-tools/pure");
      return finalizeEvent(template, sk);
    },
  };
}

function communityOf(identity: BaoIdentity): CommunityV2 {
  const c = identity.community;
  const root = hexToBytes(c.community_root);
  const heldRoots = [
    { epoch: BigInt(c.root_epoch), key: root },
    ...(c.held_roots ?? []).map((h) => ({ epoch: BigInt(h.epoch), key: hexToBytes(h.key) })),
  ];
  return {
    id: hexToBytes(c.id),
    idHex: c.id,
    owner: c.owner,
    ownerSalt: hexToBytes(c.owner_salt),
    root,
    rootEpoch: BigInt(c.root_epoch),
    heldRoots,
    privateChannels: identity.private_channels.map((ch) => ({
      id: hexToBytes(ch.id),
      key: hexToBytes(ch.key),
      epoch: BigInt(ch.epoch),
      name: ch.name,
    })),
    relays: c.relays,
    name: c.name,
    refounder: c.refounder,
    admins: c.admins ?? [c.owner],
  };
}

/** Fold the current control plane for a community (for admin/moderation verbs). */
async function foldControl(relay: BaoRelay, community: CommunityV2) {
  const control = currentControlGroup(community);
  const wraps = await relay.query({ kinds: [KIND_WRAP], authors: [control.pk] }, community.relays);
  return foldControlState(openControlWraps(wraps, [control]), community.id, community.owner);
}

/** Seal + broadcast one control edition. */
async function publishEdition(relay: BaoRelay, community: CommunityV2, signer: StreamSigner, rumor: ReturnType<typeof buildMetadataEdition>, label: string): Promise<void> {
  const wrap = await sealEdition(rumor, currentControlGroup(community), signer);
  await relay.publish(community.relays, wrap, label);
}

/** Fold a community's channel view (for say/read). */
async function resolveChannel(relay: BaoRelay, community: CommunityV2, selector?: string, generalId?: string): Promise<ChannelV2> {
  const folded = await foldControl(relay, community);
  const channels = channelsView(community, folded);
  let matches: ChannelV2[];
  if (selector) {
    const needle = selector.trim();
    matches = /^[0-9a-f]{64}$/i.test(needle)
      ? channels.filter((c) => c.idHex === needle.toLowerCase())
      : channels.filter((c) => c.name.toLowerCase() === needle.toLowerCase());
  } else {
    const saved = generalId?.toLowerCase();
    matches = saved ? channels.filter((c) => c.idHex === saved) : [];
    if (matches.length === 0) matches = channels.filter((c) => !c.isPrivate && c.name.toLowerCase() === "general");
    if (matches.length === 0) matches = channels.filter((c) => !c.isPrivate).slice(0, 1);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Channel ${JSON.stringify(selector)} is ambiguous; use its 64-hex id.`);
  const available = channels.map((c) => `${c.name} (${c.idHex})`).join(", ");
  throw new Error(`Channel ${JSON.stringify(selector ?? "general")} not found.${available ? ` Available: ${available}` : ""}`);
}

/** Read a channel's decrypted message list. */
async function channelMessages(relay: BaoRelay, community: CommunityV2, identity: BaoIdentity, channel: ChannelV2) {
  const streams = new Map(channel.streams.map((s) => [s.group.pk, s]));
  const wraps = await relay.query({ kinds: [KIND_WRAP], authors: [...streams.keys()] }, community.relays);
  const out: Array<{ id: string; author: string; ms: number; content: string; tags: string[][] }> = [];
  const seen = new Set<string>();
  for (const wrap of wraps) {
    if (seen.has(wrap.id)) continue;
    seen.add(wrap.id);
    const stream = streams.get(wrap.pubkey);
    if (!stream) continue;
    let opened: OpenedEvent;
    try {
      opened = openWrap(wrap, stream.group);
    } catch {
      continue;
    }
    if (opened.sealKind !== 20013) continue;
    try {
      checkChannelBinding(opened, channel.idHex, stream.epoch);
    } catch {
      continue;
    }
    if (opened.kind !== 9) continue;
    out.push({ id: opened.rumorId, author: opened.author, ms: opened.ms, content: opened.content, tags: opened.tags });
  }
  out.sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// ── Identity verbs ───────────────────────────────────────────────────────────

/** A key-only identity — registered a key but not yet in any community. The
 *  `id` stays empty (so `isKeyOnly` detects it); the other fields are valid hex
 *  placeholders so filesystem stores that validate community fields accept it. */
const KEY_ONLY_COMMUNITY = { id: "", owner: "0".repeat(64), owner_salt: "0".repeat(64), community_root: "0".repeat(64), root_epoch: 0, name: "", relays: [] };

function isKeyOnly(identity: BaoIdentity): boolean {
  return !identity.community.id;
}

/** Reuse an existing key-only identity's key, else generate a fresh one. */
function resolveIdentityKey(store: BaoStore, identityName: string, nsec?: string): Uint8Array {
  const existing = store.get(identityName);
  if (existing) {
    if (!isKeyOnly(existing)) throw new Error(`Identity "${identityName}" already exists — use say/read or remove it first.`);
    return hexToBytes(existing.sk);
  }
  if (nsec) {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== "nsec") throw new Error("--nsec must be an nsec1… secret key");
    return decoded.data;
  }
  return generateSecretKey();
}

/** Create or activate a local identity (register). A bare `login` mints a key
 *  and saves a key-only identity that `join`/`create` then upgrade into a
 *  member/owner of a community. */
async function loginVerb(store: BaoStore, args: { name?: string; nsec?: string; identityName?: string }): Promise<unknown> {
  const name = validateIdentityName(args.name ?? args.identityName ?? "agent");
  const existing = store.get(name);
  if (existing) {
    store.setActive(name);
    const pubkey = existing.pubkey ?? (existing.sk ? getPublicKey(hexToBytes(existing.sk)) : undefined);
    return { identity: name, npub: pubkey ? nip19.npubEncode(pubkey) : null, existing: true };
  }
  const sk = resolveIdentityKey(store, name, args.nsec);
  const identity: BaoIdentity = {
    sk: bytesToHex(sk),
    pubkey: getPublicKey(sk),
    role: "member",
    identity_name: name,
    community: KEY_ONLY_COMMUNITY,
    private_channels: [],
    invites: [],
    registry_version: 0,
  };
  store.save(identity);
  return { identity: name, npub: nip19.npubEncode(getPublicKey(sk)), registered: true, note: "Key created. Use `join <invite> --as <name>` or `create --as <name>` to enter a ₿AO." };
}

async function createVerb(store: BaoStore, relay: BaoRelay, args: { name?: string; identityName?: string; agentOnly?: boolean; relays?: string[] }): Promise<unknown> {
  const name = args.name?.trim();
  if (!name) throw new Error("create needs --name <name>");
  const identityName = validateIdentityName(args.identityName ?? "owner");
  const sk = resolveIdentityKey(store, identityName, undefined);
  const relays = args.relays?.length ? args.relays : HOME_RELAYS_DEFAULT;

  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);
  const { community, generalChannelId } = mintCommunity(name, pubkey, relays);

  await relay.publish(
    community.relays,
    await sealEdition(
      buildMetadataEdition(community.id, { name, relays: community.relays, ...(args.agentOnly ? { [AGENT_GATE_METADATA_KEY]: { type: "pow", difficulty: DEFAULT_AGENT_GATE_DIFFICULTY } } : {}) }, { actorPubkey: pubkey, version: 1n }),
      currentControlGroup(community),
      signer,
    ),
    "metadata edition",
  );
  await relay.publish(
    community.relays,
    await sealEdition(buildChannelEdition(generalChannelId, { name: "general", private: false }, { actorPubkey: pubkey, version: 1n }), currentControlGroup(community), signer),
    "#general channel edition",
  );
  await relay.publish(
    community.relays,
    await sealGuestbook(args.agentOnly ? grindJoinRumor(pubkey, Date.now(), DEFAULT_AGENT_GATE_DIFFICULTY) : buildJoinRumor(pubkey, Date.now()), currentGuestbookGroup(community), signer),
    "founder join",
  );

  const identity: BaoIdentity = {
    sk: bytesToHex(sk),
    role: "owner",
    identity_name: identityName,
    registry_version: 0,
    invites: [],
    private_channels: [],
    community: {
      id: community.idHex,
      owner: pubkey,
      owner_salt: bytesToHex(community.ownerSalt),
      community_root: bytesToHex(community.root),
      root_epoch: Number(community.rootEpoch),
      name,
      relays: community.relays,
      general_channel_id: bytesToHex(generalChannelId),
      joined_at: Date.now(),
    },
  };
  store.save(identity);

  const inviteUrl = await mintInviteInternal(store, relay, identity, { label: "invited from the ₿AO terminal", agent: true });
  return {
    identity: identityName,
    role: "owner",
    community: { id: community.idHex, name, relays: community.relays, agent_only: !!args.agentOnly },
    npub: nip19.npubEncode(pubkey),
    first_invite: inviteUrl,
  };
}

async function mintInviteInternal(store: BaoStore, relay: BaoRelay, identity: BaoIdentity, opts: { label?: string; singleUse?: boolean; agent?: boolean }): Promise<string> {
  const sk = hexToBytes(identity.sk);
  const pubkey = getPublicKey(sk);
  const community = communityOf(identity);
  if (!(community.admins ?? [community.owner]).includes(pubkey)) throw new Error("Only admins can mint invites.");
  const signer = signerOf(sk);

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
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.singleUse ? { max_uses: 1 } : {}),
    ...(opts.agent ? { audience: "agent" } : {}),
  };
  await relay.publish(community.relays, buildBundleEvent(bundle, token, link.sk), "invite bundle");

  identity.registry_version += 1;
  await relay.publish(
    community.relays,
    await sealEdition(
      buildRegistryEdition(community.id, pubkey, identity.invites.map((i) => i.link_pk).concat(link.pk), { actorPubkey: pubkey, version: BigInt(identity.registry_version) }),
      currentControlGroup(community),
      signer,
    ),
    "invite registry edition",
  );
  const url = ["https://2140.wtf", "http://localhost:3500"].map((origin) => buildInviteUrl(origin, link.pk, token, community.relays))[0];
  identity.invites.push({
    token: bytesToHex(token),
    link_pk: link.pk,
    link_sk: bytesToHex(link.sk),
    url,
    created_at: Math.floor(Date.now() / 1000),
    ...(opts.singleUse ? { max_uses: 1 } : {}),
    ...(opts.label ? { label: opts.label } : {}),
  });
  store.save(identity);
  return url;
}

async function inviteVerb(store: BaoStore, relay: BaoRelay, args: { identityName?: string; label?: string; singleUse?: boolean; human?: boolean }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  return { url: await mintInviteInternal(store, relay, identity, { label: args.label, singleUse: args.singleUse, agent: !args.human }) };
}

async function joinVerb(store: BaoStore, relay: BaoRelay, args: { inviteUrl?: string; identityName?: string }): Promise<unknown> {
  if (!args.inviteUrl) throw new Error("join needs an invite URL");
  const identityName = validateIdentityName(args.identityName ?? "agent");
  const sk = resolveIdentityKey(store, identityName, undefined);
  const parsed = parseInviteLink(args.inviteUrl.trim());
  if (!parsed) throw new Error("Not a recognizable invite link.");

  const events = await relay.query({ kinds: [KIND_INVITE_BUNDLE], authors: [parsed.linkSigner], "#d": [""] }, parsed.bootstrapRelays);
  const ts = (e: { created_at: number }) => e.created_at;
  const maxTs = events.reduce((m, e) => Math.max(m, ts(e)), 0);
  const atMax = events.filter((e) => ts(e) === maxTs);
  const newest = atMax.find((e) => e.tags.some((t) => t[0] === "vsk" && t[1] === VSK_INVITE_REVOKED)) ?? atMax[0];
  if (!newest) throw new Error("Couldn't find that invite on its relays.");
  const bundle = parseBundleEvent(newest, parsed.linkSigner, parsed.token, Date.now());

  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);

  const community: CommunityV2 = {
    id: hexToBytes(bundle.community_id),
    idHex: bundle.community_id,
    owner: bundle.owner,
    ownerSalt: hexToBytes(bundle.owner_salt),
    root: hexToBytes(bundle.community_root),
    rootEpoch: BigInt(bundle.root_epoch),
    heldRoots: [{ epoch: BigInt(bundle.root_epoch), key: hexToBytes(bundle.community_root) }],
    privateChannels: bundle.channels.map((ch) => ({ id: hexToBytes(ch.id), key: hexToBytes(ch.key), epoch: BigInt(ch.epoch), name: ch.name })),
    relays: bundle.relays,
    name: bundle.name,
    refounder: undefined,
    admins: [bundle.owner],
  };

  const gate = agentGateOf((await foldControl(relay, community)).metadata);
  const commitment = inviteCommitment(parsed.token);
  if (bundle.max_uses === 1) {
    const gb = currentGuestbookGroup(community);
    const gbWraps = await relay.query({ kinds: [KIND_WRAP], authors: [gb.pk] }, community.relays);
    if (singleUseLinkUsed(openGuestbookOpened(openGuestbookWraps(gbWraps, [gb])), commitment)) {
      throw new Error("That invite link was single-use and has already been used. Ask for a fresh one.");
    }
  }

  const attribution = { creator: bundle.creator_npub ?? "", ...(bundle.label ? { label: bundle.label } : {}), commitment };
  const joinedAt = Date.now();
  const rumor = gate ? grindJoinRumor(pubkey, joinedAt, gate.difficulty, attribution) : buildJoinRumor(pubkey, joinedAt, attribution);
  await relay.publish(community.relays, await sealGuestbook(rumor, currentGuestbookGroup(community), signer), gate ? `guestbook join (pow ≥ ${gate.difficulty})` : "guestbook join");

  if (bundle.max_uses === 1) {
    const gb = currentGuestbookGroup(community);
    const myMs = resolveMs(rumor.created_at, rumor.tags);
    const earlierJoinWins = async (): Promise<boolean> => {
      const gbWraps = await relay.query({ kinds: [KIND_WRAP], authors: [gb.pk] }, community.relays);
      const rival = openGuestbookOpened(openGuestbookWraps(gbWraps, [gb]))
        .filter((ev) => joinCommitmentOf(ev) === commitment)
        .map((ev) => ({ ms: ev.ms, id: ev.rumorId }))
        .sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
      return rival !== undefined && (rival.ms < myMs || (rival.ms === myMs && rival.id < rumor.id));
    };
    let lost = await earlierJoinWins();
    if (!lost) {
      await new Promise((r) => setTimeout(r, 1500));
      lost = await earlierJoinWins();
    }
    if (lost) throw new Error("That single-use link was spent by a concurrent join — you lost the race.");
  }

  const identity: BaoIdentity = {
    sk: bytesToHex(sk),
    role: "member",
    identity_name: identityName,
    registry_version: 0,
    invites: [],
    private_channels: bundle.channels,
    community: {
      id: bundle.community_id,
      owner: bundle.owner,
      owner_salt: bundle.owner_salt,
      community_root: bundle.community_root,
      root_epoch: bundle.root_epoch,
      name: bundle.name,
      relays: bundle.relays,
      joined_at: Date.now(),
    },
  };
  store.save(identity);

  return { identity: identityName, role: "member", community: { id: community.idHex, name: community.name, relays: community.relays, agent_gated: !!gate }, npub: nip19.npubEncode(pubkey) };
}

async function sayVerb(store: BaoStore, relay: BaoRelay, args: { text?: string; channel?: string; key?: string; identityName?: string }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  if (!args.text) throw new Error("say needs text.");
  const sk = hexToBytes(identity.sk);
  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);
  const community = communityOf(identity);
  const channel = await resolveChannel(relay, community, args.channel, identity.community.general_channel_id);

  if (args.key) {
    const existing = await channelMessages(relay, community, identity, channel);
    const dupe = existing.find((m) => m.author === pubkey && m.tags.some((t) => t[0] === "d" && t[1] === args.key));
    if (dupe) return { rumor_id: dupe.id, deduped: true };
  }

  const tags: string[][] = channelBindingTags(channel.idHex, channel.current.epoch);
  if (args.key) tags.push(["d", args.key]);
  for (const match of args.text.match(/npub1[02-9ac-hj-np-z]{20,}/g) ?? []) {
    try {
      const decoded = nip19.decode(match);
      if (decoded.type === "npub") tags.push(["p", decoded.data]);
    } catch {
      /* not a valid npub — leave as plain text */
    }
  }

  const rumor = buildRumor({ kind: 9, content: args.text, tags, pubkey, ms: Date.now() });
  const seal = await sealRumor(rumor, 20013, channel.current.group, signer);
  const wrap = wrapSeal(seal, channel.current.group);
  await relay.publish(community.relays, wrap, `message to #${channel.name}`);
  return { rumor_id: rumor.id, deduped: false, channel: { id: channel.idHex, name: channel.name, private: channel.isPrivate, epoch: Number(channel.current.epoch) } };
}

async function readVerb(store: BaoStore, relay: BaoRelay, args: { channel?: string; identityName?: string; limit?: number }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  const community = communityOf(identity);
  const channel = await resolveChannel(relay, community, args.channel, identity.community.general_channel_id);
  const messages = await channelMessages(relay, community, identity, channel);
  const trimmed = typeof args.limit === "number" && args.limit > 0 ? messages.slice(-args.limit) : messages;

  const gb = currentGuestbookGroup(community);
  const gbWraps = await relay.query({ kinds: [KIND_WRAP], authors: [gb.pk] }, community.relays);
  const members: { pubkey: string; npub: string; status: string }[] = [];
  const seen = new Map<string, string>();
  for (const wrap of gbWraps.sort((a, b) => a.created_at - b.created_at)) {
    try {
      const opened = openWrap(wrap, gb);
      if (opened.kind === KIND_JOIN_LEAVE) seen.set(opened.author, opened.content);
    } catch {
      /* skip */
    }
  }
  for (const [pubkey, status] of seen) members.push({ pubkey, npub: nip19.npubEncode(pubkey), status });

  return {
    community: community.name,
    channel: { id: channel.idHex, name: channel.name, private: channel.isPrivate, epoch: Number(channel.current.epoch) },
    messages: trimmed.map((m) => ({ id: m.id, author: m.author, author_npub: nip19.npubEncode(m.author), ms: m.ms, content: m.content, tags: m.tags })),
    members,
  };
}

async function whoamiVerb(store: BaoStore, args: { identityName?: string }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  const pubkey = identity.pubkey ?? (identity.sk ? getPublicKey(hexToBytes(identity.sk)) : undefined);
  if (!pubkey) throw new Error("This identity has no key to report.");
  return { identity: identity.identity_name, role: identity.role, community: { id: identity.community.id, name: identity.community.name, relays: identity.community.relays }, npub: nip19.npubEncode(pubkey) };
}

function identitiesVerb(store: BaoStore): unknown {
  return {
    identities: store.list().map((name) => {
      const id = store.get(name)!;
      return { name, role: id.role, community: id.community.name, npub: nip19.npubEncode(getPublicKey(hexToBytes(id.sk))), active: store.getActive() === name };
    }),
    active: store.getActive(),
  };
}

function switchVerb(store: BaoStore, args: { name?: string }): unknown {
  if (!args.name) throw new Error("use needs an identity name.");
  store.setActive(args.name);
  return { active: args.name };
}

function removeVerb(store: BaoStore, args: { identityName?: string }): unknown {
  const identity = resolveIdentity(store, args.identityName);
  store.remove(identity.identity_name);
  return { removed: identity.identity_name };
}

/** Clear the active identity selector (no key is deleted — use `remove` for that). */
function logoutVerb(store: BaoStore): unknown {
  store.setActive("");
  return { active: null, note: "Cleared the active identity. Your keys are still saved — use <name> to switch back." };
}

// ── Roles ────────────────────────────────────────────────────────────────────

async function adminVerb(store: BaoStore, relay: BaoRelay, args: { sub?: string; target?: string; role?: string; identityName?: string }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  const community = communityOf(identity);
  const sk = hexToBytes(identity.sk);
  const signer = signerOf(sk);
  const pubkey = getPublicKey(sk);
  const folded = await foldControl(relay, community);
  const roster = folded.roster ?? emptyRoles();
  const ownerHex = folded.ownerHex;

  if (args.sub === "roles") {
    if (!args.target) throw new Error("admin roles needs <npub>");
    const member = toHexPubkey(args.target);
    return { member, roles: rolesOf(roster, member).map((r) => ({ name: r.name, position: r.position })) };
  }

  if (args.sub === "grant") {
    if (!args.target) throw new Error("admin grant needs <npub>");
    const member = toHexPubkey(args.target);
    const tier: "admin" | "moderator" = args.role === "moderator" ? "moderator" : "admin";
    if (!canActOnMember(roster, pubkey, ownerHex, member, Permissions.MANAGE_ROLES)) throw new Error("You don't outrank this member.");
    const minted: Role | undefined = tier === "admin" ? adminRole(bytesToHex(random32())) : moderatorRole(bytesToHex(random32()));
    if (minted && !canActOnPosition(roster, pubkey, ownerHex, minted.position, Permissions.MANAGE_ROLES)) {
      throw new Error(tier === "admin" ? "Only the owner can grant Admin." : "You can't grant a role at this rank.");
    }
    let roleId: string | undefined = roster.roles.find((r) => r.name === (tier === "admin" ? "Admin" : "Moderator"))?.roleId;
    if (!roleId && minted) {
      roleId = minted.roleId;
      await publishEdition(relay, community, signer, buildRoleEdition(minted, { actorPubkey: pubkey, version: 1n }), `role ${roleId.slice(0, 12)}…`);
    }
    const grantEid = bytesToHex(grantLocator(community.id, hex32(member)));
    const head = folded.heads.get(grantEid);
    await publishEdition(
      relay, community, signer,
      buildGrantEdition(community.id, { member, roleIds: roleId ? [roleId] : [] }, { actorPubkey: pubkey, version: head ? head.version + 1n : 1n, prevHash: head?.hash }),
      `grant ${tier} → ${member.slice(0, 12)}…`,
    );
    return { granted: member, tier };
  }

  if (args.sub === "revoke") {
    if (!args.target) throw new Error("admin revoke needs <npub>");
    const member = toHexPubkey(args.target);
    if (!canActOnMember(roster, pubkey, ownerHex, member, Permissions.MANAGE_ROLES)) throw new Error("You don't outrank this member.");
    const grantEid = bytesToHex(grantLocator(community.id, hex32(member)));
    const head = folded.heads.get(grantEid);
    await publishEdition(
      relay, community, signer,
      buildGrantEdition(community.id, { member, roleIds: [] }, { actorPubkey: pubkey, version: head ? head.version + 1n : 1n, prevHash: head?.hash }),
      `revoke roles → ${member.slice(0, 12)}…`,
    );
    return { revoked: member };
  }

  throw new Error("admin needs: grant <npub> [--role admin|moderator] | revoke <npub> | roles <npub>");
}

// ── Moderation ───────────────────────────────────────────────────────────────

async function banVerb(store: BaoStore, relay: BaoRelay, args: { target?: string; unban?: boolean; identityName?: string }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  const community = communityOf(identity);
  const sk = hexToBytes(identity.sk);
  const signer = signerOf(sk);
  const pubkey = getPublicKey(sk);
  if (!args.target) throw new Error(`ban needs <npub>`);
  const target = toHexPubkey(args.target);
  const folded = await foldControl(relay, community);
  if (!canActOnMember(folded.roster, pubkey, folded.ownerHex, target, Permissions.BAN)) throw new Error("You don't have permission to ban this member.");

  const next = new Set(folded.banned);
  if (args.unban) next.delete(target);
  else next.add(target);
  const head = folded.heads.get(bytesToHex(banlistLocator(community.id)));
  await publishEdition(
    relay, community, signer,
    buildBanlistEdition(community.id, [...next], { actorPubkey: pubkey, version: head ? head.version + 1n : 1n, prevHash: head?.hash }),
    `banlist (${[...next].length} banned)`,
  );
  const isPublic = folded.liveInviteLinks.size > 0;
  return { banned: target, unban: args.unban, public_community: isPublic };
}

async function kickVerb(store: BaoStore, relay: BaoRelay, args: { target?: string; identityName?: string }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  const community = communityOf(identity);
  const sk = hexToBytes(identity.sk);
  const signer = signerOf(sk);
  const pubkey = getPublicKey(sk);
  if (!args.target) throw new Error("kick needs <npub>");
  const target = toHexPubkey(args.target);
  const folded = await foldControl(relay, community);
  if (!canActOnMember(folded.roster, pubkey, folded.ownerHex, target, Permissions.KICK)) throw new Error("You don't have permission to kick this member.");

  const hasGrant = folded.roster.grants.some((g) => g.member === target && g.roleIds.length > 0);
  if (hasGrant && canActOnMember(folded.roster, pubkey, folded.ownerHex, target, Permissions.MANAGE_ROLES)) {
    const head = folded.heads.get(bytesToHex(grantLocator(community.id, hex32(target))));
    await publishEdition(
      relay, community, signer,
      buildGrantEdition(community.id, { member: target, roleIds: [] }, { actorPubkey: pubkey, version: head ? head.version + 1n : 1n, prevHash: head?.hash }),
      `strip roles → ${target.slice(0, 12)}…`,
    );
  }
  const gb = currentGuestbookGroup(community);
  const kick = buildKickRumor(pubkey, target, Date.now());
  await relay.publish(community.relays, await sealGuestbook(kick, gb, signer), `kick → ${target.slice(0, 12)}…`);
  return { kicked: target };
}

// ── Channels ─────────────────────────────────────────────────────────────────

async function channelVerb(store: BaoStore, relay: BaoRelay, args: { sub?: string; args?: string[]; identityName?: string }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  const community = communityOf(identity);
  const sk = hexToBytes(identity.sk);
  const signer = signerOf(sk);
  const pubkey = getPublicKey(sk);
  const folded = await foldControl(relay, community);
  const pos = args.args ?? [];
  const sub = args.sub;

  const resolveId = async (selector: string | undefined): Promise<string | undefined> => {
    if (!selector) return undefined;
    for (const [id, ch] of folded.channels) if (id === selector || ch.name === selector) return id;
    throw new Error(`No channel named/id "${selector}"`);
  };

  if (sub === "list") {
    return [...folded.channels].map(([id, ch]) => ({ id, name: ch.name, private: ch.isPrivate, deleted: ch.deleted }));
  }

  if (!canActOnPosition(folded.roster, pubkey, folded.ownerHex, 1, Permissions.MANAGE_CHANNELS)) throw new Error("You need MANAGE_CHANNELS to change channels.");

  if (sub === "create") {
    const name = pos[0];
    if (!name) throw new Error("channel create needs <name>");
    const id = bytesToHex(random32());
    await publishEdition(relay, community, signer, buildChannelEdition(hex32(id), { name, private: pos.includes("--private") }, { actorPubkey: pubkey, version: 1n }), `channel create ${name}`);
    return { id, name };
  }
  if (sub === "rename") {
    const id = await resolveId(pos[0]);
    if (!id || !pos[1]) throw new Error("channel rename needs <id-or-name> <name>");
    const existing = folded.channels.get(id)!;
    const head = folded.heads.get(id);
    await publishEdition(relay, community, signer, buildChannelEdition(hex32(id), { name: pos[1], private: existing.isPrivate }, { actorPubkey: pubkey, version: head ? head.version + 1n : 1n, prevHash: head?.hash }), `channel rename ${pos[1]}`);
    return { id, name: pos[1] };
  }
  if (sub === "delete") {
    const id = await resolveId(pos[0]);
    if (!id) throw new Error("channel delete needs <id-or-name>");
    const existing = folded.channels.get(id)!;
    const head = folded.heads.get(id);
    await publishEdition(relay, community, signer, buildChannelEdition(hex32(id), { name: existing.name, private: existing.isPrivate, deleted: true }, { actorPubkey: pubkey, version: head ? head.version + 1n : 1n, prevHash: head?.hash }), `channel delete ${existing.name}`);
    return { deleted: existing.name };
  }

  throw new Error("channel needs: list | create <name> [--private] | rename <id-or-name> <name> | delete <id-or-name>");
}

// ── Metadata ─────────────────────────────────────────────────────────────────

async function metaVerb(store: BaoStore, relay: BaoRelay, args: { sub?: string; args?: string[]; identityName?: string }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  const community = communityOf(identity);
  const sk = hexToBytes(identity.sk);
  const signer = signerOf(sk);
  const pubkey = getPublicKey(sk);
  const folded = await foldControl(relay, community);
  const pos = args.args ?? [];
  const sub = args.sub;

  if (sub === "get" || sub === undefined) {
    return folded.metadata ?? null;
  }
  if (sub === "set") {
    const current: CommunityMetadata = folded.metadata ?? { name: community.name, relays: community.relays };
    const next: CommunityMetadata = { ...current };
    for (const pair of pos) {
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
    const head = folded.heads.get(community.idHex);
    await publishEdition(relay, community, signer, buildMetadataEdition(community.id, next, { actorPubkey: pubkey, version: head ? head.version + 1n : 1n, prevHash: head?.hash }), "metadata edition");
    return { name: next.name, relays: next.relays.length };
  }
  throw new Error("meta needs: get | set key=value […]");
}

// ── Members ──────────────────────────────────────────────────────────────────

async function membersVerb(store: BaoStore, relay: BaoRelay, args: { identityName?: string }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  const community = communityOf(identity);
  const folded = await foldControl(relay, community);
  const gb = currentGuestbookGroup(community);
  const gbWraps = await relay.query({ kinds: [KIND_WRAP], authors: [gb.pk] }, community.relays);
  const members = new Map<string, string>();
  for (const wrap of gbWraps.sort((a, b) => a.created_at - b.created_at)) {
    try {
      const opened = openWrap(wrap, gb);
      if (opened.kind === KIND_JOIN_LEAVE) members.set(opened.author, opened.content);
    } catch {
      /* skip */
    }
  }
  return {
    community: community.name,
    members: [...members].map(([pk, status]) => ({
      pubkey: pk,
      npub: nip19.npubEncode(pk),
      status,
      badge: badgeOf(folded.roster, pk) ?? null,
      banned: folded.banned.has(pk),
    })),
  };
}

// ── Dissolve (owner only) ────────────────────────────────────────────────────

async function dissolveVerb(store: BaoStore, relay: BaoRelay, args: { identityName?: string }): Promise<unknown> {
  const identity = resolveIdentity(store, args.identityName);
  const community = communityOf(identity);
  if (getPublicKey(hexToBytes(identity.sk)) !== community.owner) throw new Error("Only the owner can dissolve the community.");
  const wrap = await sealDissolved(community.id, community.owner, signerOf(hexToBytes(identity.sk)));
  await relay.publish(community.relays, wrap, "dissolution tombstone");
  return { dissolved: community.name };
}

// ── Help ─────────────────────────────────────────────────────────────────────

function helpVerb(): unknown {
  return { commands: BAO_COMMANDS.map((c) => ({ cmd: c.verb, args: c.usage, description: c.summary, access: c.access, scope: c.scope })) };
}

// ── Top-level dispatch ───────────────────────────────────────────────────────

export interface BaoDispatchArgs {
  identityName?: string;
  name?: string;
  text?: string;
  channel?: string;
  key?: string;
  limit?: number;
  label?: string;
  singleUse?: boolean;
  human?: boolean;
  agentOnly?: boolean;
  relays?: string[];
  inviteUrl?: string;
  nsec?: string;
  sub?: string;
  target?: string;
  role?: string;
  args?: string[];
  unban?: boolean;
  [k: string]: unknown;
}

/** Run one command against the store + relay seams. Never throws; returns an envelope. */
export async function dispatchBao(
  store: BaoStore,
  relay: BaoRelay,
  command: string,
  raw: BaoDispatchArgs = {},
): Promise<BaoResult> {
  try {
    let result: unknown;
    switch (command) {
      case "create": result = await createVerb(store, relay, { name: raw.name, identityName: raw.identityName, agentOnly: raw.agentOnly, relays: raw.relays }); break;
      case "login": result = await loginVerb(store, { name: raw.name, nsec: raw.nsec, identityName: raw.identityName }); break;
      case "invite": result = await inviteVerb(store, relay, { identityName: raw.identityName, label: raw.label, singleUse: raw.singleUse, human: raw.human }); break;
      case "join": result = await joinVerb(store, relay, { inviteUrl: raw.inviteUrl, identityName: raw.identityName }); break;
      case "say": result = await sayVerb(store, relay, { text: raw.text, channel: raw.channel, key: raw.key, identityName: raw.identityName }); break;
      case "read": result = await readVerb(store, relay, { channel: raw.channel, identityName: raw.identityName, limit: raw.limit }); break;
      case "whoami": result = await whoamiVerb(store, argsOf(raw)); break;
      case "identities": result = identitiesVerb(store); break;
      case "use": result = switchVerb(store, { name: raw.name }); break;
      case "remove": result = removeVerb(store, argsOf(raw)); break;
      case "logout": result = logoutVerb(store); break;
      case "admin": result = await adminVerb(store, relay, { sub: raw.sub, target: raw.target, role: raw.role, identityName: raw.identityName }); break;
      case "ban": result = await banVerb(store, relay, { target: raw.target, identityName: raw.identityName }); break;
      case "unban": result = await banVerb(store, relay, { target: raw.target, unban: true, identityName: raw.identityName }); break;
      case "kick": result = await kickVerb(store, relay, { target: raw.target, identityName: raw.identityName }); break;
      case "channel": result = await channelVerb(store, relay, { sub: raw.sub, args: raw.args, identityName: raw.identityName }); break;
      case "meta": result = await metaVerb(store, relay, { sub: raw.sub, args: raw.args, identityName: raw.identityName }); break;
      case "members": result = await membersVerb(store, relay, argsOf(raw)); break;
      case "dissolve": result = await dissolveVerb(store, relay, argsOf(raw)); break;
      case "help": result = helpVerb(); break;
      default: return err(`Unknown command: ${command}. Run 'help'.`);
    }
    return ok(result);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

function argsOf(raw: BaoDispatchArgs): { identityName?: string } {
  return { identityName: raw.identityName };
}

// ── CLI string parser (shared by the in-page terminal and the CLI's --as form) ──

/** Minimal POSIX-ish tokenizer: quoted strings, --flag value, --flag=value. */
export function parseCommandLine(line: string): { command: string; args: BaoDispatchArgs; positional: string[] } | { error: string } {
  const trimmed = line.trim();
  if (!trimmed) return { error: "empty" };
  const tokens: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
    if (i >= trimmed.length) break;
    const ch = trimmed[i];
    if (ch === '"' || ch === "'") {
      const close = trimmed.indexOf(ch, i + 1);
      if (close < 0) return { error: "unterminated quote" };
      tokens.push(trimmed.slice(i + 1, close));
      i = close + 1;
    } else {
      let end = i;
      while (end < trimmed.length && !/\s/.test(trimmed[end])) end++;
      tokens.push(trimmed.slice(i, end));
      i = end;
    }
  }
  const [command, ...rest] = tokens;
  const args: BaoDispatchArgs = {};
  const positional: string[] = [];
  const valueFlags = new Set(["--name", "--label", "--as", "--channel", "--key", "--limit", "--relays", "--role", "--sub", "--target"]);
  const boolFlags = new Set(["--agent-only", "--single-use", "--human", "--json", "--private"]);
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      if (eq >= 0) { args[camelFlag(t.slice(0, eq))] = t.slice(eq + 1); continue; }
      if (boolFlags.has(t)) { args[camelFlag(t)] = true; continue; }
      if (valueFlags.has(t)) { args[camelFlag(t)] = rest[++j]; continue; }
      args[camelFlag(t)] = true;
    } else {
      positional.push(t);
    }
  }
  if (positional.length > 0) {
    if (command === "say" && !("text" in args)) args.text = positional.join(" ");
    else if (command === "join" && !("inviteUrl" in args)) args.inviteUrl = positional[0];
    else if (command === "use" && !("name" in args)) args.name = positional[0];
    else if ((command === "ban" || command === "unban" || command === "kick") && !("target" in args)) args.target = positional[0];
    else if (command === "admin" && !("sub" in args)) { args.sub = positional[0]; if (positional[1]) args.target = positional[1]; }
    else if ((command === "channel" || command === "meta") && !("sub" in args)) { args.sub = positional[0]; args.args = positional.slice(1); }
  }
  return { command, args, positional };
}

function camelFlag(flag: string): string {
  return flag.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Re-export for registry-driven help in the CLI/REPL. */
export const commands = { BAO_COMMANDS, findCommand, renderCommandHelp };
