// src/chat/chatFold.test.ts
//
// Unit tests for the pure views→ChatItem fold. These pin the semantics that
// the Round-2 bug sweep established:
//   - replies (threadIndex) are NOT dropped (timeline excludes them),
//   - optimistic pending bubbles survive folds until the scroll confirms
//     them, then flip to scrolled (never the reverse),
//   - reaction tallies, retraction tombstones, and replyTo linkage fold.

import { describe, expect, it } from 'vitest';
import type { ScrollViews } from '@/baofund/community/aggregate.js';
import type { MergedMessage } from '@/baofund/community/merge.js';

import { foldViewsToChatItems, isBotControlPayload, botIdentitiesOf, replyTargetOf, type ChatItem } from './chatFold';

const EMPTY_VIEWS: ScrollViews = {
  timeline: [],
  threadIndex: { threads: new Map(), orphans: [] },
  reactions: new Map(),
  reviews: new Map(),
  manifests: new Map(),
  roster: new Map(),
  redactedCount: 0,
  retractions: { retracted: new Map(), dangling: [] },
};

let seq = 0;
const env = (overrides: Partial<{ id: string; author: string; payload: unknown }> = {}): MergedMessage => {
  seq += 1;
  return {
    envelope: {
      v: 1,
      msg_id: overrides.id ?? `msg-${seq}`,
      room: 'room',
      epoch: 1,
      author: overrides.author ?? 'aaaaaaaaaa',
      payload: overrides.payload ?? { text: 'hello' },
    },
    scribes: ['s1'],
    redacted: false,
  };
};

const thread = (root: MergedMessage, replies: MergedMessage[]) => ({
  root,
  replies,
  replyCount: replies.length,
  participants: [root.envelope.author, ...replies.map((r) => r.envelope.author)],
});

