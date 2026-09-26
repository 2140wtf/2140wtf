// src/chat/chatFold.ts
//
// Pure fold of @bao/community ScrollViews into the UI's ChatItem[] -
// extracted from useProtocolChat so it can be unit-tested without React.
//
// Fold semantics (verified against @bao/community v0.2.0 aggregate.d.ts):
//   - `timeline` holds non-redacted, non-reply conversation content.
//     REPLIES ARE NOT IN IT - they live only in
//     `threadIndex.threads[].replies` (rooted) and `threadIndex.orphans`
//     (root missing). A fold that walks timeline only silently drops every
//     reply from the UI (the bug this module fixes).
//   - `reactions` maps msg_id → tallies; retractions/redaction surface as
//     `redacted` on MergedMessage; reply linkage rides INSIDE the encrypted
//     payload (`payload.replyTo`, msg_id of the parent).
//
// Merge semantics:
//   - Every message present in the views folds as status 'scrolled'.
//   - The list is STABLE: a message that has been rendered keeps its place
//     until it is retracted. Newly seen messages append at the bottom.
//     A fold must never move an existing bubble: re-sorting a just-sent
//     message into its canonical slot is what made it jump into the middle
//     of the visible history ("my message shows up in the middle").
//   - Previous items are refreshed IN PLACE from the canonical copy (status
//     pending -> scrolled, reaction tallies, retraction tombstones).
//   - A message absent from a partial/stale scroll read is KEPT (never
//     dropped); only the retraction list removes a rendered message.
//
// Initial-history ordering: timeline is scribe-ordered, and each timeline
// message's replies render IMMEDIATELY AFTER their root (nested replies
// recursively, in canonical thread order). Replies whose root is not in the
// timeline (redacted root, or a reply-of-a-reply root) are appended after
// the timeline, then orphans.

import type { ScrollViews } from '@/baofund/community/aggregate.js';
import type { MergedMessage } from '@/baofund/community/merge.js';
import { decodeTextPayload } from '../lib/baoCommunity';

/** Hard cap on a single message's text length (chars) - prevents a paste of
 *  megabytes from being encrypted/posted, and bounds DOM size per message. */
export const MAX_MESSAGE_CHARS = 8_000;

export interface ChatItem {
  id: string; // envelope msg_id
  author: string; // throwaway author pubkey
  text: string;
  status: 'pending' | 'scrolled';
  /** Reaction tallies for this message: emoji → count. */
  reactions?: Record<string, number>;
  /** True when the author retracted this message (tombstone shown). */
  retracted?: boolean;
  /** msg_id this message replies to (thread view), when present. */
  replyTo?: string;
}

/**
 * Bot control payloads (owner spec: bots are visible as bots, their plumbing
 * is not chat). Bots ride the MCP/IPC TEXT lane, so control JSON arrives in
 * THREE shapes:
 *   1. object payload        { botHello: {...} } / { botManifest: [...] }
 *   2. text-lane JSON string { text: '{"botHello":...}' }  (the common one)
 *   3. bare JSON string      '{"botHello":...}'
 * Detection covers all three and stays bounded: only strings up to
 * MAX_MESSAGE_CHARS are parsed.
 */
const BOT_HELLO_KEYS = (p: Record<string, unknown>): boolean =>
  // Flat botHello: { identity, name, llm } - announces as a bot.
  typeof p.identity === 'string' && typeof p.name === 'string' && 'llm' in p;

const controlObjectOfText = (text: string): Record<string, unknown> | null => {
  if (text.length > MAX_MESSAGE_CHARS) return null;
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;
      if (p.botHello !== undefined || p.botManifest !== undefined || BOT_HELLO_KEYS(p)) return p;
    }
    return null;
  } catch {
    // Malformed JSON in the text lane is just a user's text - never hidden.
    return null;
  }
};

export function botControlObject(payload: unknown): Record<string, unknown> | null {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (p.botHello !== undefined || p.botManifest !== undefined || BOT_HELLO_KEYS(p)) return p;
    // Text-lane shape: the control JSON rides the { text } convention.
    if (typeof p.text === 'string') return controlObjectOfText(p.text);
    return null;
  }
  if (typeof payload === 'string') return controlObjectOfText(payload);
  return null;
}

