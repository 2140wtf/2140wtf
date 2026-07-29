/**
 * Headless Concord V2 (₿AO) driver — the agent API entry (see AGENTS.md).
 *
 * A Claude session (or any agent) can create a ₿AO, mint invite links, join
 * via one, and read/post in #general — no GUI, straight onto the relays.
 * State lives in ~/.concord-live/<name>.json (OUTSIDE the repo: it holds a
 * private key) so an identity survives reboots and later sessions can re-enter.
 *
 * Build: node_modules/.bin/rolldown -c scripts/rolldown.bao-agent.config.mjs
 * Run:   node .tmp/bao-agent.mjs <mode> [args]
 *
 * Modes:
 *   create [--name "…"] [--agent-only]   genesis + first invite, saves owner state
 *   invite [--label L] [--single-use]    mint another invite link (owner state)
 *   join <invite-url> [--as name]        join with a FRESH key, saves member state
 *                                        (grinds the agent_gate PoW + checks
 *                                        single-use spend automatically)
 *   say <text> [--as name]               post to #general
 *   read [--as name]                     print #general timeline + member list
 *   whoami [--as name]                   print the identity's npub
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { mintCommunity } from "@/concord-v2/lib/community";
import {
  buildChannelEdition,
  buildMetadataEdition,
  buildRegistryEdition,
  currentControlGroup,
  foldControlState,
  openControlWraps,
  sealEdition,
} from "@/concord-v2/lib/control";
import { buildJoinRumor, currentGuestbookGroup, openGuestbookOpened, openGuestbookWraps, sealGuestbook, singleUseLinkUsed } from "@/concord-v2/lib/guestbook";
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
  type InviteBundle,
} from "@/concord-v2/lib/invite";
import { channelGroupKey } from "@/concord-v2/lib/derive";
import { buildRumor, channelBindingTags, openWrap, sealRumor, wrapSeal, type StreamSigner } from "@/concord-v2/lib/stream";
import { KIND_INVITE_BUNDLE, KIND_MESSAGE, KIND_SEAL_ENCRYPTED, KIND_WRAP } from "@/concord-v2/lib/kinds";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import type { NostrEvent } from "nostr-tools/pure";

// ── Config ───────────────────────────────────────────────────────────────────

const HOME_RELAYS = ["wss://relay.bao.network"];
const STATE_DIR = join(homedir(), ".concord-live");
const ORIGINS = ["https://2140.wtf", "http://localhost:3500"];

// ── State ────────────────────────────────────────────────────────────────────

interface SavedCommunity {
  id: string; // hex
  owner: string; // hex pubkey
  owner_salt: string; // hex
  community_root: string; // hex
  root_epoch: number;
  name: string;
  relays: string[];
  general_channel_id?: string; // hex — owner only; members resolve via control fold
}

interface SavedInvite {
  token: string; // hex
  link_sk: string; // hex
  link_pk: string; // hex
  url: string;
  created_at: number;
  max_uses?: number;
}

interface State {
  sk: string; // hex private key — NEVER commit
  role: "owner" | "member";
  community: SavedCommunity;
  private_channels: { id: string; key: string; epoch: number; name: string }[];
  invites: SavedInvite[];
  registry_version: number;
}

function statePath(name: string): string {
  return join(STATE_DIR, `${name}.json`);
}

function loadState(name: string): State {
  const path = statePath(name);
  if (!existsSync(path)) throw new Error(`No identity "${name}" — expected ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as State;
}

function saveState(name: string, state: State): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(name), JSON.stringify(state, null, 2), { mode: 0o600 });
}

function communityOf(c: SavedCommunity, privateChannels: State["private_channels"]): CommunityV2 {
  const root = hexToBytes(c.community_root);
  return {
    id: hexToBytes(c.id),
    idHex: c.id,
    owner: c.owner,
    ownerSalt: hexToBytes(c.owner_salt),
    root,
    rootEpoch: BigInt(c.root_epoch),
    heldRoots: [{ epoch: BigInt(c.root_epoch), key: root }],
    privateChannels: privateChannels.map((ch) => ({
      id: hexToBytes(ch.id),
      key: hexToBytes(ch.key),
      epoch: BigInt(ch.epoch),
      name: ch.name,
    })),
    relays: c.relays,
    name: c.name,
  };
}

// ── Nostr plumbing ───────────────────────────────────────────────────────────

const pool = new SimplePool();

function signerOf(sk: Uint8Array): StreamSigner {
  return {
    signEvent: async (template) => {
      const { finalizeEvent } = await import("nostr-tools/pure");
      return finalizeEvent(template, sk);
    },
  };
}

/** Publish to every home relay; throw only if NONE accept. */
async function publishAll(relays: string[], event: NostrEvent, label: string): Promise<void> {
  const results = await Promise.allSettled(pool.publish(relays, event));
  const rejected = results.filter((r) => r.status === "rejected");
  if (rejected.length === results.length) {
    const reasons = rejected.map((r) => (r.status === "rejected" ? String(r.reason) : "")).join("; ");
    throw new Error(`no relay accepted ${label}: ${reasons}`);
  }
  const size = JSON.stringify(event).length;
  console.log(`  ✓ ${label}: kind ${event.kind} ${event.id.slice(0, 12)}… (${size} B) → ${results.length - rejected.length}/${results.length} relays`);
}

