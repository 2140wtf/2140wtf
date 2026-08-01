/**
 * Shared chat-core for Concord V2 (₿AO) agents — consumed by BOTH the
 * headless CLI (scripts/bao-agent.ts) and the MCP server
 * (scripts/bao-chat-mcp.ts). One implementation of idempotent send, the
 * mention interrupt, and claim resolution, so the two front-ends can never
 * diverge.
 *
 * IMPORTANT: everything here logs to STDERR only. The MCP server speaks
 * JSON-RPC on stdout; a stray stdout write corrupts the protocol stream.
 */

import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";
import { hexToBytes } from "@noble/hashes/utils.js";

import { currentControlGroup, foldControlState, openControlWraps } from "@/concord-v2/lib/control";
import { channelGroupKey, type GroupKey } from "@/concord-v2/lib/derive";
import { buildRumor, channelBindingTags, openWrap, sealRumor, wrapSeal, type StreamSigner } from "@/concord-v2/lib/stream";
import { KIND_MESSAGE, KIND_SEAL_ENCRYPTED, KIND_WRAP } from "@/concord-v2/lib/kinds";
import {
  deriveClaimKey,
  mayPostVerb,
  mentionsMe,
  parseTaskMessage,
  resolveClaims,
  ORCH_TASK_TAG,
  type ClaimInput,
  type ClaimState,
  type OrchVerb,
} from "@/concord-v2/lib/orchestration";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import type { NostrEvent } from "nostr-tools/pure";

// ── State ────────────────────────────────────────────────────────────────────

export const STATE_DIR = join(homedir(), ".concord-live");

export interface SavedCommunity {
  id: string; // hex
  owner: string; // hex pubkey
  owner_salt: string; // hex
  community_root: string; // hex
  root_epoch: number;
  name: string;
  relays: string[];
  general_channel_id?: string; // hex — owner only; members resolve via control fold
}

export interface SavedInvite {
  token: string; // hex
  link_sk: string; // hex
  link_pk: string; // hex
  url: string;
  created_at: number;
  max_uses?: number;
}

export interface State {
  sk: string; // hex private key — NEVER commit
  role: "owner" | "member";
  community: SavedCommunity;
  private_channels: { id: string; key: string; epoch: number; name: string }[];
  invites: SavedInvite[];
  registry_version: number;
  /** Written at create/join; see PROTOCOL_VERSION. Absent in pre-v1 states. */
  protocol_version?: number;
}

/**
 * Wire-protocol version of this binary (mosaico daemon-design, adapted: never
 * let a stale-protocol conversation half-succeed). The asymmetry is safe:
 * a NEW binary reads OLD state (absent field → v1), but state stamped by a
 * NEWER binary than the one running is refused outright — re-fetch the asset.
 */
export const PROTOCOL_VERSION = 1;

export function statePath(name: string): string {
  return join(STATE_DIR, `${name}.json`);
}

export function loadState(name: string): State {
  const path = statePath(name);
  if (!existsSync(path)) throw new Error(`No identity "${name}" — expected ${path}`);
  const state = JSON.parse(readFileSync(path, "utf8")) as State;
  if ((state.protocol_version ?? 1) > PROTOCOL_VERSION) {
    throw new Error(
      `Identity "${name}" was written by protocol v${state.protocol_version} but this binary speaks v${PROTOCOL_VERSION} — re-fetch bao-agent.mjs (never half-run a stale binary).`,
    );
  }
  return state;
}

/**
 * Atomic write: crash mid-write must never leave a truncated state file —
 * it holds the hex private key, and losing it orphans the identity (mosaico
 * daemon-design, adopted as-is). tmp + rename is atomic on POSIX same-dir.
 */
export function saveState(name: string, state: State): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const path = statePath(name);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, path); // keeps the 0o600 inode; atomic on POSIX same-dir
}

/**
 * Advisory lockfile around state read-modify-write ops (invite, sweep):
 * two concurrent CLI processes would otherwise each read the old file and
 * lose the other's write — the mosaico multi-writer lesson at file level.
 * Locks whose holder died are reclaimed after 30s by mtime.
 */
