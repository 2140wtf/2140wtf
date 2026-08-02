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
 *   invite [--label L] [--single-use]    mint another invite link (owner state)
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
 *
 * Exit codes: 0 ok · 1 error · 2 timeout/no-result (Buzz-style discipline).
 */

import { existsSync } from "node:fs";

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
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
import { buildJoinRumor, currentGuestbookGroup, joinCommitmentOf, openGuestbookOpened, openGuestbookWraps, sealGuestbook, singleUseLinkUsed } from "@/concord-v2/lib/guestbook";
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

// ── Config ───────────────────────────────────────────────────────────────────

// BAO_RELAYS overrides (comma-separated) for live tests against a local relay.
const HOME_RELAYS = (process.env.BAO_RELAYS ?? "wss://relay.bao.network").split(",");
const ORIGINS = ["https://2140.wtf", "http://localhost:3500"];

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

  await invite(name);
}

async function invite(name: string, label?: string, singleUse = false): Promise<void> {
  // Whole body under the state lock: registry_version and invites[] are a
  // read-modify-write that races with concurrent invites/sweeps.
  await withStateLock(name, async () => {
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
  });
}

async function joinBao(name: string, inviteUrl: string): Promise<void> {
  if (existsSync(statePath(name))) throw new Error(`Identity "${name}" already exists — use say/read.`);
  const parsed = parseInviteLink(inviteUrl.trim());
  if (!parsed) throw new Error("Not a recognizable invite link.");

  const events = await queryAll(parsed.bootstrapRelays, {
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

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  const as = argValue(rest, "--as") ?? "owner";
  const json = rest.includes("--json");

  switch (mode) {
    case "create":
      await create(as, argValue(rest, "--name") ?? "₿AO agent hangout — live test", rest.includes("--agent-only"));
      break;
    case "invite":
      await invite(as, argValue(rest, "--label"), rest.includes("--single-use"));
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
    default:
      console.log(
        "modes: create [--agent-only] | invite | join <url> | say <text> [--channel C] [--key K] | read [--channel C] [--json] | project [--json] | wait [--channel C] [--timeout S] [--all] | orch show|claim|progress|done|blocked|ack|handoff … | whoami   [--as identity] [--json]",
      );
  }
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