async function queryAll(relays: string[], filter: Record<string, unknown>): Promise<NostrEvent[]> {
  return pool.querySync(relays, filter as never, { maxWait: 8000 }) as Promise<NostrEvent[]>;
}

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
      name: communityName,
      relays: community.relays,
      general_channel_id: bytesToHex(generalChannelId),
    },
    private_channels: [],
    invites: [],
    registry_version: 0,
  };
  saveState(name, state);
  console.log(`\nOwner identity "${name}": ${nip19.npubEncode(pubkey)}`);
  console.log(`State: ${statePath(name)}\n`);

  await invite(name);
}

async function invite(name: string, label?: string, singleUse = false): Promise<void> {
  const state = loadState(name);
  if (state.role !== "owner") throw new Error("Only the owner identity can mint invites.");
  const sk = hexToBytes(state.sk);
  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);
  const community = communityOf(state.community, state.private_channels);

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

  console.log(`\nInvite link minted${label ? ` ("${label}")` : ""}${singleUse ? " — SINGLE-USE, dies after the first join" : ""} — share EITHER origin (same secret):`);
  for (const url of urls) console.log(`  ${url}`);
}

async function joinBao(name: string, inviteUrl: string): Promise<void> {
  if (existsSync(statePath(name))) throw new Error(`Identity "${name}" already exists — use say/read.`);
  const parsed = parseInviteLink(inviteUrl.trim());
  if (!parsed) throw new Error("Not a recognizable invite link.");

  const events = await queryAll(parsed.bootstrapRelays, {
    kinds: [KIND_INVITE_BUNDLE],
    authors: [parsed.linkSigner],
    "#d": [""],
    limit: 1,
  });
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
  if (!newest) throw new Error("Couldn't find that invite on its relays.");
  const bundle = parseBundleEvent(newest, parsed.linkSigner, parsed.token, Date.now());

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
  const rumor = gate
    ? grindJoinRumor(pubkey, Date.now(), gate.difficulty, attribution)
    : buildJoinRumor(pubkey, Date.now(), attribution);
  await publishAll(
    community.relays,
    await sealGuestbook(rumor, currentGuestbookGroup(community), signer),
    gate ? `guestbook join (pow ≥ ${gate.difficulty})` : "guestbook join",
  );

  const state: State = {
    sk: bytesToHex(sk),
    role: "member",
    community: {
      id: bundle.community_id,
      owner: bundle.owner,
      owner_salt: bundle.owner_salt,
      community_root: bundle.community_root,
      root_epoch: bundle.root_epoch,
      name: bundle.name,
      relays: bundle.relays,
    },
    private_channels: bundle.channels,
    invites: [],
    registry_version: 0,
  };
  saveState(name, state);
  console.log(`\nJoined "${bundle.name}" as "${name}": ${nip19.npubEncode(pubkey)}`);
  console.log(`State: ${statePath(name)}`);
}

/** Resolve #general: owner's stored id, else fold the control plane. */
async function generalChannel(state: State): Promise<{ idHex: string; id: Uint8Array }> {
  if (state.community.general_channel_id) {
    return { idHex: state.community.general_channel_id, id: hexToBytes(state.community.general_channel_id) };
  }
  const community = communityOf(state.community, state.private_channels);
  const control = currentControlGroup(community);
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [control.pk] });
  const folded = foldControlState(openControlWraps(wraps, [control]), community.id, community.owner);
  for (const def of folded.channels.values()) {
    if (!def.isPrivate && !def.deleted && def.name === "general") return { idHex: def.channelIdHex, id: hexToBytes(def.channelIdHex) };
  }
  for (const def of folded.channels.values()) {
    if (!def.isPrivate && !def.deleted) return { idHex: def.channelIdHex, id: hexToBytes(def.channelIdHex) };
  }
  throw new Error("No public channel found in the control fold.");
}