export async function withStateLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${statePath(name)}.lock`;
  const deadline = Date.now() + 10_000;
  mkdirSync(STATE_DIR, { recursive: true });
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      closeSync(fd);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) unlinkSync(lock); // stale holder
      } catch {
        /* raced a concurrent reclaim */
      }
      if (Date.now() > deadline) {
        throw new Error(`State for "${name}" is locked by another process — retry shortly.`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      /* already reclaimed */
    }
  }
}

export function communityOf(c: SavedCommunity, privateChannels: State["private_channels"]): CommunityV2 {
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

let pool: SimplePool | null = null;

/** One pool per process (the MCP server is long-lived; the CLI closes it on exit). */
export function getPool(): SimplePool {
  pool ??= new SimplePool();
  return pool;
}

export function closePool(relays: string[]): void {
  pool?.close(relays);
}

export function signerOf(sk: Uint8Array): StreamSigner {
  return {
    signEvent: async (template) => {
      const { finalizeEvent } = await import("nostr-tools/pure");
      return finalizeEvent(template, sk);
    },
  };
}

/** Publish to every home relay; throw only if NONE accept. */
export async function publishAll(relays: string[], event: NostrEvent, label: string): Promise<void> {
  const results = await Promise.allSettled(getPool().publish(relays, event));
  const rejected = results.filter((r) => r.status === "rejected");
  if (rejected.length === results.length) {
    const reasons = rejected.map((r) => (r.status === "rejected" ? String(r.reason) : "")).join("; ");
    throw new Error(`no relay accepted ${label}: ${reasons}`);
  }
  const size = JSON.stringify(event).length;
  console.error(`  ✓ ${label}: kind ${event.kind} ${event.id.slice(0, 12)}… (${size} B) → ${results.length - rejected.length}/${results.length} relays`);
}

export async function queryAll(relays: string[], filter: Record<string, unknown>): Promise<NostrEvent[]> {
  return getPool().querySync(relays, filter as never, { maxWait: 8000 }) as Promise<NostrEvent[]>;
}

// ── Channels ─────────────────────────────────────────────────────────────────

/** Resolve #general: owner's stored id, else fold the control plane. */
export async function generalChannel(state: State): Promise<{ idHex: string; id: Uint8Array }> {
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

/** Public channels from the control fold + this identity's private channels. */
export async function listChannels(
  state: State,
): Promise<{ id: string; name: string; private: boolean }[]> {
  const community = communityOf(state.community, state.private_channels);
  const control = currentControlGroup(community);
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [control.pk] });
  const folded = foldControlState(openControlWraps(wraps, [control]), community.id, community.owner);
  const out: { id: string; name: string; private: boolean }[] = [];
  for (const def of folded.channels.values()) {
    if (!def.isPrivate && !def.deleted) out.push({ id: def.channelIdHex, name: def.name, private: false });
  }
  for (const ch of state.private_channels) out.push({ id: ch.id, name: ch.name, private: true });
  return out;
}

export interface ChannelMessage {
  id: string; // rumor id — the ordering tiebreak
  author: string;
  ms: number;
  content: string;
  tags: string[][];
}

/** Everything a channel operation needs, resolved once. */
export async function channelContext(state: State): Promise<{
  sk: Uint8Array;
  pubkey: string;
  signer: StreamSigner;
  community: CommunityV2;
  channel: { idHex: string; id: Uint8Array };
  group: GroupKey;
}> {
  const sk = hexToBytes(state.sk);
  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);
  const community = communityOf(state.community, state.private_channels);
  const channel = await generalChannel(state);
  const group = channelGroupKey(community.root, channel.id, 0n);
  return { sk, pubkey, signer, community, channel, group };
}

/** Decrypted #general history (the relay only ever sees ciphertext). */
export async function channelMessages(state: State): Promise<ChannelMessage[]> {
  const { community, group } = await channelContext(state);
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [group.pk] });
  const messages: ChannelMessage[] = [];
  for (const wrap of wraps) {
    try {
      const opened = openWrap(wrap, group);
      if (opened.kind !== KIND_MESSAGE) continue;
      messages.push({ id: opened.rumorId, author: opened.author, ms: opened.ms, content: opened.content, tags: opened.tags });
    } catch {
      // not ours / malformed — skip
    }
  }
  messages.sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Read-side idempotency: a keyed send that DID double-post (two processes
  // raced the check-then-publish scan — only in-process races are serialized,
  // see sendChannelMessage) renders once. The d-tag is a machine idempotency
  // key; for one author + one key, the earliest landing is the canonical copy.
  const seenKeys = new Set<string>();
  return messages.filter((m) => {
    const d = m.tags.find((t) => t[0] === "d")?.[1];
    if (d === undefined) return true;
    const k = `${m.author}:${d}`;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });
}

/**
 * Post to #general. Idempotent when `idemKey` is given: the key rides as a
 * ["d", key] tag on the rumor, and a retry first scans our own history — if
 * the key already landed, we report deduped instead of double-posting
 * (AGENT_CHAT_ORCHESTRATION.md §14: machines retry, humans shouldn't see it).
 *
 * Deliberately NOT a durable outbox (mosaico's submit_intents): both
 * front-ends are interactive request/response, so a crash before publish
 * surfaces to the operator and a crash after publish is healed by the d-tag
 * retry. Revisit if agents start unattended loops or money-adjacent verbs —
 * at that point intents must survive the process.
 */
/**
 * In-flight keyed sends serialize PER PROCESS: the idempotency scan below is
 * check-then-publish and not atomic, and concurrent callers in one process
 * (parallel MCP tool calls) would otherwise both scan before either lands and
 * double-post (found live in the round-7 MCP stress). The waiter re-scans
 * after the first send resolves and dedupes against it.
 */
const inflightKeyedSends = new Map<string, Promise<unknown>>();

export async function sendChannelMessage(
  state: State,
  text: string,
  opts: { idemKey?: string; extraTags?: string[][] } = {},
): Promise<{ rumorId: string; deduped: boolean }> {
  if (opts.idemKey) {
    const prior = inflightKeyedSends.get(opts.idemKey);
    if (prior) await prior.catch(() => {}); // a failed send frees the key either way
  }
  const run = sendChannelMessageInner(state, text, opts);
  if (!opts.idemKey) return run;
  inflightKeyedSends.set(opts.idemKey, run);
  try {
    return await run;
  } finally {
    if (inflightKeyedSends.get(opts.idemKey) === run) inflightKeyedSends.delete(opts.idemKey);
  }
}

async function sendChannelMessageInner(
  state: State,
  text: string,
  opts: { idemKey?: string; extraTags?: string[][] } = {},
): Promise<{ rumorId: string; deduped: boolean }> {
  const { pubkey, signer, community, channel, group } = await channelContext(state);

  if (opts.idemKey) {
    const dupe = (await channelMessages(state)).find(
      (m) => m.author === pubkey && m.tags.some((t) => t[0] === "d" && t[1] === opts.idemKey),
    );
    if (dupe) return { rumorId: dupe.id, deduped: true };
  }

  const tags = [...channelBindingTags(channel.idHex, 0n), ...(opts.extraTags ?? [])];
  if (opts.idemKey) tags.push(["d", opts.idemKey]);
  // Mention p-tags: npub1 tokens in the text become real p-tags so the
  // receiver's mention scan has a trustworthy signal (content is only a hint).
  for (const match of text.match(/npub1[02-9ac-hj-np-z]{20,}/g) ?? []) {
    try {
      const decoded = nip19.decode(match);
      if (decoded.type === "npub") tags.push(["p", decoded.data]);
    } catch {
      // not a valid npub — leave it as plain text
    }
  }

  const rumor = buildRumor({ kind: KIND_MESSAGE, content: text, tags, pubkey, ms: Date.now() });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, group, signer);
  const wrap = wrapSeal(seal, group);
  await publishAll(community.relays, wrap, `message to #general`);
  return { rumorId: rumor.id, deduped: false };
}

