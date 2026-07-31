/**
 * bao-chat-mcp — MCP (Model Context Protocol) server over Concord V2 (₿AO)
 * chat, stdio transport. Any MCP-capable agent (Claude Code, Codex, Goose,
 * anything speaking ACP) points at this process and gets ₿AO chat as native
 * tools, per AGENT_CHAT_ORCHESTRATION.md §12:
 *
 *   list_channels · read_messages · send_message · wait_for_message
 *   get_profile · set_profile
 *
 * All channel operations come from scripts/chat-core.ts — the SAME code the
 * headless CLI (scripts/bao-agent.ts) runs, so tool behavior can never
 * diverge from CLI behavior.
 *
 * Identity: ~/.concord-live/<name>.json, exactly as the CLI uses; default
 * from BAO_AGENT_IDENTITY or "owner". Create/join identities with the CLI
 * first (`node bao-agent.mjs join "<url>" --as <name>`) — this server is a
 * chat client, not an onboarding flow.
 *
 * STDIO DISCIPLINE: stdout is the JSON-RPC channel. Everything diagnostic
 * goes to stderr (chat-core already honors this). Every tool call is also
 * appended to ~/.concord-live/audit-<identity>.jsonl.
 *
 * Build (standalone, zero-repo): npm run mcp:bundle  →  public/bao-chat-mcp.mjs
 * Register (Claude Code):
 *   claude mcp add bao-chat -- node /path/to/bao-chat-mcp.mjs
 * Or from a repo clone: npm run mcp
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { hexToBytes } from "@noble/hashes/utils.js";

import {
  STATE_DIR,
  channelMessages,
  listChannels,
  loadState,
  orchStates,
  orchVerbPost,
  publishAll,
  sendChannelMessage,
  waitForInterrupt,
  CLAIM_TTL_MS,
  type State,
} from "./chat-core";
import type { OrchVerb } from "@/concord-v2/lib/orchestration";

// ── Identity + audit log ─────────────────────────────────────────────────────

const IDENTITY = process.env.BAO_AGENT_IDENTITY ?? "owner";

/** JSONL audit log — one line per tool call (AGENT_CHAT_ORCHESTRATION.md §15). */
function audit(tool: string, args: Record<string, unknown>, summary: string): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(
      join(STATE_DIR, `audit-${IDENTITY}.jsonl`),
      JSON.stringify({ ts: new Date().toISOString(), tool, args, summary }) + "\n",
      { mode: 0o600 },
    );
  } catch {
    // Audit failure must never break a tool call.
  }
}

function identityState(): State {
  return loadState(IDENTITY);
}

/** MCP text-result helper — tool payloads are JSON, never prose soup. */
function jsonResult(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

// ── Server + tools ───────────────────────────────────────────────────────────

const server = new McpServer({ name: "bao-chat", version: "0.1.0" });

server.registerTool(
  "list_channels",
  {
    description:
      "List the channels of the ₿AO community this identity belongs to (public channels from the control fold + private channels this identity was invited with).",
    inputSchema: {},
  },
  async () => {
    const state = identityState();
    const channels = await listChannels(state);
    audit("list_channels", {}, `${channels.length} channel(s)`);
    return jsonResult({ community: state.community.name, channels });
  },
);

server.registerTool(
  "read_messages",
  {
    description:
      "Read recent messages from the community's #general channel (decrypted client-side; the relay only stores ciphertext). Returns newest-last with author npubs and millisecond timestamps.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(50).describe("Max messages to return (from the end of the timeline)"),
    },
  },
  async ({ limit }) => {
    const state = identityState();
    const messages = (await channelMessages(state)).slice(-limit);
    audit("read_messages", { limit }, `${messages.length} message(s)`);
    return jsonResult({
      community: state.community.name,
      channel: "general",
      messages: messages.map((m) => ({
        id: m.id,
        author_npub: nip19.npubEncode(m.author),
        ms: m.ms,
        content: m.content,
        tags: m.tags,
      })),
    });
  },
);

server.registerTool(
  "send_message",
  {
    description:
      "Post a message to #general. Pass an idempotency `key` whenever the call might be retried: a retry with the same key is deduped (returns deduped:true) instead of double-posting. npub1 tokens in the text automatically become mention p-tags.",
    inputSchema: {
      text: z.string().min(1).max(20000).describe("Message text (markdown is fine)"),
      key: z.string().max(128).optional().describe("Idempotency key — retries with the same key dedupe"),
    },
  },
  async ({ text, key }) => {
    const state = identityState();
    const { rumorId, deduped } = await sendChannelMessage(state, text, { idemKey: key });
    audit("send_message", { key, len: text.length }, deduped ? "deduped" : `sent ${rumorId.slice(0, 12)}`);
    return jsonResult({ rumor_id: rumorId, deduped });
  },
);

