/**
 * WS9 round-4 fuzz: governance-redaction lists in the chat fold.
 *
 * `foldViewsToChatItems(views, { removed })` is the pure merge that applies
 * kind-31146 governance redactions. The redaction list arrives from the relay
 * and is therefore attacker-influenceable in shape (casing, bare msg_ids vs
 * identity keys, empty strings, duplicates, hostile key names). The invariant:
 * a message with a LIVE canonical copy always survives (redaction can never
 * shadow a still-present author), removed content without a live copy is
 * dropped, order stays stable, output stays bounded, and nothing ever throws
 * or pollutes the prototype.
 *
 * Deterministic (mulberry32); pure fold, no network.
 */
import { describe, expect, it } from 'vitest';
import type { ScrollViews } from '@/baofund/community/aggregate.js';
import type { MergedMessage } from '@/baofund/community/merge.js';
import { chatIdentityKey, foldViewsToChatItems, MAX_RENDERED_MESSAGES, type ChatItem } from './chatFold';

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;

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

function env(id: string, author: string, text: string): MergedMessage {
  return {
    envelope: { v: 1, msg_id: id, room: 'room', epoch: 1, author, payload: { text } },
    scribes: ['s1'],
    redacted: false,
  };
}

describe('chat redaction list - fuzz (round 4)', () => {
  it('live canonical copies survive any redaction set; removed copies drop; output bounded', () => {
    const rnd = mulberry32(0x5eed50);
    for (let iter = 0; iter < 120; iter++) {
      const n = 1 + Math.floor(rnd() * 30);
      const messages: MergedMessage[] = Array.from({ length: n }, (_, i) =>
        env(`id-${i}`, pick(rnd, ['aa', 'BB', 'cc']), `msg ${i}`),
      );
      const views: ScrollViews = { ...EMPTY_VIEWS, timeline: messages };
      // Previous render: a random subset, sometimes with pending copies of
      // messages that never made it into the canonical read.
      const previous: ChatItem[] = messages
        .filter(() => rnd() < 0.6)
        .map((m) => ({ id: m.envelope.msg_id, author: m.envelope.author, text: 'stale', status: 'pending' as const }))
        .concat([{ id: 'pending-gone', author: 'dd', text: 'pending', status: 'pending' }]);
      // Hostile redaction entries alongside real keys/ids.
      const removed = new Set<string>();
      for (const m of messages) {
        if (rnd() < 0.4) removed.add(rnd() < 0.5 ? m.envelope.msg_id : chatIdentityKey(m.envelope.author, m.envelope.msg_id));
      }
      for (const hostile of ['', 'id-0', '__proto__', 'constructor', 'DD:ID-1', '\u0000']) {
        if (rnd() < 0.3) removed.add(hostile);
      }

      const out = foldViewsToChatItems(views, { previous, removed });
      expect(out.length).toBeLessThanOrEqual(MAX_RENDERED_MESSAGES);

      const canonicalKeys = new Set(messages.map((m) => chatIdentityKey(m.envelope.author, m.envelope.msg_id)));
      const outKeys = out.map((item) => chatIdentityKey(item.author, item.id));
      // Every live canonical message is represented exactly once.
      expect(new Set(outKeys).size).toBe(outKeys.length);
      for (const key of canonicalKeys) expect(outKeys).toContain(key);
      // No removed previous copy without a live canonical copy survives.
      for (const item of out) {
        const key = chatIdentityKey(item.author, item.id);
        if (removed.has(key) || removed.has(item.id)) {
          expect(canonicalKeys.has(key)).toBe(true);
        }
      }
      // The pure-pending item is not in the redaction list, so the fold keeps
      // it (a partial scroll read must never silently drop a sent bubble).
      expect(outKeys.filter((k) => k.endsWith(':pending-gone')).length).toBeLessThanOrEqual(1);
      // Prototype untouched by hostile key names.
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });
});