export function isBotControlPayload(payload: unknown): boolean {
  return botControlObject(payload) !== null;
}

/** The keys a control payload may badge, BOUND to the posting author: the
 *  author itself, the author's verified member identity (F7 claim), or a
 *  claimed burner equal to the author. A payload claiming a third party's key
 *  is ignored - announcing a bot is self-description, never a way to badge
 *  someone else's messages. */
export function botIdentitiesOf(
  payload: unknown,
  opts: { author: string; claimedMemberOf?: (burner: string) => string | null },
): string[] {
  const p = botControlObject(payload);
  if (!p) return [];
  const author = opts.author.toLowerCase();
  const ids = new Set<string>([author]);
  const hello = (p.botHello && typeof p.botHello === 'object' ? p.botHello : p) as Record<string, unknown>;
  const claimedIdentity = typeof hello.identity === 'string' ? hello.identity.toLowerCase() : null;
  const claimedBurner = typeof hello.burner === 'string' ? hello.burner.toLowerCase() : null;
  const boundMember = opts.claimedMemberOf?.(author)?.toLowerCase() ?? null;
  if (claimedIdentity && (claimedIdentity === author || claimedIdentity === boundMember)) ids.add(claimedIdentity);
  if (claimedBurner === author) ids.add(claimedBurner);
  return [...ids];
}

/** Extract the reply linkage from an envelope's encrypted payload, if any. */
export function replyTargetOf(mm: MergedMessage): string | null {
  const payload = mm.envelope.payload;
  if (payload && typeof payload === 'object') {
    const replyTo = (payload as { replyTo?: unknown }).replyTo;
    if (typeof replyTo === 'string' && replyTo.length > 0) return replyTo;
  }
  return null;
}

/** Protocol identity of a rendered item. The wire dedup key is
 *  (author, msg_id) - `envelope.msg_id` is only 16 random bytes and two
 *  authors may legitimately carry the same id. Ids alone must never dedupe,
 *  refresh or remove items: anyone could otherwise shadow (hide or overwrite)
 *  another author's message by copying its msg_id. */
export function chatIdentityKey(author: string, id: string): string {
  return `${author.toLowerCase()}:${id}`;
}

interface FoldOptions {
  /** Previous ChatItem list - the stable rendered order. Items keep their
   *  position and are refreshed in place; pending bubbles and replyTo carry
   *  across re-folds. */
  previous?: ChatItem[];
  /** Governance-REDACTED identities the scroll no longer carries
   *  (aggregateScroll drops them without a retraction entry). Accepts both
   *  identity keys (chatIdentityKey) and bare msg_ids; without this the
   *  stable merge would keep showing removed content forever. */
  removed?: ReadonlySet<string>;
}