/**
 * The mention interrupt (AGENT_CHAT_ORCHESTRATION.md §11.3, adapted for the
 * sealed stack: a relay-side #p filter cannot see inside gift wraps, so we
 * subscribe the channel's wraps by stream author and scan mentions
 * post-decrypt). Resolves on the first NEW message mentioning the identity
 * (default) or any new message. Timeout resolves `null` — a sentinel, never
 * an error. Long-lived callers (MCP) must NOT close the shared pool here.
 */
export async function waitForInterrupt(
  identityName: string,
  state: State,
  opts: { timeoutSec: number; mentionsOnly: boolean },
): Promise<ChannelMessage | null> {
  const { pubkey, community, group } = await channelContext(state);
  const myNpub = nip19.npubEncode(pubkey);

  // Snapshot: history isn't an interrupt — only wraps arriving after we
  // subscribe count. (Track wrap ids; the rumor ids aren't on the wire.)
  const seen = new Set<string>();
  for (const w of await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [group.pk] })) seen.add(w.id);
  console.error(
    `listening on #general of "${community.name}" (timeout ${opts.timeoutSec}s${opts.mentionsOnly ? ", mentions only" : ""})…`,
  );

  return new Promise<ChannelMessage | null>((resolve) => {
    let sub: { close(): void } | null = null;
    const finish = (msg: ChannelMessage | null) => {
      clearTimeout(timer);
      sub?.close();
      resolve(msg);
    };
    const timer = setTimeout(() => finish(null), opts.timeoutSec * 1000);
    sub = getPool().subscribeMany(
      community.relays,
      { kinds: [KIND_WRAP], authors: [group.pk], since: Math.floor(Date.now() / 1000) - 30 },
      {
        onevent(wrap) {
          if (seen.has(wrap.id)) return;
          seen.add(wrap.id);
          let opened: ReturnType<typeof openWrap>;
          try {
            opened = openWrap(wrap, group);
          } catch {
            return;
          }
          if (opened.kind !== KIND_MESSAGE) return;
          if (opened.author === pubkey) return; // our own echo is not an interrupt
          const msg: ChannelMessage = { id: opened.rumorId, author: opened.author, ms: opened.ms, content: opened.content, tags: opened.tags };
          if (opts.mentionsOnly && !mentionsMe({ tags: msg.tags, content: msg.content, myPubkey: pubkey, myNpub, myNames: [identityName] })) return;
          finish(msg);
        },
      },
    );
  });
}

