/**
 * Concord V2 Chat Plane — CORD-03.
 *
 * A Channel's messages, reactions, edits, and deletes are ordinary rumors
 * inside encrypted seals at the Channel's stream address (one per held epoch,
 * so history spanning a rekey stays continuous). Each rumor MUST commit
 * `["channel", id]` + `["epoch", n]`, checked strict-equal against the
 * coordinate whose key decrypted the wrap (CORD-03 §3).
 *
 * Decoding (two NIP-44 opens + a Schnorr verify per wrap) is memoized per wrap
 * id and chunked off the main thread, so re-reading the append-only local
 * store costs near-nothing after the first pass.
 */

import type { NostrEvent } from "nostr-tools/pure";

import { KIND_COMMENT, KIND_DELETE, KIND_EDIT, KIND_MESSAGE, KIND_ONCHAIN_ZAP, KIND_REACTION, KIND_SEAL_ENCRYPTED, KIND_ZAP } from "@/concord-v2/lib/kinds";
import { reactionContentKey } from "@/hooks/useReactions";
import { verifyOnchainZapRumor, verifyZapRumor, type ZapEntry } from "@/lib/zaps";
import { checkChannelBinding, openWrap, type OpenedEvent } from "@/concord-v2/lib/stream";
import type { ChannelV2 } from "@/concord-v2/lib/types";

/** An opened chat event with its verified channel/epoch coordinate. */
export interface OpenedChat extends OpenedEvent {
  channelIdHex: string;
  epoch: bigint;
}

// ── Decode-once cache ────────────────────────────────────────────────────────

/** `wrapId|channelIdHex` → opened (or null = remembered failure). Session-scoped.
 *  Keyed per channel so one channel's "not my key" can't poison another's decode. */
const decodeMemo = new Map<string, OpenedChat | null>();
/** Memo keys that failed as "no held stream key" — retryable after a rekey catch-up. */
const skippedNoKey = new Set<string>();

/** Forget remembered no-key failures (a caught-up rekey may now decode them). */
export function forgetChatSkips(): void {
  for (const id of skippedNoKey) decodeMemo.delete(id);
  skippedNoKey.clear();
}

function openOne(wrap: NostrEvent, channel: ChannelV2): OpenedChat | null {
  const memoKey = `${wrap.id}|${channel.idHex}`;
  const cached = decodeMemo.get(memoKey);
  if (cached !== undefined) return cached;

  const stream = channel.streams.find((s) => s.group.pk === wrap.pubkey);
  if (!stream) {
    decodeMemo.set(memoKey, null);
    skippedNoKey.add(memoKey);
    return null;
  }
  let opened: OpenedChat | null = null;
  try {
    const ev = openWrap(wrap, stream.group);
    // Chat seals MUST be encrypted (CORD-02 §5) — a plaintext seal would make
    // the message a standalone signed artifact any relay could display.
    if (ev.sealKind !== KIND_SEAL_ENCRYPTED) throw new Error("chat seal must be encrypted");
    checkChannelBinding(ev, channel.idHex, stream.epoch);
    opened = { ...ev, channelIdHex: channel.idHex, epoch: stream.epoch };
  } catch {
    opened = null;
  }
  decodeMemo.set(memoKey, opened);
  return opened;
}

/** Max unbroken main-thread time (ms) to spend decoding before yielding.
 *  Time-based (not a fixed wrap count) so a slow phone yields sooner than a
 *  fast desktop instead of both blocking for a fixed number of Schnorr verifies
 *  — long synchronous tasks are what trip WebKit/Gecko "page unresponsive"
 *  kills and jank. Keep well below 16ms so Android WebView's input pipeline
 *  (swipe-type composition events) has room to run between slices. */
const DECODE_SLICE_MS = 5;

/**
 * Open a batch of sealed wraps for one channel, memoized and time-sliced off
 * the main thread so a large first decode never freezes the UI. Each wrap costs
 * two synchronous NIP-44 decrypts + a Schnorr verify (nostr-tools `@noble`,
 * main-thread), so we yield whenever a slice has run longer than
 * {@link DECODE_SLICE_MS}. Skips (foreign epochs, malformed, spliced) are
 * silent, as in Vector's read path.
 */
