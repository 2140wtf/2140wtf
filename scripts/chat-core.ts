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
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { controlGroups, currentControlGroup, foldControlState, openControlWraps } from "@/concord-v2/lib/control";
import {
  NIP34_ISSUE_KIND,
  NIP34_PATCH_KIND,
  NIP34_PULL_REQUEST_KIND,
  NIP34_STATUS_KINDS,
  latestProjectStatuses,
  parseAuthoritativeStatus,
  parseProjectArtifact,
  parseRepoNaddr,
  parseRepositoryEvent,
  repositoryMaintainers,
  repositoryRelays,
  type Nip34Artifact,
} from "@/lib/nip34Project";
import { channelsView } from "@/concord-v2/lib/community";
import { channelGroupKey, voiceGroupKey, voiceMediaKey } from "@/concord-v2/lib/derive";
import { buildRumor, channelBindingTags, checkChannelBinding, openWrap, sealRumor, wrapSeal, type StreamSigner } from "@/concord-v2/lib/stream";
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
import type { ChannelV2, CommunityMetadata, CommunityV2 } from "@/concord-v2/lib/types";
import type { NostrEvent } from "nostr-tools/pure";

// ── State ────────────────────────────────────────────────────────────────────

export const STATE_DIR = join(homedir(), ".concord-live");

export interface SavedCommunity {
  id: string; // hex
  owner: string; // hex pubkey
  owner_salt: string; // hex
  community_root: string; // hex
  root_epoch: number;
  /** Retained prior root epochs, newest first. The current root is excluded. */
  held_roots?: Array<{ epoch: number; key: string }>;
  /** Local membership start in milliseconds; needed to distinguish a kick from a pre-join rekey. */
  joined_at?: number;
  /** Pubkey whose accepted Refounding minted the current root epoch. */
  refounder?: string;
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

/** Keep identity-controlled filenames inside STATE_DIR. */
export function validateIdentityName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error("Identity name must be 1–64 ASCII letters, digits, dots, underscores, or dashes, starting with a letter or digit.");
  }
  return name;
}

export function statePath(name: string): string {
  return join(STATE_DIR, `${validateIdentityName(name)}.json`);
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
  return migrateState(state);
}

const HEX_32 = /^[0-9a-f]{64}$/i;

