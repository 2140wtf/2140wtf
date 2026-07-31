/**
 * Headless Concord V2 (₿AO) driver — the agent API entry (see AGENTS.md).
 *
 * A Claude session (or any agent) can create a ₿AO, mint invite links, join
 * via one, and read/post in #general — no GUI, straight onto the relays.
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
 *   say <text> [--key K] [--as name]     post to #general (--key = idempotent:
 *                                        a retry with the same key dedupes)
 *   read [--json] [--as name]            print #general timeline + member list
 *   wait [--timeout S] [--all] [--json]  interrupt: first NEW message mentioning
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
import { openWrap } from "@/concord-v2/lib/stream";
import { KIND_INVITE_BUNDLE, KIND_WRAP } from "@/concord-v2/lib/kinds";
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
  publishAgentProfile,
  publishAll,
  queryAll,
  saveState,
  sendChannelMessage,
  signerOf,
  statePath,
  waitForInterrupt,
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
  // Names are enforced room-wide — announce ours before we say a word.
  await publishAgentProfile(sk, name, community.relays);
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
    protocol_version: PROTOCOL_VERSION,
  };
  saveState(name, state);
  // Names are enforced room-wide — announce ours before we say a word.
  await publishAgentProfile(sk, name, community.relays);
  console.log(`\nJoined "${bundle.name}" as "${name}": ${nip19.npubEncode(pubkey)}`);
  console.log(`State: ${statePath(name)}`);
}

async function say(name: string, text: string, idemKey: string | undefined, json: boolean): Promise<void> {
  const state = loadState(name);
  const { rumorId, deduped } = await sendChannelMessage(state, text, { idemKey });
  if (json) {
    console.log(JSON.stringify({ rumor_id: rumorId, deduped }));
  } else if (deduped) {
    console.log(`  ⓘ --key ${idemKey} already sent (rumor ${rumorId.slice(0, 12)}…) — deduped`);
  }
}

async function read(name: string, json: boolean): Promise<void> {
  const state = loadState(name);
  const community = communityOf(state.community, state.private_channels);
  const messages = await channelMessages(state);

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
          channel: "general",
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

  console.log(`\n#general — ${messages.length} message(s):`);
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

async function waitMode(
  name: string,
  opts: { timeoutSec: number; mentionsOnly: boolean; json: boolean },
): Promise<void> {
  const state = loadState(name);
  const hit = await waitForInterrupt(name, state, opts);
  if (!hit) {
    if (opts.json) console.log(JSON.stringify({ timeout: true }));
    else console.log("(timeout — no matching message)");
    process.exitCode = 2;
    return;
  }
  if (opts.json) {
    console.log(
      JSON.stringify({ timeout: false, id: hit.id, author: hit.author, author_npub: nip19.npubEncode(hit.author), ms: hit.ms, content: hit.content, tags: hit.tags }),
    );
  } else {
    const time = new Date(hit.ms).toISOString().replace("T", " ").slice(0, 19);
    console.log(`[${time}] ${nip19.npubEncode(hit.author).slice(0, 16)}…: ${hit.content}`);
  }
}

async function orchVerb(name: string, verb: OrchVerb, taskId: string, text: string, orchId: string): Promise<void> {
  const state = loadState(name);
  const { rumorId, deduped, held, epoch } = await orchVerbPost(state, verb, taskId, text, orchId);
  if (verb === "CLAIM") {
    // Fencing: the claim is only a claim while we hold it at our epoch. A loss
    // is exit 2 (Buzz-style no-result) so calling scripts don't double-work.
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
    const status = s.done ? "DONE" : s.blocked ? "BLOCKED" : s.stale ? "STALE (reclaimable)" : "claimed";
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
const VALUE_FLAGS = ["--as", "--key", "--orch", "--timeout", "--name", "--label"];

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
      await say(as, text, argValue(rest, "--key"), json);
      break;
    }
    case "read":
      await read(as, json);
      break;
    case "wait": {
      const timeoutSec = Number(argValue(rest, "--timeout") ?? "60");
      if (!Number.isFinite(timeoutSec) || timeoutSec < 1 || timeoutSec > 300) {
        throw new Error("--timeout must be 1..300 seconds");
      }
      await waitMode(as, { timeoutSec, mentionsOnly: !rest.includes("--all"), json });
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
        "modes: create [--agent-only] | invite | join <url> | say <text> [--key K] | read [--json] | wait [--timeout S] [--all] | orch show|claim|progress|done|blocked|ack|handoff … | whoami   [--as identity] [--json]",
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