describe('chatFold: timeline + replies (the reply-drop bug)', () => {
  it('includes replies from threadIndex.threads - timeline alone excludes them', () => {
    const root = env({ payload: { text: 'root' } });
    const reply = env({ payload: { text: 'a reply', replyTo: root.envelope.msg_id } });
    const views: ScrollViews = {
      ...EMPTY_VIEWS,
      timeline: [root],
      threadIndex: { threads: new Map([[root.envelope.msg_id, thread(root, [reply])]]), orphans: [] },
    };
    const items = foldViewsToChatItems(views);
    expect(items.map((m) => m.text)).toEqual(['root', 'a reply']);
    expect(items[1]!.replyTo).toBe(root.envelope.msg_id);
  });

  it('includes orphaned replies whose root is not yet scrolled', () => {
    const orphan = env({ payload: { text: 'orphan reply', replyTo: 'missing-root' } });
    const views: ScrollViews = {
      ...EMPTY_VIEWS,
      timeline: [],
      threadIndex: { threads: new Map(), orphans: [orphan] },
    };
    const items = foldViewsToChatItems(views);
    expect(items.length).toBe(1);
    expect(items[0]!.text).toBe('orphan reply');
    expect(items[0]!.replyTo).toBe('missing-root');
  });

  it('renders a reply directly under its root - a later message never jumps above it', () => {
    // Regression: replies used to be appended after the WHOLE timeline, so a
    // newly sent normal message (C) rendered above an older reply (B).
    const a = env({ id: 'a', payload: { text: 'older normal' } });
    const b = env({ id: 'b', payload: { text: 'older reply', replyTo: 'a' } });
    const c = env({ id: 'c', payload: { text: 'my new message' } });
    const views: ScrollViews = {
      ...EMPTY_VIEWS,
      timeline: [a, c],
      threadIndex: { threads: new Map([['a', thread(a, [b])]]), orphans: [] },
    };
    const items = foldViewsToChatItems(views);
    expect(items.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('renders nested replies under their reply root, in thread order', () => {
    const a = env({ id: 'a', payload: { text: 'root' } });
    const b = env({ id: 'b', payload: { text: 'reply', replyTo: 'a' } });
    const d = env({ id: 'd', payload: { text: 'reply to the reply', replyTo: 'b' } });
    const c = env({ id: 'c', payload: { text: 'newer normal' } });
    const views: ScrollViews = {
      ...EMPTY_VIEWS,
      timeline: [a, c],
      threadIndex: {
        threads: new Map([
          ['a', thread(a, [b])],
          ['b', thread(b, [d])],
        ]),
        orphans: [],
      },
    };
    const items = foldViewsToChatItems(views);
    expect(items.map((m) => m.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('terminates on a replyTo cycle and renders each message once', () => {
    const a = env({ id: 'a', payload: { text: 'a', replyTo: 'b' } });
    const b = env({ id: 'b', payload: { text: 'b', replyTo: 'a' } });
    const views: ScrollViews = {
      ...EMPTY_VIEWS,
      timeline: [],
      threadIndex: {
        threads: new Map([
          ['a', thread(a, [b])],
          ['b', thread(b, [a])],
        ]),
        orphans: [],
      },
    };
    const items = foldViewsToChatItems(views);
    expect(items.map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(new Set(items.map((m) => m.id)).size).toBe(2);
  });

  it('drops non-text payloads (reactions/manifests) from the message list', () => {
    const reaction = env({ payload: { reaction: '⚡', target: 'msg-1' } });
    const text = env({ payload: { text: 'real message' } });
    const views: ScrollViews = { ...EMPTY_VIEWS, timeline: [reaction, text] };
    const items = foldViewsToChatItems(views);
    expect(items.map((m) => m.text)).toEqual(['real message']);
  });

  it('drops bot control payloads in BOTH shapes - object and text-lane JSON string', () => {
    // Object shape (direct session.post payload).
    expect(isBotControlPayload({ botHello: { identity: 'x', name: 'b', llm: true } })).toBe(true);
    expect(isBotControlPayload({ botManifest: [{ name: 'cmd' }] })).toBe(true);
    // Text-lane shape (bots ride the MCP/IPC text lane: JSON.stringify in text).
    expect(isBotControlPayload({ text: JSON.stringify({ botManifest: [{ name: 'cmd' }] }) })).toBe(true);
    expect(isBotControlPayload({ text: JSON.stringify({ botHello: { identity: 'x', burner: 'y', name: 'b', llm: true } }) })).toBe(true);
    // Ordinary chat never matches.
    expect(isBotControlPayload({ text: 'plain message with { braces' })).toBe(false);
    expect(isBotControlPayload({ text: '{"some":"other json"}' })).toBe(false);
    expect(isBotControlPayload({ text: 'hello' })).toBe(false);
    // Malformed JSON in the text lane is user text - never hidden.
    expect(isBotControlPayload({ text: '{botManifest: broken' })).toBe(false);
  });

  it('foldViewsToChatItems hides string-shaped bot control payloads from the timeline', () => {
    const manifestString = env({ payload: { text: JSON.stringify({ botManifest: [{ name: 'fund-status' }] }) } });
    const helloString = env({ payload: { text: JSON.stringify({ botHello: { identity: 'aa', name: 'bot1', llm: true } }) } });
    const real = env({ payload: { text: 'visible chat' } });
    const views: ScrollViews = { ...EMPTY_VIEWS, timeline: [manifestString, helloString, real] };
    const items = foldViewsToChatItems(views);
    expect(items.map((m) => m.text)).toEqual(['visible chat']);
  });

  it('botIdentitiesOf badges the author and only keys bound to it', () => {
    // author === claimed identity; a claimed burner of a third party is dropped
    expect(botIdentitiesOf({ botHello: { identity: 'ID1', burner: 'BRN' } }, { author: 'ID1' })).toEqual(['id1']);
    // claimed burner === author
    expect(botIdentitiesOf({ botHello: { identity: 'ID1', burner: 'BRN' } }, { author: 'BRN' })).toEqual(['brn']);
    // durable identity bound through the verified member claim
    expect(
      botIdentitiesOf({ text: JSON.stringify({ botHello: { identity: 'ID2', name: 'b', llm: false } }) }, { author: 'burner-2', claimedMemberOf: () => 'ID2' }),
    ).toEqual(['burner-2', 'id2']);
    // spoofing a third party is ignored
    expect(botIdentitiesOf({ botHello: { identity: 'VICTIM', burner: 'VICTIM', name: 'x', llm: true } }, { author: 'attacker' })).toEqual(['attacker']);
    expect(botIdentitiesOf({ botHello: { identity: 'VICTIM', name: 'x', llm: true } }, { author: 'attacker', claimedMemberOf: () => 'someone-else' })).toEqual(['attacker']);
    expect(botIdentitiesOf({ text: 'not a bot' }, { author: 'x' })).toEqual([]);
  });
});

describe('chatFold: optimistic pending bubbles', () => {
  it('carries unconfirmed pending bubbles across folds (no vanish)', () => {
    const pending = { id: 'pending-1', author: 'me', text: 'my msg', status: 'pending' as const };
    const scrolled = env({ id: 'other-1', payload: { text: 'other' } });
    const views: ScrollViews = { ...EMPTY_VIEWS, timeline: [scrolled] };
    const items = foldViewsToChatItems(views, { previous: [pending] });
    expect(items.map((m) => m.id)).toContain('pending-1');
    expect(items.find((m) => m.id === 'pending-1')!.status).toBe('pending');
  });

  it('flips pending → scrolled once the scroll contains the id (never reverse)', () => {
    const scrolledEnv = env({ id: 'msg-1', payload: { text: 'my msg' } });
    const pending = { id: 'msg-1', author: scrolledEnv.envelope.author, text: 'my msg', status: 'pending' as const };
    const views: ScrollViews = { ...EMPTY_VIEWS, timeline: [scrolledEnv] };
    const items = foldViewsToChatItems(views, { previous: [pending] });
    const item = items.find((m) => m.id === 'msg-1')!;
    expect(item.status).toBe('scrolled');
    expect(items.filter((m) => m.id === 'msg-1').length).toBe(1); // no duplicate
  });

  it('drops a pending bubble once its real envelope arrives via a thread reply', () => {
    const root = env({ payload: { text: 'root' } });
    const reply = env({ id: 'reply-1', payload: { text: 'my reply', replyTo: root.envelope.msg_id } });
    const pending = { id: 'reply-1', author: reply.envelope.author, text: 'my reply', status: 'pending' as const };
    const views: ScrollViews = {
      ...EMPTY_VIEWS,
      timeline: [root],
      threadIndex: { threads: new Map([[root.envelope.msg_id, thread(root, [reply])]]), orphans: [] },
    };
    const items = foldViewsToChatItems(views, { previous: [pending] });
    expect(items.filter((m) => m.id === 'reply-1').length).toBe(1);
    expect(items.find((m) => m.id === 'reply-1')!.status).toBe('scrolled');
  });
});

describe('chatFold: stable order (never re-sort a rendered message)', () => {
  const item = (mm: MergedMessage): ChatItem => ({
    id: mm.envelope.msg_id,
    author: mm.envelope.author,
    text: 'x',
    status: 'scrolled',
  });

  it('keeps a just-sent message at the bottom when the canonical read places it earlier', () => {
    // The user sent M after A and B saw it; a later read's canonical order
    // puts M between A and B. The rendered order must not move it - the
    // message stays at the bottom where the user saw it appear.
    const a = env({ id: 'a', payload: { text: 'older' } });
    const b = env({ id: 'b', payload: { text: 'newer' } });
    const m = env({ id: 'm', payload: { text: 'mine' } });
    const pending: ChatItem = { id: 'm', author: m.envelope.author, text: 'mine', status: 'pending' };
    const views: ScrollViews = { ...EMPTY_VIEWS, timeline: [a, m, b] };
    const items = foldViewsToChatItems(views, { previous: [item(a), item(b), pending] });
    expect(items.map((x) => x.id)).toEqual(['a', 'b', 'm']);
    expect(items.find((x) => x.id === 'm')!.status).toBe('scrolled');
  });

  it('never drops an already-rendered message that a partial read omits', () => {
    const a = env({ id: 'a', payload: { text: 'already shown' } });
    const b = env({ id: 'b', payload: { text: 'new' } });
    const views: ScrollViews = { ...EMPTY_VIEWS, timeline: [b] };
    const items = foldViewsToChatItems(views, { previous: [item(a)] });
    expect(items.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('removes a message only when the retraction list says so', () => {
    const a = env({ id: 'a', payload: { text: 'gone' } });
    const views: ScrollViews = {
      ...EMPTY_VIEWS,
      retractions: { retracted: new Map([['a', a.envelope.author]]), dangling: [] },
    };
    expect(foldViewsToChatItems(views, { previous: [item(a)] })).toEqual([]);
  });
});

describe('chatFold: reactions, retraction, dedup', () => {
  it('folds reaction tallies and retraction tombstones', () => {
    const id = 'msg-9';
    const mm = env({ id, payload: { text: 't' } });
    mm.redacted = true;
    const views: ScrollViews = {
      ...EMPTY_VIEWS,
      timeline: [mm],
      reactions: new Map([[id, [{ emoji: '⚡', count: 3, authors: ['a', 'b', 'c'] }]]]),
    };
    const items = foldViewsToChatItems(views);
    expect(items[0]!.retracted).toBe(true);
    expect(items[0]!.reactions).toEqual({ '⚡': 3 });
  });

  it('deduplicates an id appearing in both timeline and thread replies', () => {
    const mm = env({ payload: { text: 'once' } });
    const views: ScrollViews = {
      ...EMPTY_VIEWS,
      timeline: [mm],
      threadIndex: { threads: new Map([[mm.envelope.msg_id, thread(mm, [mm])]]), orphans: [] },
    };
    const items = foldViewsToChatItems(views);
    expect(items.filter((m) => m.id === mm.envelope.msg_id).length).toBe(1);
  });
});

describe('chatFold: (author, msg_id) is the protocol identity', () => {
  // The wire dedup key is (author, msg_id) (envelope.ts dedupKey); two authors
  // may legitimately carry the same 32-hex msg_id. Keying the UI by msg_id
  // alone silently drops one of them (shadowing: anyone can re-use another
  // author's id and hide their message).
  it('renders two authors that reuse the same msg_id', () => {
    const a = env({ id: 'collide', author: 'aaaa', payload: { text: 'from a' } });
    const b = env({ id: 'collide', author: 'bbbb', payload: { text: 'from b' } });
    const views: ScrollViews = { ...EMPTY_VIEWS, timeline: [a, b] };
    const items = foldViewsToChatItems(views);
    expect(items.map((m) => [m.author, m.text])).toEqual([['aaaa', 'from a'], ['bbbb', 'from b']]);
  });

  it('refreshes only the same-author previous item when msg_ids collide', () => {
    const aPrev: ChatItem = { id: 'collide', author: 'aaaa', text: 'a old', status: 'scrolled' };
    const bPrev: ChatItem = { id: 'collide', author: 'bbbb', text: 'b old', status: 'scrolled' };
    const a = env({ id: 'collide', author: 'aaaa', payload: { text: 'a new' } });
    const views: ScrollViews = { ...EMPTY_VIEWS, timeline: [a] };
    const items = foldViewsToChatItems(views, { previous: [aPrev, bPrev] });
    expect(items.map((m) => [m.author, m.text])).toEqual([['aaaa', 'a new'], ['bbbb', 'b old']]);
  });

  it('a retraction removes only the retracting author\'s same-id message', () => {
    const aPrev: ChatItem = { id: 'collide', author: 'aaaa', text: 'a retracted', status: 'scrolled' };
    const bPrev: ChatItem = { id: 'collide', author: 'bbbb', text: 'b kept', status: 'scrolled' };
    const views: ScrollViews = {
      ...EMPTY_VIEWS,
      retractions: { retracted: new Map([['collide', 'aaaa']]), dangling: [] },
    };
    const items = foldViewsToChatItems(views, { previous: [aPrev, bPrev] });
    expect(items.map((m) => [m.author, m.text])).toEqual([['bbbb', 'b kept']]);
  });
});

describe('chatFold: replyTargetOf', () => {
  it('extracts replyTo from payload objects and rejects junk', () => {
    const withReply = env({ payload: { text: 'x', replyTo: 'abc' } });
    expect(replyTargetOf(withReply)).toBe('abc');
    const without = env({ payload: { text: 'x' } });
    expect(replyTargetOf(without)).toBeNull();
    const junk = env({ payload: { replyTo: 42 } });
    expect(replyTargetOf(junk)).toBeNull();
  });
});

describe('chatFold: deep-hunt ordering/removal regressions', () => {
  it('removes a rendered message the redaction list dropped from the views', () => {
    const a = env({ id: 'redacted-1', payload: { text: 'removed by moderator' } });
    const item = { id: 'redacted-1', author: a.envelope.author, text: 'removed by moderator', status: 'scrolled' as const };
    const views: ScrollViews = { ...EMPTY_VIEWS, timeline: [] };
    expect(foldViewsToChatItems(views, { previous: [item], removed: new Set(['redacted-1']) })).toEqual([]);
    // Without the removed set the stable merge keeps it (partial-read safety).
    expect(foldViewsToChatItems(views, { previous: [item] }).map((m) => m.id)).toEqual(['redacted-1']);
  });

  it('does not re-append history the cap already evicted', () => {
    const total = 600;
    const messages = Array.from({ length: total }, (_, i) => env({ id: `m${i}`, payload: { text: `m${i}` } }));
    const views: ScrollViews = { ...EMPTY_VIEWS, timeline: messages };
    const first = foldViewsToChatItems(views);
    expect(first).toHaveLength(500);
    expect(first[0].id).toBe('m100');
    expect(first[first.length - 1].id).toBe('m599');
    // A second fold with the same scroll must not slide the window backwards.
    const second = foldViewsToChatItems(views, { previous: first });
    expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id));
  });
});