export async function openChatBatch(
  wraps: NostrEvent[],
  channel: ChannelV2,
  opts?: { signal?: AbortSignal },
): Promise<OpenedChat[]> {
  const out: OpenedChat[] = [];
  let sliceStart = performance.now();
  for (let i = 0; i < wraps.length; i++) {
    if (opts?.signal?.aborted) break;
    const opened = openOne(wraps[i], channel);
    if (opened) out.push(opened);
    // Yield once this slice has run long enough (and more work remains), so the
    // main thread stays responsive during a large backfill decode.
    if (i + 1 < wraps.length && performance.now() - sliceStart >= DECODE_SLICE_MS) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = performance.now();
    }
  }
  return out;
}

// ── Tag helpers ──────────────────────────────────────────────────────────────

/**
 * Build the NIP-22 tags for a kind-1111 threaded reply to `parent`. The
 * uppercase `K`/`E`/`P` tags pin the immutable *thread root*; the lowercase
 * `k`/`e`/`p` tags point at the *immediate parent*. When the parent is itself a
 * comment, its uppercase root tags are inherited so the root is stable at any
 * nesting depth (matching the NIP-29 side, `buildCommentTags`). All ids are
 * RUMOR ids (the NIP-01 hash of the inner unsigned event), so a reply cites
 * exactly the decrypted message the user replied to.
 *
 * This is deliberately distinct from a kind-9 `q` tag: NIP-C7 reserves `q` for
 * inline quote-replies, while threads are NIP-22 comments.
 *
 * https://github.com/nostr-protocol/nips/blob/master/22.md
 */
export function buildV2CommentTags(parent: { id: string; kind: number; pubkey: string; tags: string[][] }): string[][] {
  const tags: string[][] = [];

  const rootTags = parent.tags.filter(([n]) => n === "K" || n === "E" || n === "P");
  if (rootTags.length > 0) {
    // Parent is itself a comment: inherit its root pointer verbatim.
    for (const t of rootTags) tags.push([...t]);
  } else {
    // Parent is the root of this thread.
    tags.push(["K", String(parent.kind)]);
    tags.push(["E", parent.id, "", parent.pubkey]);
    tags.push(["P", parent.pubkey]);
  }

  // Immediate-parent pointer (always the event being replied to).
  tags.push(["k", String(parent.kind)]);
  tags.push(["e", parent.id, "", parent.pubkey]);
  tags.push(["p", parent.pubkey]);

  return tags;
}

/**
 * The thread-root rumor id a message belongs to, or undefined for a top-level
 * message. Threaded replies are NIP-22 kind-1111 comments carrying the root in
 * their uppercase `E` tag. A kind-9 `q` tag is an INLINE reply (timeline, not a
 * thread), so it is deliberately NOT treated as a thread root.
 */
export function replyTargetOf(ev: { kind: number; tags: string[][] }): string | undefined {
  return ev.kind === KIND_COMMENT ? ev.tags.find((t) => t[0] === "E")?.[1] : undefined;
}

/** Reactions / edits / deletes name their target rumor with an `e` tag. */
export function eTargetOf(ev: { tags: string[][] }): string | undefined {
  return ev.tags.find((t) => t[0] === "e")?.[1];
}

// ── Timeline fold ────────────────────────────────────────────────────────────

/** Moderation context the read path applies while folding. */
export interface ChatModeration {
  /** Banned author pubkeys — every event from them is dropped (CORD-04 §4). */
  banned: Set<string>;
  /** Whether `deleter` may delete a message by `author` (MANAGE_MESSAGES). */
  canDelete: (deleter: string, author: string) => boolean;
}

/** A tallied reaction: reactors (pubkey→rumorId) plus the NIP-30 custom-emoji URL (if any). */
export interface ReactionEntry {
  reactors: Map<string, string>;
  url?: string;
}

export interface FoldedTimeline {
  /** Surviving messages, sorted by ms ascending. */
  messages: OpenedChat[];
  /** target rumor id → emoji → tally. */
  reactions: Map<string, Map<string, ReactionEntry>>;
  /** target rumor id → VERIFIED zaps (CORD.md §4; unverified never enter). */
  zaps: Map<string, ZapEntry[]>;
}

/**
 * Per-rumor CORD.md verdict cache (payment hash when valid, null when not).
 * A rumor's tags never change, so each zap is hashed/decoded once per session
 * no matter how many folds re-run over it. Capped to bound memory.
 */
const zapVerdicts = new Map<string, string | null>();
const ZAP_VERDICT_CAP = 8192;