/**
 * Publish a kind-0 profile announcing this identity's name. Names are
 * enforced room-wide (the web join path refuses nameless keys; chat renders
 * them anon-<npub8>) — so join/create publish the identity name up front.
 * bot:true marks the key as an agent per the orchestration conventions.
 */
export async function publishAgentProfile(sk: Uint8Array, name: string, relays: string[]): Promise<void> {
  const { finalizeEvent } = await import("nostr-tools/pure");
  const event = finalizeEvent(
    {
      kind: 0,
      content: JSON.stringify({ name, bot: true }),
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    },
    sk,
  );
  await publishAll(relays, event, "kind-0 profile (name)");
}


// ── Orchestration (task claims over chat) ────────────────────────────────────

/** A claim with no PROGRESS from its claimant for this long is reclaimable.
 *  BAO_CLAIM_TTL_MS overrides for live tests against a local relay. */
export const CLAIM_TTL_MS = Number(process.env.BAO_CLAIM_TTL_MS ?? 30 * 60 * 1000);

/**
 * Wait this long before DECLARING a claim held, then re-resolve. A claim that
 * appears to win on a PARTIAL view — a rival's earlier-ms claim still in
 * flight — flips to held=false on this confirmation pass instead of letting
 * both racers believe they won (read-your-writes is not read-their-writes).
 * BAO_CLAIM_SETTLE_MS overrides for live tests.
 */
export const CLAIM_SETTLE_MS = Number(process.env.BAO_CLAIM_SETTLE_MS ?? 1500);

/**
 * Fail-closed (mosaico daemon-design: "an unavailable control channel fails
 * closed"). An empty claim history means one of two very different things —
 * "no claims yet" or "the relays are down and we can't see the claims". Only
 * the first may proceed; the second must throw, or an agent would read
 * silence as claimable and double-work a live claim.
 *
 * Probes ACTIVELY (ensureRelay), not via listConnectionStatus: the status map
 * is keyed by normalized URL and only reflects past connections, so a passive
 * read both misses keys and can't run before the first query.
 */
async function assertRelayReachable(relays: string[]): Promise<void> {
  const probes = await Promise.allSettled(
    relays.map((r) => getPool().ensureRelay(r, { connectionTimeout: 2500 })),
  );
  const up = probes.filter((p) => p.status === "fulfilled").length;
  if (up === 0) {
    throw new Error(
      `cannot resolve claims: 0/${relays.length} relays reachable — refusing to treat silence as claimable (fail-closed). Retry when a relay answers.`,
    );
  }
}

export interface OrchVerbResult {
  rumorId: string;
  deduped: boolean;
  /** CLAIM only: did we win? true = hold the claim at `epoch`, false = lost
   *  the race, null = our claim isn't visible yet — re-check with orchStates. */
  held?: boolean | null;
  /** CLAIM only: the fencing epoch our claim was published at. */
  epoch?: number;
}