function validEpoch(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Upgrade and canonicalize the access portion of an on-disk identity without
 * mutating the parsed object. Pre-retained-root states remain readable: their
 * current root becomes the sole held root at runtime. An unknown legacy join
 * time stays unknown so a future watcher cannot mistake old history for a kick.
 */
export function migrateSavedCommunityAccess(community: SavedCommunity): SavedCommunity {
  if (!validEpoch(community.root_epoch)) throw new Error("Saved community root_epoch must be a non-negative safe integer.");
  if (!HEX_32.test(community.community_root)) throw new Error("Saved community_root must be 32-byte hex.");

  const currentKey = community.community_root.toLowerCase();
  if (community.joined_at !== undefined && !validEpoch(community.joined_at)) {
    throw new Error("Saved community joined_at must be a non-negative safe millisecond timestamp.");
  }
  const roots = new Map<number, string>();
  for (const held of community.held_roots ?? []) {
    if (!validEpoch(held.epoch) || !HEX_32.test(held.key)) {
      throw new Error("Saved community retained roots must contain a non-negative safe epoch and 32-byte hex key.");
    }
    if (held.epoch > community.root_epoch) {
      throw new Error(`Saved community retained root epoch ${held.epoch} is newer than current epoch ${community.root_epoch}.`);
    }
    if (held.epoch === community.root_epoch) {
      if (held.key.toLowerCase() !== currentKey) throw new Error("Saved community has conflicting keys for its current root epoch.");
      continue;
    }
    const key = held.key.toLowerCase();
    const prior = roots.get(held.epoch);
    if (prior !== undefined && prior !== key) throw new Error(`Saved community has conflicting keys for retained root epoch ${held.epoch}.`);
    roots.set(held.epoch, key);
  }

  return {
    ...community,
    community_root: currentKey,
    held_roots: [...roots]
      .sort(([a], [b]) => b - a)
      .map(([epoch, key]) => ({ epoch, key })),
    ...(community.joined_at !== undefined ? { joined_at: community.joined_at } : {}),
    ...(community.refounder && HEX_32.test(community.refounder)
      ? { refounder: community.refounder.toLowerCase() }
      : { refounder: undefined }),
  };
}

/** Pure whole-state migration used by loadState and tests. */
export function migrateState(state: State): State {
  return { ...state, community: migrateSavedCommunityAccess(state.community) };
}

export interface RootAccessUpdate {
  community_root: string;
  root_epoch: number;
  /** Roots supplied by the update, excluding or including current (both accepted). */
  held_roots?: Array<{ epoch: number; key: string }>;
  refounder?: string;
}

/**
 * Adopt a strictly newer, already-authenticated root update while retaining
 * every readable historical root. Stale updates are harmless no-ops; same-
 * epoch key disagreement fails closed instead of making local state depend on
 * relay delivery order. Network code must authenticate/decrypt the update
 * before calling this helper.
 */
export function adoptRootAccess(state: State, update: RootAccessUpdate): State {
  const migrated = migrateState(state);
  const current = migrated.community;
  if (!validEpoch(update.root_epoch)) throw new Error("Root access update epoch must be a non-negative safe integer.");
  if (!HEX_32.test(update.community_root)) throw new Error("Root access update key must be 32-byte hex.");
  const nextKey = update.community_root.toLowerCase();
  if (update.root_epoch < current.root_epoch) return migrated;
  if (update.root_epoch === current.root_epoch) {
    if (nextKey !== current.community_root) throw new Error(`Conflicting root access update at epoch ${update.root_epoch}.`);
    const community = migrateSavedCommunityAccess({
      ...current,
      held_roots: [...(current.held_roots ?? []), ...(update.held_roots ?? [])],
      refounder: current.refounder ?? update.refounder,
    });
    return { ...migrated, community };
  }

  const community = migrateSavedCommunityAccess({
    ...current,
    community_root: nextKey,
    root_epoch: update.root_epoch,
    held_roots: [
      { epoch: current.root_epoch, key: current.community_root },
      ...(current.held_roots ?? []),
      ...(update.held_roots ?? []),
    ],
    refounder: update.refounder,
  });
  return { ...migrated, community };
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
  writeFileSync(tmp, JSON.stringify(migrateState(state), null, 2), { mode: 0o600 });
  renameSync(tmp, path); // keeps the 0o600 inode; atomic on POSIX same-dir
}

/**
 * Advisory lockfile around state read-modify-write ops (invite, sweep):
 * two concurrent CLI processes would otherwise each read the old file and
 * lose the other's write — the mosaico multi-writer lesson at file level.
 * Locks whose holder died are reclaimed after 30s by mtime.
 *
 * `lockSuffix` selects the lock: the default ".lock" guards the state file
 * itself, while keyed sends use a PER-KEY suffix (".send-<hash>") so two
 * processes racing the same idempotency key serialize their
 * check-then-publish WITHOUT blocking unrelated sends or state ops.
 */
export async function withStateLock<T>(name: string, fn: () => Promise<T>, lockSuffix = ".lock"): Promise<T> {
  const lock = `${statePath(name)}${lockSuffix}`;
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
        throw new Error(`State for "${name}" is locked by another process (${lockSuffix}) — retry shortly.`);
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
  const saved = migrateSavedCommunityAccess(c);
  const root = hexToBytes(saved.community_root);
  const heldRoots = [
    { epoch: BigInt(saved.root_epoch), key: root },
    ...(saved.held_roots ?? []).map((held) => ({ epoch: BigInt(held.epoch), key: hexToBytes(held.key) })),
  ];
  return {
    id: hexToBytes(saved.id),
    idHex: saved.id,
    owner: saved.owner,
    ownerSalt: hexToBytes(saved.owner_salt),
    root,
    rootEpoch: BigInt(saved.root_epoch),
    heldRoots,
    privateChannels: privateChannels.map((ch) => ({
      id: hexToBytes(ch.id),
      key: hexToBytes(ch.key),
      epoch: BigInt(ch.epoch),
      name: ch.name,
    })),
    relays: saved.relays,
    name: saved.name,
    refounder: saved.refounder,
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

/** Fold current encrypted control metadata. No public project relay is touched. */
export async function communityMetadata(state: State): Promise<CommunityMetadata | undefined> {
  const community = communityOf(state.community, state.private_channels);
  const controls = controlGroups(community);
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: controls.map((control) => control.pk) });
  return foldControlState(openControlWraps(wraps, controls), community.id, community.owner).metadata;
}

export interface AgentProjectSnapshot {
  coordinate: string;
  naddr: string;
  name: string;
  description?: string;
  maintainers: string[];
  relays: string[];
  issues: Array<{ id: string; author: string; subject: string; labels: string[]; status?: string; created_at: number }>;
  pull_requests: Array<{ id: string; author: string; subject: string; labels: string[]; status?: string; created_at: number }>;
  patches: Array<{ id: string; author: string; subject: string; labels: string[]; status?: string; created_at: number }>;
  partial: boolean;
}

/**
 * Read the public NIP-34 projection explicitly linked from sealed metadata.
 * Calling this reveals interest in the repository to its hinted relays; chat
 * and orchestration commands never call it implicitly.
 */
export async function projectSnapshot(state: State): Promise<AgentProjectSnapshot> {
  const metadata = await communityMetadata(state);
  const pointer = parseRepoNaddr(metadata?.repo_naddr);
  if (!pointer) throw new Error("This community has no valid NIP-34 project attached.");
  const discoveryRelays = pointer.relays.length ? pointer.relays : state.community.relays;
  const repoEvents = await queryAll(discoveryRelays, {
    kinds: [30617], authors: [pointer.owner], "#d": [pointer.identifier], limit: 10,
  });
  const repository = repoEvents
    .map((event) => parseRepositoryEvent(event, pointer))
    .filter((event): event is NostrEvent => !!event)
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
  if (!repository) throw new Error("The attached NIP-34 repository announcement was not found or failed validation.");

  const maintainers = repositoryMaintainers(repository, pointer);
  const relays = repositoryRelays(repository);
  const sourceRelays = relays.length ? relays : discoveryRelays;
  const events = await queryAll(sourceRelays, {
    kinds: [NIP34_ISSUE_KIND, NIP34_PATCH_KIND, NIP34_PULL_REQUEST_KIND], "#a": [pointer.coordinate], limit: 300,
  });
  const artifacts = events.map((event) => parseProjectArtifact(event, pointer)).filter((item): item is Nip34Artifact => !!item);
  const byId = new Map(artifacts.map((item) => [item.event.id, item]));
  const roots = artifacts.filter((item) => item.statusRoot);
  const statusEvents = roots.length ? await queryAll(sourceRelays, {
    kinds: [...NIP34_STATUS_KINDS],
    authors: [...new Set([...maintainers, ...roots.map((item) => item.event.pubkey)])],
    "#e": roots.map((item) => item.event.id),
    limit: Math.min(500, Math.max(1, roots.length * 4)),
  }) : [];
  const statuses = latestProjectStatuses(statusEvents
    .map((event) => parseAuthoritativeStatus(event, byId, maintainers))
    .filter((status): status is NonNullable<typeof status> => !!status));
  const serialize = (kind: number) => artifacts.filter((item) => item.kind === kind).map((item) => ({
    id: item.event.id,
    author: item.event.pubkey,
    subject: item.subject,
    labels: item.labels,
    status: statuses.get(item.event.id)?.status,
    created_at: item.event.created_at,
  })).sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
  return {
    coordinate: pointer.coordinate,
    naddr: pointer.naddr,
    name: repository.tags.find(([name]) => name === "name")?.[1] || pointer.identifier,
    description: repository.tags.find(([name]) => name === "description")?.[1],
    maintainers: [...maintainers],
    relays: sourceRelays,
    issues: serialize(NIP34_ISSUE_KIND),
    pull_requests: serialize(NIP34_PULL_REQUEST_KIND),
    patches: serialize(NIP34_PATCH_KIND),
    partial: events.length >= 300,
  };
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
): Promise<{ id: string; name: string; private: boolean; epoch: number }[]> {
  const channels = await availableChannels(state);
  return channels.map((channel) => ({
    id: channel.idHex,
    name: channel.name,
    private: channel.isPrivate,
    epoch: Number(channel.current.epoch),
  }));
}

async function availableChannels(state: State): Promise<ChannelV2[]> {
  const community = communityOf(state.community, state.private_channels);
  const controls = controlGroups(community);
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: controls.map((control) => control.pk) });
  const folded = foldControlState(openControlWraps(wraps, controls), community.id, community.owner);
  return channelsView(community, folded);
}