export function foldViewsToChatItems(views: ScrollViews, opts: FoldOptions = {}): ChatItem[] {
  const previous = opts.previous ?? [];
  const prevById = new Map(previous.map((m) => [chatIdentityKey(m.author, m.id), m]));

  // 1. Canonical sequence from the scroll (no pending carry-over yet).
  const canonical: ChatItem[] = [];
  const seen = new Set<string>();

  const push = (mm: MergedMessage) => {
    // Bot control payloads (both object and text-lane JSON-string shapes) are
    // plumbing, never chat - hidden from the timeline in every path.
    if (isBotControlPayload(mm.envelope.payload)) return;
    const decoded = decodeTextPayload(mm.envelope.payload);
    if (decoded === null) return;
    const text = decoded.length > MAX_MESSAGE_CHARS ? decoded.slice(0, MAX_MESSAGE_CHARS) : decoded;
    const id = mm.envelope.msg_id;
    const key = chatIdentityKey(mm.envelope.author, id);
    if (seen.has(key)) return;
    seen.add(key);
    const existing = prevById.get(key);
    const tallies = views.reactions.get(id) ?? [];
    const reactions: Record<string, number> = {};
    for (const t of tallies) reactions[t.emoji] = t.count;
    const replyTo = replyTargetOf(mm) ?? existing?.replyTo;
    canonical.push({
      id,
      author: mm.envelope.author,
      text,
      status: 'scrolled',
      reactions: Object.keys(reactions).length > 0 ? reactions : undefined,
      retracted: mm.redacted,
      ...(replyTo ? { replyTo } : {}),
    });
  };

  // Replies render under their root on first read: a normal message sent
  // after an older reply must stay BELOW that reply, never above it.
  // `visitedThreads` bounds the recursion (a reply can itself be a thread
  // root) and makes a replyTo cycle harmless.
  const threads = views.threadIndex.threads;
  const visitedThreads = new Set<string>();
  const pushThreadFor = (rootId: string): void => {
    if (visitedThreads.has(rootId)) return;
    visitedThreads.add(rootId);
    const thread = threads.get(rootId);
    if (!thread) return;
    for (const reply of thread.replies) {
      push(reply);
      pushThreadFor(reply.envelope.msg_id);
    }
  };
  for (const mm of views.timeline) {
    push(mm);
    pushThreadFor(mm.envelope.msg_id);
  }
  // Threads whose root never appeared in the timeline (redacted root, or a
  // nested thread whose root is itself a reply): after the timeline, in
  // canonical thread order.
  for (const rootId of threads.keys()) pushThreadFor(rootId);
  for (const orphan of views.threadIndex.orphans) push(orphan);

  // 2. Stable merge. The rendered list is the source of truth for ORDER:
  // previous items keep their position, refreshed from their canonical copy
  // when one exists (pending -> scrolled, reactions, tombstones). A message
  // missing from a partial read is kept, never dropped; only the retraction
  // list removes it. Canonical items not rendered yet append at the bottom
  // (initial history, and messages that genuinely arrived after).
  const canonicalById = new Map(canonical.map((m) => [chatIdentityKey(m.author, m.id), m]));
  const out: ChatItem[] = [];
  const emitted = new Set<string>();
  const emit = (item: ChatItem): void => {
    const key = chatIdentityKey(item.author, item.id);
    if (emitted.has(key)) return;
    emitted.add(key);
    out.push(item);
  };
  for (const prev of previous) {
    const key = chatIdentityKey(prev.author, prev.id);
    const copy = canonicalById.get(key);
    // Retraction: apply only when the retractor IS this item's author (the
    // map value is the retractor's key; foldRetractions enforces authorship
    // on the wire, and the author check keeps same-id items by other authors).
    const retracted = views.retractions.retracted.get(prev.id);
    if (retracted !== undefined && retracted.toLowerCase() === prev.author.toLowerCase()) continue;
    // Governance redaction: drop only when the id is gone from the canonical
    // read AND this identity has no live copy (a same-id message by another
    // author survives).
    if (!copy && (opts.removed?.has(key) || opts.removed?.has(prev.id))) continue;
    emit(copy ?? prev);
  }
  // Watermark: when the rendered window is already at the cap, canonical
  // items at or before the oldest rendered item were evicted deliberately -
  // re-appending them would slide the window backwards on every fold.
  let watermark = -1;
  const oldest = previous[0];
  if (previous.length >= MAX_RENDERED_MESSAGES && oldest) {
    watermark = canonical.findIndex(
      (m) => m.id === oldest.id && m.author.toLowerCase() === oldest.author.toLowerCase(),
    );
  }
  for (let i = 0; i < canonical.length; i++) {
    if (watermark >= 0 && i <= watermark) continue;
    emit(canonical[i]);
  }

  // DOM bound: keep only the most recent MAX_RENDERED_MESSAGES items.
  // Long sessions must not grow the message list (and DOM) without limit.
  if (out.length > MAX_RENDERED_MESSAGES) {
    return out.slice(out.length - MAX_RENDERED_MESSAGES);
  }
  return out;
}

/** Hard cap on the number of ChatItems rendered (DOM bound for long sessions). */
export const MAX_RENDERED_MESSAGES = 500;