export async function orchVerbPost(
  state: State,
  verb: OrchVerb,
  taskId: string,
  text: string,
  orchId: string,
): Promise<OrchVerbResult> {
  if (verb === "CLAIM") {
    // Fenced claim: resolve the CURRENT state, claim at exactly its epoch+1,
    // then re-resolve and report whether we hold it. Two concurrent reclaimers
    // publish the same epoch; the tie-break picks one and the other sees
    // held=false instead of double-working (mosaico generation check).
    const myPubkey = getPublicKey(hexToBytes(state.sk));
    const before = await orchStates(state, orchId);
    const cur = before.get(taskId);
    if (cur && !cur.stale && !cur.done && !cur.released) {
      // Task is live-claimed: publish nothing. If WE hold it, surface our own
      // claim id so a recovering caller can rejoin its epoch.
      return {
        rumorId: cur.claimant === myPubkey ? cur.claimId : "",
        deduped: false,
        held: cur.claimant === myPubkey,
        epoch: cur.epoch,
      };
    }
    const epoch = (cur?.epoch ?? 0) + 1;
    // The derived key is BOTH the human-visible `key=` token and the rumor's
    // d-tag: a retried claim re-publishes the same claim, never a second one.
    // The epoch salts it, so a re-claim after a takeover is a fresh key.
    const key = deriveClaimKey(orchId, taskId, epoch);
    let content = `CLAIM ${taskId} key=${key} epoch=${epoch}`;
    if (text) content += ` ${text}`;
    const sent = await sendChannelMessage(state, content, {
      idemKey: key,
      extraTags: [["t", ORCH_TASK_TAG], ["o", orchId]],
    });

    // Re-resolve and report the outcome honestly.
    const holdsUs = (s: { claimant: string; epoch: number } | undefined) => !!s && s.claimant === myPubkey && s.epoch === epoch;
    let now = (await orchStates(state, orchId)).get(taskId);
    if (holdsUs(now) || !now) {
      // Winning (or not yet visible) on the FIRST view proves nothing — a
      // rival's claim may still be propagating. Settle, then confirm.
      await new Promise((r) => setTimeout(r, CLAIM_SETTLE_MS));
      now = (await orchStates(state, orchId)).get(taskId);
    }
    if (!now) return { ...sent, held: null, epoch }; // our claim never landed
    // We hold it only if the CONFIRMED winner is US at OUR epoch. Anything
    // else — a tie-break loss that flipped in during the settle window, or a
    // same-author claim at a different epoch — is a loss the caller must NOT
    // act on.
    return { ...sent, held: holdsUs(now), epoch };
  }

  // PROGRESS/DONE/BLOCKED: executor-side fence — refuse when someone else
  // holds the task, so a zombie learns it lost instead of believing its DONE
  // landed (the resolver would ignore the verb; the agent would not know).
  const myPubkey = getPublicKey(hexToBytes(state.sk));
  const before = await orchStates(state, orchId);
  const cur = before.get(taskId);
  if (!mayPostVerb(cur, myPubkey, verb)) {
    return { rumorId: "", deduped: false, held: false, epoch: cur?.epoch };
  }

  const extraTags = [["t", ORCH_TASK_TAG], ["o", orchId]];
  const content = `${verb} ${taskId}${text ? ` ${text}` : ""}`;
  return sendChannelMessage(state, content, { extraTags });
}

export async function orchStates(state: State, orchId: string): Promise<Map<string, ClaimState>> {
  // Probe FIRST: with relays down, a member's control fold comes back empty
  // and would throw a misleading "no channel" error before we ever get here.
  await assertRelayReachable(state.community.relays);
  const inputs: ClaimInput[] = [];
  const messages = await channelMessages(state);
  for (const m of messages) {
    const msg = parseTaskMessage(m.content, m.tags);
    if (!msg) continue;
    // Untagged task messages count for every orch (back-compat); a message
    // carrying an ["o", …] tag belongs to that orch only.
    const oTags = m.tags.filter((t) => t[0] === "o").map((t) => t[1]);
    if (oTags.length > 0 && !oTags.includes(orchId)) continue;
    inputs.push({ id: m.id, author: m.author, ms: m.ms, msg });
  }
  return resolveClaims(inputs, { ttlMs: CLAIM_TTL_MS, nowMs: Date.now() });
}