server.registerTool(
  "wait_for_message",
  {
    description:
      "Block until a NEW message arrives in #general that mentions this identity (p-tag, npub, or @name), or any new message with mention_only=false. A timeout is NOT an error: it returns {timeout:true} so the caller can decide to keep waiting or do other work. Max 300 seconds.",
    inputSchema: {
      timeout_sec: z.number().int().min(1).max(300).default(120).describe("Seconds to wait before returning the timeout sentinel"),
      mention_only: z.boolean().default(true).describe("true = only messages mentioning me; false = any new message"),
    },
  },
  async ({ timeout_sec, mention_only }) => {
    const state = identityState();
    const hit = await waitForInterrupt(IDENTITY, state, { timeoutSec: timeout_sec, mentionsOnly: mention_only });
    if (!hit) {
      audit("wait_for_message", { timeout_sec, mention_only }, "timeout");
      return jsonResult({ timeout: true });
    }
    audit("wait_for_message", { timeout_sec, mention_only }, `hit ${hit.id.slice(0, 12)}`);
    return jsonResult({
      timeout: false,
      id: hit.id,
      author_npub: nip19.npubEncode(hit.author),
      ms: hit.ms,
      content: hit.content,
      tags: hit.tags,
    });
  },
);

server.registerTool(
  "get_profile",
  {
    description: "This agent's chat identity: name, npub, role, and the community it belongs to.",
    inputSchema: {},
  },
  async () => {
    const state = identityState();
    const pubkey = getPublicKey(hexToBytes(state.sk));
    audit("get_profile", {}, IDENTITY);
    return jsonResult({
      identity: IDENTITY,
      npub: nip19.npubEncode(pubkey),
      pubkey,
      role: state.role,
      community: state.community.name,
      relays: state.community.relays,
    });
  },
);

server.registerTool(
  "set_profile",
  {
    description:
      "Publish a Nostr kind-0 profile for this identity to the community's relays (bot:true marks it as an agent per the orchestration conventions).",
    inputSchema: {
      display_name: z.string().max(64).optional(),
      about: z.string().max(500).optional(),
    },
  },
  async ({ display_name, about }) => {
    const state = identityState();
    const sk = hexToBytes(state.sk);
    const { finalizeEvent } = await import("nostr-tools/pure");
    const event = finalizeEvent(
      {
        kind: 0,
        content: JSON.stringify({ name: display_name ?? IDENTITY, about: about ?? "", bot: true }),
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      },
      sk,
    );
    await publishAll(state.community.relays, event, "kind-0 profile");
    audit("set_profile", { display_name }, event.id.slice(0, 12));
    return jsonResult({ published: true, event_id: event.id });
  },
);

server.registerTool(
  "orch_show",
  {
    description:
      "Resolved task-claim state for an orchestration (the shared tie-break: first CLAIM wins, timestamp ties break by lowest message id, claims stale after 30 min without PROGRESS, DONE/BLOCKED only by the claimant).",
    inputSchema: {
      orch: z.string().max(64).default("cards").describe("Orchestration id (the room's coordination scope)"),
    },
  },
  async ({ orch }) => {
    const state = identityState();
    const states = await orchStates(state, orch);
    audit("orch_show", { orch }, `${states.size} task(s)`);
    return jsonResult({
      orch,
      ttl_ms: CLAIM_TTL_MS,
      tasks: [...states.values()].map((s) => ({ ...s, claimant_npub: nip19.npubEncode(s.claimant) })),
    });
  },
);

server.registerTool(
  "orch_verb",
  {
    description:
      "Post a task-lifecycle verb to the orchestration: claim a task (idempotent — a retry re-publishes the same claim), report progress (refreshes staleness), or mark done/blocked/ack/handoff. Content stays human-readable; the machine contract rides in tags.",
    inputSchema: {
      verb: z.enum(["claim", "progress", "done", "blocked", "ack", "handoff"]),
      task_id: z.string().min(1).max(128),
      text: z.string().max(2000).default("").describe("Extra human-readable payload after the task id"),
      orch: z.string().max(64).default("cards"),
    },
  },
  async ({ verb, task_id, text, orch }) => {
    const state = identityState();
    const { rumorId, deduped } = await orchVerbPost(state, verb.toUpperCase() as OrchVerb, task_id, text, orch);
    audit("orch_verb", { verb, task_id, orch }, deduped ? "deduped" : `sent ${rumorId.slice(0, 12)}`);
    return jsonResult({ rumor_id: rumorId, deduped });
  },
);

// ── Boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Fail fast with a useful message if the identity doesn't exist.
  const state = identityState();
  const npub = nip19.npubEncode(getPublicKey(hexToBytes(state.sk)));
  console.error(`bao-chat-mcp: identity "${IDENTITY}" (${npub.slice(0, 20)}…) in "${state.community.name}" — stdio up`);
  audit("boot", {}, `${IDENTITY} in ${state.community.name}`);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(`bao-chat-mcp: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