/**
 * Session-scoped set of reaction rumor ids that have been deleted by a kind-5.
 * The rumor store's NIP-09 only processes deletes within the same write
 * batch — a reaction re-delivered by a relay echo (in a later batch) gets
 * re-added to the store. This set lets the fold skip such re-delivered
 * reactions across fold invocations, so a removed reaction stays removed
 * even when the store forgets the deletion. Capped to bound memory.
 */
const deletedReactionIds = new Set<string>();
const DELETED_REACTION_CAP = 8192;

/**
 * Mark a reaction rumor id as deleted NOW, before the kind-5 delete rumor is
 * sealed and inserted into the cache. The fold skips any reaction whose id is
 * in this set, so the removal is immediate (no waiting for the async send to
 * complete and the fold to re-run with the delete event).
 */
export function markReactionDeleted(rumorId: string): void {
  if (deletedReactionIds.size >= DELETED_REACTION_CAP) {
    deletedReactionIds.delete(deletedReactionIds.values().next().value as string);
  }
  deletedReactionIds.add(rumorId);
}

/**
 * Fold a batch of opened chat events into the channel timeline: drop banned
 * authors, apply edits (author-only, latest by ms), and tally reactions per
 * target.
 *
 * Deletes are DELETES, not hides: a kind-5 rumor physically removes its target
 * from the rumor cache on write (self-delete via the store's NIP-09; a
 * moderator delete is authorized against the roster at the write site before it
 * reaches the store). So a folded set read back from the cache never contains a
 * deleted message. The delete pass here is only a belt-and-suspenders for
 * IN-BATCH deletes — an optimistic or just-arrived kind-5 folded alongside its
 * target before the store's async removal has committed — and applies the same
 * authorization (self, or a `canDelete` moderator) so the two paths agree.
 */
