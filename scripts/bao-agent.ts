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

import { getPublicKey } from "nostr-tools/pure";
import { nip44 } from "nostr-tools";
import * as nip19 from "nostr-tools/nip19";
import { hexToBytes } from "@noble/hashes/utils.js";

import { BAO_COMMANDS, findCommand, renderCommandDoc, renderCommandHelp } from "@/concord-v2/lib/commands";
import { errorCodeDocs } from "@/lib/errorCodes";
import { dispatchBao, type BaoDispatchArgs } from "@/concord-v2/lib/baoEngine";
import { createNodeRelay, createNodeStore } from "./baoAdapter";
import type { OrchVerb } from "@/concord-v2/lib/orchestration";
import {
  CLAIM_TTL_MS,
  closePool,
  loadState,
  orchStates,
  orchVerbPost,
  projectSnapshot,
  queryAll,
  resolveChannel,
  statePath,
  waitForInterrupt,
} from "./chat-core";
import { fulfillCredits, listWork, printWorkListing, receiptCredits, requestCredits, resolvePubkey } from "./work-core";
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

// ── Modes ────────────────────────────────────────────────────────────────────

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

/** Always-on subscription: loop the mention interrupt, streaming each match.
 *  With `--all` it streams every new message; otherwise only mentions of the
 *  identity. Each iteration re-subscribes (no missed messages between hops). */
async function listenMode(name: string, opts: { mentionsOnly: boolean; channel?: string; json: boolean }): Promise<void> {
  const state = loadState(name);
  const channel = await resolveChannel(state, opts.channel);
  console.error(`listening on #${channel.name} of "${state.community.name}" (${opts.mentionsOnly ? "mentions only" : "all messages"}) — Ctrl-C to stop`);
  const subOpts = { mentionsOnly: opts.mentionsOnly, channel: channel.idHex, timeoutSec: 300 };
  while (true) {
    const hit = await waitForInterrupt(name, state, subOpts);
    if (!hit) continue; // timeout sentinel — loop to keep listening
    if (opts.json) {
      console.log(JSON.stringify({ channel: { id: channel.idHex, name: channel.name }, id: hit.id, author: hit.author, author_npub: nip19.npubEncode(hit.author), ms: hit.ms, content: hit.content, tags: hit.tags }));
    } else {
      const time = new Date(hit.ms).toISOString().replace("T", " ").slice(0, 19);
      console.log(`[${time}] ${nip19.npubEncode(hit.author).slice(0, 16)}…: ${hit.content}`);
    }
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
const VALUE_FLAGS = ["--as", "--key", "--orch", "--timeout", "--name", "--label", "--channel", "--nsec"];

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

/**
 * Route a shared verb through the transport-agnostic engine. The node store
 * (fs) + a per-community SimplePool relay give the CLI the same single
 * implementation the in-page terminal uses, with per-community pool isolation.
 * `--json` prints the raw envelope; otherwise pretty-prints a useful line.
 */
async function engineDispatch(as: string, command: string, args: BaoDispatchArgs, json: boolean): Promise<void> {
  const store = createNodeStore();
  const identity = store.get(args.identityName ?? as);
  // Per-community pool + NIP-42 AUTH signed with the member's key, so relays
  // see one authenticated session per community (closes the correlation leak).
  const relay = createNodeRelay({ communityId: identity?.community.id, authSk: identity?.sk });
  const r = await dispatchBao(store, relay, command, args);
  if (!r.ok) {
    throw new Error(r.error);
  }
  if (json) {
    console.log(JSON.stringify(r.result, null, 2));
  } else if (typeof r.result === "object" && r.result !== null) {
    console.log(JSON.stringify(r.result, null, 2));
  } else {
    console.log(String(r.result));
  }
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
  console.log(`\nError codes:\n${errorCodeDocs()}`);
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
      await engineDispatch(as, "create", { name: argValue(rest, "--name") ?? "₿AO agent hangout — live test", agentOnly: rest.includes("--agent-only"), identityName: as }, json);
      break;
    case "invite":
      await engineDispatch(as, "invite", { label: argValue(rest, "--label"), singleUse: rest.includes("--single-use"), human: rest.includes("--human"), identityName: as }, json);
      break;
    case "join": {
      const url = positionalArgs(rest)[0];
      if (!url) throw new Error("join needs an invite URL");
      await engineDispatch(as, "join", { inviteUrl: url, identityName: as }, json);
      break;
    }
    case "say": {
      const text = positionalArgs(rest).join(" ");
      if (!text) throw new Error("say needs text");
      await engineDispatch(as, "say", { text, key: argValue(rest, "--key"), channel: argValue(rest, "--channel"), identityName: as }, json);
      break;
    }
    case "read":
      await engineDispatch(as, "read", { channel: argValue(rest, "--channel"), identityName: as }, json);
      break;
    case "admin": {
      const p = positionalArgs(rest);
      await engineDispatch(as, "admin", { sub: p[0], target: p[1], role: argValue(rest, "--role"), identityName: as }, json);
      break;
    }
    case "ban": {
      await engineDispatch(as, "ban", { target: positionalArgs(rest)[0], identityName: as }, json);
      break;
    }
    case "unban": {
      await engineDispatch(as, "unban", { target: positionalArgs(rest)[0], identityName: as }, json);
      break;
    }
    case "kick": {
      await engineDispatch(as, "kick", { target: positionalArgs(rest)[0], identityName: as }, json);
      break;
    }
    case "channel": {
      const p = positionalArgs(rest);
      await engineDispatch(as, "channel", { sub: p[0], args: p.slice(1), identityName: as }, json);
      break;
    }
    case "meta": {
      const p = positionalArgs(rest);
      await engineDispatch(as, "meta", { sub: p[0], args: p.slice(1), identityName: as }, json);
      break;
    }
    case "members":
      await engineDispatch(as, "members", { identityName: as }, json);
      break;
    case "dissolve":
      await engineDispatch(as, "dissolve", { identityName: as }, json);
      break;
    case "identities":
      await engineDispatch(as, "identities", {}, json);
      break;
    case "login":
      await engineDispatch(as, "login", { name: positionalArgs(rest)[0], nsec: argValue(rest, "--nsec"), identityName: as }, json);
      break;
    case "use":
      await engineDispatch(as, "use", { name: positionalArgs(rest)[0] }, json);
      break;
    case "remove":
      await engineDispatch(as, "remove", { identityName: as }, json);
      break;
    case "logout":
      await engineDispatch(as, "logout", {}, json);
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
    case "listen":
      await listenMode(as, { mentionsOnly: !rest.includes("--all"), channel: argValue(rest, "--channel"), json });
      break;
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
      const useOpenRouter = rest.includes("--openrouter") || rest.includes("--provider") && positionalArgs(rest)[0] === "openrouter";
      const model = argValue(rest, "--model") ?? (useOpenRouter ? "openrouter/auto" : "routstr");

      if (useOpenRouter) {
        // OpenRouter backend — key from the OPENROUTER_API_KEY env var, never
        // from source. Run `OPENROUTER_API_KEY=sk-or-v1-… bao-agent think …`.
        const key = process.env.OPENROUTER_API_KEY;
        if (!key) throw new Error("OPENROUTER_API_KEY is not set — export it (never put the key in the repo).");
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 2048 }),
        });
        if (!res.ok) throw new Error(`OpenRouter API returned ${res.status}`);
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = json.choices?.[0]?.message?.content ?? "(no response)";
        if (json) {
          console.log(JSON.stringify({ prompt, provider: "openrouter", model, response: content }));
        } else {
          console.log(`\n${content}`);
        }
        break;
      }

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
