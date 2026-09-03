import { describe, expect, it } from 'vitest';

import {
  createJoinLink,
  normalizeJoinInput,
  parseJoinLink,
  splitJoinLines,
} from '@/lib/baosocial/join';
import { assertBaoHostedRelay, BAO_HOSTED_RELAY } from '@/lib/baosocial/relayPolicy';

const SECRET = 'a'.repeat(64);
const WELCOMER = 'b'.repeat(64);
const ROUTING = 'c'.repeat(64);

function makeLink(relay = BAO_HOSTED_RELAY): string {
  return createJoinLink('2140.social', SECRET, 'test-room', {
    relay,
    welcomerPub: WELCOMER,
    routingId: ROUTING,
    history: 'fresh',
    v: 2,
    checksum: true,
  });
}

describe('canonical invite transport', () => {
  it('normalizes complete and bare-fragment inputs', () => {
    const link = makeLink();
    expect(normalizeJoinInput(link)).toBe(link);
    expect(parseJoinLink(normalizeJoinInput(link.split('#')[1])).roomId).toBe('test-room');
  });

  it('round-trips checksum-protected split lines', () => {
    const parts = parseJoinLink(makeLink());
    const normalized = normalizeJoinInput(splitJoinLines(parts).join('\n'));
    expect(parseJoinLink(normalized)).toMatchObject({
      roomId: 'test-room',
      relay: BAO_HOSTED_RELAY,
      welcomerPub: WELCOMER,
      routingId: ROUTING,
    });
  });

  it('rejects a corrupted checksum before joining', () => {
    const lines = splitJoinLines(parseJoinLink(makeLink())).join('\n');
    expect(() => normalizeJoinInput(lines.replace(SECRET, 'd'.repeat(64))))
      .toThrow();
  });
});

describe('hosted room relay containment', () => {
  it('accepts only the pinned hosted relay', () => {
    expect(() => assertBaoHostedRelay(parseJoinLink(makeLink()).relay)).not.toThrow();
    expect(() => assertBaoHostedRelay(parseJoinLink(makeLink('wss://relay.ditto.pub')).relay))
      .toThrow('unexpected relay');
    expect(() => assertBaoHostedRelay(undefined)).toThrow('unexpected relay');
  });
});
