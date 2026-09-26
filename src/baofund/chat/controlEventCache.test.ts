/**
 * kind-3308 control-event cache bounds (hunt: kind3308-unbounded-fold).
 *
 * Any relay writer can publish a kind-3308 event addressed to a known room
 * id; the client and daemon used to append every delivered event to an
 * unbounded array and re-fold the whole list per event. These tests pin the
 * shared merge: valid-room/epoch-only admission, id dedupe, a hard newest-N
 * bound, and a bounded id set (a flood of unique ids must not grow the set
 * either).
 */
import { describe, expect, it } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import type { NostrEvent } from '@/baofund/community/crypto.js';
import {
  buildRoleEditionEvent,
  isControlEditionForRoom,
  mergeControlEventCache,
  MAX_CONTROL_EVENTS,
} from './roleEditions';
import { buildBanEditionEvent } from './banEditions';

const SK = generateSecretKey();
const ROOM = 'room-a';
const EPOCH = 3;

function roleEdition(overrides: Partial<Parameters<typeof buildRoleEditionEvent>[1]> = {}): NostrEvent {
  return buildRoleEditionEvent(SK, {
    roomId: ROOM,
    epoch: EPOCH,
    roles: [{ id: 'moderator', rank: 1 }],
    perms: [{ roleId: 'moderator', perm: 'ban' }],
    members: [],
    ...overrides,
  });
}

function banEdition(target = 'a'.repeat(64), overrides: Partial<Parameters<typeof buildBanEditionEvent>[1]> = {}): NostrEvent {
  return buildBanEditionEvent(SK, { roomId: ROOM, epoch: EPOCH, target, ...overrides });
}

function fake(id: string): NostrEvent {
  return { id, pubkey: 'b'.repeat(64), kind: 3308, created_at: 0, tags: [], content: '', sig: 'c'.repeat(128) } as NostrEvent;
}

describe('isControlEditionForRoom', () => {
  it('accepts signed role and ban editions for the exact room + epoch', () => {
    expect(isControlEditionForRoom(roleEdition(), ROOM, EPOCH)).toBe(true);
    expect(isControlEditionForRoom(banEdition(), ROOM, EPOCH)).toBe(true);
  });

  it('rejects wrong room, wrong epoch, wrong sub-kind and tampered signatures', () => {
    expect(isControlEditionForRoom(roleEdition(), 'other-room', EPOCH)).toBe(false);
    expect(isControlEditionForRoom(roleEdition(), ROOM, EPOCH + 1)).toBe(false);
    expect(isControlEditionForRoom(fake('1'.repeat(64)), ROOM, EPOCH)).toBe(false);
    // A signed event whose content was mutated after signing is not an authority.
    const signed = roleEdition();
    expect(isControlEditionForRoom({ ...signed, content: 'tampered' }, ROOM, EPOCH)).toBe(false);
  });
});

describe('mergeControlEventCache', () => {
  it('dedupes by id and preserves arrival order', () => {
    const a = fake('a'.repeat(64));
    const b = fake('b'.repeat(64));
    const first = mergeControlEventCache([], new Set(), [a, b]);
    expect(first.events.map((e) => e.id)).toEqual([a.id, b.id]);
    const second = mergeControlEventCache(first.events, first.ids, [a, b]);
    expect(second.events.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(second.ids.size).toBe(2);
  });

  it('skips empty/malformed ids', () => {
    const merged = mergeControlEventCache([], new Set(), [fake(''), fake('ok-1')]);
    expect(merged.events).toHaveLength(1);
  });

  it('keeps only the newest N and rebuilds the id set to match (both bounded)', () => {
    const flood = Array.from({ length: 1000 }, (_, i) => fake(`flood-${i}`));
    const merged = mergeControlEventCache([], new Set(), flood, 10);
    expect(merged.events).toHaveLength(10);
    expect(merged.events[0].id).toBe('flood-990');
    expect(merged.events[9].id).toBe('flood-999');
    // The SET is bounded too - a unique-id flood must not grow it.
    expect(merged.ids.size).toBe(10);
    for (const event of merged.events) expect(merged.ids.has(event.id)).toBe(true);
  });

  it('defaults to the shared MAX_CONTROL_EVENTS bound', () => {
    const flood = Array.from({ length: MAX_CONTROL_EVENTS + 25 }, (_, i) => fake(`bounded-${i}`));
    const merged = mergeControlEventCache([], new Set(), flood);
    expect(merged.events).toHaveLength(MAX_CONTROL_EVENTS);
    expect(merged.ids.size).toBe(MAX_CONTROL_EVENTS);
  });
});