/** Resolve a channel by exact id or case-insensitive exact name. */
export async function resolveChannel(state: State, selector?: string): Promise<ChannelV2> {
  const savedGeneral = state.community.general_channel_id?.toLowerCase();
  const requested = selector?.trim();
  const savedGeneralRequested = !!savedGeneral && (!requested || requested.toLowerCase() === "general" || requested.toLowerCase() === savedGeneral);
  let channels: ChannelV2[];
  try {
    channels = await availableChannels(state);
  } catch (error) {
    // The founder knows the immutable genesis channel id. Use it only when
    // the control query itself failed; an authoritative fold that deletes or
    // converts the channel must win over this liveness fallback.
    if (!savedGeneralRequested) throw error;
    const community = communityOf(state.community, state.private_channels);
    const id = hexToBytes(savedGeneral!);
    const streams = community.heldRoots.map((root) => ({ epoch: root.epoch, group: channelGroupKey(root.key, id, root.epoch) }));
    return {
      id,
      idHex: savedGeneral!,
      name: "general",
      isPrivate: false,
      streams,
      current: streams[0],
      voice: {
        room: voiceGroupKey(community.root, id, community.rootEpoch),
        mediaKey: voiceMediaKey(community.root, id, community.rootEpoch),
      },
    };
  }
  let matches: ChannelV2[];
  if (selector) {
    const needle = selector.trim();
    matches = /^[0-9a-f]{64}$/i.test(needle)
      ? channels.filter((channel) => channel.idHex === needle.toLowerCase())
      : channels.filter((channel) => channel.name.toLowerCase() === needle.toLowerCase());
  } else {
    const preferred = state.community.general_channel_id?.toLowerCase();
    matches = preferred ? channels.filter((channel) => channel.idHex === preferred) : [];
    if (matches.length === 0) matches = channels.filter((channel) => !channel.isPrivate && channel.name.toLowerCase() === "general");
    if (matches.length === 0) matches = channels.filter((channel) => !channel.isPrivate).slice(0, 1);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Channel name ${JSON.stringify(selector)} is ambiguous; use its 64-hex id.`);
  const available = channels.map((channel) => `${channel.name} (${channel.idHex})`).join(", ");
  throw new Error(`Channel ${JSON.stringify(selector ?? "general")} not found.${available ? ` Available: ${available}` : ""}`);
}

export interface ChannelMessage {
  id: string; // rumor id — the ordering tiebreak
  author: string;
  ms: number;
  content: string;
  tags: string[][];
}

/** Everything a channel operation needs, resolved once. */
export async function channelContext(state: State, selector?: string): Promise<{
  sk: Uint8Array;
  pubkey: string;
  signer: StreamSigner;
  community: CommunityV2;
  channel: ChannelV2;
}> {
  const sk = hexToBytes(state.sk);
  const pubkey = getPublicKey(sk);
  const signer = signerOf(sk);
  const community = communityOf(state.community, state.private_channels);
  const channel = await resolveChannel(state, selector);
  return { sk, pubkey, signer, community, channel };
}

/** Decrypted #general history (the relay only ever sees ciphertext). */
export async function channelMessages(state: State, selector?: string): Promise<ChannelMessage[]> {
  const { community, channel } = await channelContext(state, selector);
  const streams = new Map(channel.streams.map((stream) => [stream.group.pk, stream]));
  const wraps = await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [...streams.keys()] });
  const messages: ChannelMessage[] = [];
  const seenWraps = new Set<string>();
  for (const wrap of wraps) {
    if (seenWraps.has(wrap.id)) continue;
    seenWraps.add(wrap.id);
    const stream = streams.get(wrap.pubkey);
    if (!stream) continue;
    try {
      const opened = openWrap(wrap, stream.group);
      if (opened.sealKind !== KIND_SEAL_ENCRYPTED) continue;
      checkChannelBinding(opened, channel.idHex, stream.epoch);
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
 *
 * The PER-PROCESS map alone leaves a CLI×CLI hole: two processes retrying the
 * same key both scan before either publishes and double-post (round 10). So a
 * keyed send additionally takes a per-key lockfile — the check-then-publish is
 * then atomic across processes for that key. A contender that waits out the
 * 10s deadline FAILS CLOSED with "locked by another process" instead of
 * double-posting; the read-side (author, d-tag) dedupe remains as belt-and-
 * braces for lock-free writers (older builds, other front-ends).
 */
const inflightKeyedSends = new Map<string, Promise<unknown>>();

/** Per-key lockfile suffix for cross-process keyed-send serialization. */
function sendLockSuffix(idemKey: string): string {
  return `.send-${bytesToHex(sha256(new TextEncoder().encode(idemKey))).slice(0, 16)}.lock`;
}

export async function sendChannelMessage(
  state: State,
  text: string,
  opts: { idemKey?: string; extraTags?: string[][]; channel?: string } = {},
): Promise<{ rumorId: string; deduped: boolean }> {
  if (opts.idemKey) {
    const prior = inflightKeyedSends.get(opts.idemKey);
    if (prior) await prior.catch(() => {}); // a failed send frees the key either way
  }
  const run = opts.idemKey
    ? withStateLock(getPublicKey(hexToBytes(state.sk)), () => sendChannelMessageInner(state, text, opts), sendLockSuffix(opts.idemKey))
    : sendChannelMessageInner(state, text, opts);
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
  opts: { idemKey?: string; extraTags?: string[][]; channel?: string } = {},
): Promise<{ rumorId: string; deduped: boolean }> {
  // Size guard BEFORE building anything: the rumor is nip44-encrypted into a
  // seal, the seal JSON is nip44-encrypted again into the wrap, and NIP-44
  // rejects plaintexts over 65,535 bytes (encryptChecked). With NIP-44's
  // padding (≤ +8,192 for this range) and base64 (×4/3), 40,000 utf8 BYTES of
  // text lands at ~55KB of seal JSON — inside the cap with ~10KB headroom;
  // anything larger risks a raw crypto throw deep in wrapSeal (the CLI prints
  // a stack, MCP a bare isError). 40,000 bytes exactly matches the MCP zod
  // cap's worst case (20,000 UTF-16 units × 2-byte-per-unit astral chars), so
  // every schema-legal MCP message remains sendable — this guard is for the
  // UNLIMITED paths (CLI say, future front-ends).
  const textBytes = new TextEncoder().encode(text).length;
  if (textBytes > 40_000) {
    throw new Error(`Message too large: ${textBytes} bytes (max 40,000 — the sealed wrap must fit NIP-44's 65,535-byte plaintext cap)`);
  }
  const { pubkey, signer, community, channel } = await channelContext(state, opts.channel);
  const group = channel.current.group;

  if (opts.idemKey) {
    const dupe = (await channelMessages(state, opts.channel)).find(
      (m) => m.author === pubkey && m.tags.some((t) => t[0] === "d" && t[1] === opts.idemKey),
    );
    if (dupe) return { rumorId: dupe.id, deduped: true };
  }

  const tags = [...channelBindingTags(channel.idHex, channel.current.epoch), ...(opts.extraTags ?? [])];
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
  await publishAll(community.relays, wrap, `message to #${channel.name}`);
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
  opts: { timeoutSec: number; mentionsOnly: boolean; channel?: string },
): Promise<ChannelMessage | null> {
  const { pubkey, community, channel } = await channelContext(state, opts.channel);
  const streams = new Map(channel.streams.map((stream) => [stream.group.pk, stream]));
  const myNpub = nip19.npubEncode(pubkey);

  // Snapshot: history isn't an interrupt — only wraps arriving after we
  // subscribe count. (Track wrap ids; the rumor ids aren't on the wire.)
  const seen = new Set<string>();
  for (const w of await queryAll(community.relays, { kinds: [KIND_WRAP], authors: [...streams.keys()] })) seen.add(w.id);
  console.error(
    `listening on #${channel.name} of "${community.name}" (timeout ${opts.timeoutSec}s${opts.mentionsOnly ? ", mentions only" : ""})…`,
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
      { kinds: [KIND_WRAP], authors: [...streams.keys()], since: Math.floor(Date.now() / 1000) - 30 },
      {
        onevent(wrap) {
          if (seen.has(wrap.id)) return;
          seen.add(wrap.id);
          let opened: ReturnType<typeof openWrap>;
          try {
            const stream = streams.get(wrap.pubkey);
            if (!stream) return;
            opened = openWrap(wrap, stream.group);
            if (opened.sealKind !== KIND_SEAL_ENCRYPTED) return;
            checkChannelBinding(opened, channel.idHex, stream.epoch);
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
  // The task id rides the content parse `^(\w+)\s+(\S+)`: whitespace would
  // silently turn "CLAIM card 5 …" into a claim on task "card" — refuse for
  // every front-end (MCP's zod regex only covers the MCP path; a quoted CLI
  // argv reaches here too).
  if (/\s/.test(taskId)) throw new Error(`Task id must not contain whitespace: ${JSON.stringify(taskId)}`);
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