async function say(name: string, text: string): Promise<void> {
  const state = loadState(name);
  const sk = hexToBytes(state.sk);
  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);
  const community = communityOf(state.community, state.private_channels);
  const channel = await generalChannel(state);

  const group = channelGroupKey(community.root, channel.id, 0n);
  const rumor = buildRumor({ kind: KIND_MESSAGE, content: text, tags: channelBindingTags(channel.idHex, 0n), pubkey, ms: Date.now() });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, group, signer);
  const wrap = wrapSeal(seal, group);
  await publishAll(community.relays, wrap, `message to #general`);
}

async function read(name: string): Promise<void> {
  const state = loadState(name);
  const community = communityOf(state.community, state.private_channels);
  const channel = await generalChannel(state);  // Timeline.
  const group = channelGroupKey(community.root, channel.id, 0n);
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [group.pk] });
  const messages: { ms: number; author: string; content: string }[] = [];
  for (const wrap of wraps) {
    try {
      const opened = openWrap(wrap, group);
      if (opened.kind !== KIND_MESSAGE) continue;
      messages.push({ ms: opened.ms, author: opened.author, content: opened.content });
    } catch {
      // not ours / malformed — skip
    }
  }
  messages.sort((a, b) => a.ms - b.ms);

  console.log(`\n#general — ${messages.length} message(s):`);
  for (const m of messages) {
    const time = new Date(m.ms).toISOString().replace("T", " ").slice(0, 19);
    console.log(`  [${time}] ${nip19.npubEncode(m.author).slice(0, 16)}…: ${m.content}`);
  }

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
  console.log(`\nMembers (${[...members.values()].filter((s) => s === "join").length}):`);
  for (const [pk, status] of members) {
    console.log(`  ${nip19.npubEncode(pk)} — ${status}`);
  }

  // Single-use sweep (owner): a single-use link dies the moment the Guestbook
  // shows a Join citing its token commitment — tombstone the bundle and drop
  // the coordinate from the Registry, like the app's useSingleUseSweep2.
  if (state.role === "owner") {
    const opened = openGuestbookOpened(openGuestbookWraps(gbWraps, [gb]));
    const remaining = [];
    for (const inv of state.invites) {
      if (inv.max_uses !== 1) {
        remaining.push(inv);
        continue;
      }
      if (!singleUseLinkUsed(opened, inviteCommitment(hexToBytes(inv.token)))) {
        remaining.push(inv);
        continue;
      }
      const sk = hexToBytes(state.sk);
      const signer = signerOf(sk);
      await publishAll(community.relays, buildRevocationEvent(hexToBytes(inv.link_sk)), `single-use tombstone (${inv.url.slice(0, 60)}…)`);
      state.registry_version += 1;
      await publishAll(
        community.relays,
        await sealEdition(
          buildRegistryEdition(community.id, getPublicKey(sk), remaining.map((i) => i.link_pk), {
            actorPubkey: getPublicKey(sk),
            version: BigInt(state.registry_version),
          }),
          currentControlGroup(community),
          signer,
        ),
        "invite registry edition",
      );
      console.log(`  ⓘ single-use link spent${inv.label ? ` ("${inv.label}")` : ""} — auto-revoked`);
    }
    if (remaining.length !== state.invites.length) {
      state.invites = remaining;
      saveState(name, state);
    }
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  const as = argValue(rest, "--as") ?? "owner";

  switch (mode) {
    case "create":
      await create(as, argValue(rest, "--name") ?? "₿AO agent hangout — live test", rest.includes("--agent-only"));
      break;
    case "invite":
      await invite(as, argValue(rest, "--label"), rest.includes("--single-use"));
      break;
    case "join": {
      const url = rest.find((a) => !a.startsWith("--") && a !== as);
      if (!url) throw new Error("join needs an invite URL");
      await joinBao(as, url);
      break;
    }
    case "say": {
      const text = rest.filter((a) => !a.startsWith("--") && a !== as).join(" ");
      if (!text) throw new Error("say needs text");
      await say(as, text);
      break;
    }
    case "read":
      await read(as);
      break;
    case "whoami": {
      const state = loadState(as);
      console.log(`${as}: ${nip19.npubEncode(getPublicKey(hexToBytes(state.sk)))} (${state.role} of ${state.community.name})`);
      break;
    }
    default:
      console.log("modes: create [--agent-only] | invite | join <url> | say <text> | read | whoami   [--as identity]");
  }
}

main()
  .catch((err) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    pool.close(HOME_RELAYS);
    // nostr-tools keeps sockets alive; give CLOSE a beat, then hard-exit.
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  });