export function foldTimeline(opened: OpenedChat[], moderation?: ChatModeration): FoldedTimeline {
  const byId = new Map<string, OpenedChat>();
  const deletes = new Map<string, Set<string>>();
  // ALL edits per target (author validity is judged against the message in the
  // apply phase — otherwise a non-author's later "edit" would suppress the
  // author's legitimate one).
  const edits = new Map<string, Array<{ author: string; content: string; ms: number }>>();
  const reactions = new Map<string, Map<string, ReactionEntry>>();
  // Verified zap candidates, deduped by payment hash (Lightning) or txid
  // (on-chain) after the loop: an announced proof or txid is visible to every
  // member, so without this anyone could replay someone else's and inflate
  // tallies (CORD.md §4).
  const zapCandidates: Array<{ target: string; hash: string; ms: number; entry: ZapEntry }> = [];

  for (const ev of opened) {
    if (moderation?.banned.has(ev.author)) continue;

    if (ev.kind === KIND_DELETE) {
      // NIP-09 shape: possibly several `e` targets.
      for (const t of ev.tags) {
        if (t[0] !== "e" || !t[1]) continue;
        const target = t[1];
        let authors = deletes.get(target);
        if (!authors) deletes.set(target, (authors = new Set()));
        authors.add(ev.author);
        // Track deleted reaction rumor ids across fold invocations so a
        // relay-echoed reaction (re-added to the store in a later write
        // batch) stays removed. The `k` tag identifies the target kind.
        const kTag = ev.tags.find(([n]) => n === "k")?.[1];
        if (kTag === String(KIND_REACTION)) {
          if (deletedReactionIds.size >= DELETED_REACTION_CAP) {
            deletedReactionIds.delete(deletedReactionIds.values().next().value as string);
          }
          deletedReactionIds.add(target);
        }
      }
      continue;
    }
    if (ev.kind === KIND_EDIT) {
      const target = eTargetOf(ev);
      if (!target) continue;
      let list = edits.get(target);
      if (!list) edits.set(target, (list = []));
      list.push({ author: ev.author, content: ev.content, ms: ev.ms });
      continue;
    }
    if (ev.kind === KIND_REACTION) {
      const target = eTargetOf(ev);
      if (!target || !ev.content) continue;
      // Skip reactions whose kind-5 delete we've seen in a previous fold
      // invocation (the store may have re-added them via a relay echo).
      if (deletedReactionIds.has(ev.rumorId)) continue;
      const key = reactionContentKey(ev.content);
      const url = ev.tags.find((t) => t[0] === "emoji")?.[2];
      let byEmoji = reactions.get(target);
      if (!byEmoji) reactions.set(target, (byEmoji = new Map()));
      let entry = byEmoji.get(key);
      if (!entry) byEmoji.set(key, (entry = { reactors: new Map() }));
      entry.reactors.set(ev.author, ev.rumorId);
      if (url && !entry.url) entry.url = url;
      continue;
    }
    if (ev.kind === KIND_ZAP) {
      const target = eTargetOf(ev);
      if (!target) continue;
      let verdict = zapVerdicts.get(ev.rumorId);
      if (verdict === undefined) {
        if (zapVerdicts.size >= ZAP_VERDICT_CAP) {
          zapVerdicts.delete(zapVerdicts.keys().next().value as string);
        }
        verdict = verifyZapRumor({ kind: ev.kind, tags: ev.tags });
        zapVerdicts.set(ev.rumorId, verdict);
      }
      if (!verdict) continue;
      const msats = Number(ev.tags.find((t) => t[0] === "amount")?.[1]);
      zapCandidates.push({
        target,
        hash: verdict,
        ms: ev.ms,
        entry: {
          id: ev.rumorId,
          pubkey: ev.author,
          sats: Math.floor(msats / 1000),
          comment: ev.content,
          rail: "lightning",
        },
      });
      continue;
    }
    if (ev.kind === KIND_ONCHAIN_ZAP) {
      const target = eTargetOf(ev);
      if (!target) continue;
      // On-chain zaps have no preimage — the txid on a public ledger is the
      // proof. Dedup by txid so one tx counts once per channel.
      const txid = verifyOnchainZapRumor({ kind: ev.kind, tags: ev.tags });
      if (!txid) continue;
      const sats = Number(ev.tags.find((t) => t[0] === "amount")?.[1]);
      zapCandidates.push({
        target,
        hash: txid,
        ms: ev.ms,
        entry: {
          id: ev.rumorId,
          pubkey: ev.author,
          sats,
          comment: ev.content,
          rail: "onchain",
        },
      });
      continue;
    }
    if (ev.kind === KIND_MESSAGE || ev.kind === KIND_COMMENT) {
      // kind-9 top-level messages and kind-1111 threaded replies both land in
      // the timeline pool; the reader splits them by their NIP-22 root pointer.
      byId.set(ev.rumorId, ev);
    }
  }

  // Edits: only the original author may edit; their latest (by ms) wins.
  for (const [id, list] of edits) {
    const msg = byId.get(id);
    if (!msg) continue;
    let best: { content: string; ms: number } | undefined;
    for (const e of list) {
      if (e.author !== msg.author) continue;
      if (!best || e.ms > best.ms) best = e;
    }
    if (best) byId.set(id, { ...msg, content: best.content });
  }

  // In-batch deletes: self-delete, or an authorized moderator delete.
  for (const [id, msg] of byId) {
    const deleters = deletes.get(id);
    if (!deleters) continue;
    const deleted =
      deleters.has(msg.author) ||
      (moderation && [...deleters].some((d) => moderation.canDelete(d, msg.author)));
    if (deleted) byId.delete(id);
  }

  // In-batch reaction deletes: a kind-5 targeting a reaction rumor removes
  // that reactor from the tally (the store's NIP-09 handles the persistent
  // case; this covers a delete folded alongside its target before the store
  // async-removes it).
  for (const [targetId, byEmoji] of reactions) {
    for (const [emoji, entry] of byEmoji) {
      for (const [pubkey, rumorId] of entry.reactors) {
        const deleters = deletes.get(rumorId);
        if (deleters && deleters.has(pubkey)) {
          entry.reactors.delete(pubkey);
        }
      }
      if (entry.reactors.size === 0) byEmoji.delete(emoji);
    }
    if (byEmoji.size === 0) reactions.delete(targetId);
  }

  // Zaps: one payment counts once, earliest rumor (ms, then id) winning
  // deterministically so every member folds the same tally.
  const zaps = new Map<string, ZapEntry[]>();
  const claimedHashes = new Set<string>();
  zapCandidates.sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.entry.id < b.entry.id ? -1 : 1));
  for (const { target, hash, entry } of zapCandidates) {
    if (claimedHashes.has(hash)) continue;
    claimedHashes.add(hash);
    let list = zaps.get(target);
    if (!list) zaps.set(target, (list = []));
    list.push(entry);
  }

  return {
    messages: [...byId.values()].sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.rumorId < b.rumorId ? -1 : 1)),
    reactions,
    zaps,
  };
}
