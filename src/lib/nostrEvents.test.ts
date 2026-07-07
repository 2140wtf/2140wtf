import { describe, expect, it } from 'vitest';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';

import { isVerifiedEvent, isVerifiedOwnEvent } from './nostrEvents';

const sk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
const pubkey = getPublicKey(sk);
const otherSk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
const _otherPubkey = getPublicKey(otherSk);

function createEvent(overrides?: Parameters<typeof finalizeEvent>[0]): ReturnType<typeof finalizeEvent> {
  return finalizeEvent(
    {
      kind: 1,
      created_at: 1000,
      tags: [],
      content: 'hello',
      ...overrides,
    },
    sk,
  );
}

describe('isVerifiedEvent', () => {
  it('returns true for a valid event', () => {
    expect(isVerifiedEvent(createEvent())).toBe(true);
  });

  it('returns false for an event with a tampered signature', () => {
    const event = JSON.parse(JSON.stringify(createEvent())) as ReturnType<typeof createEvent>;
    event.sig = event.sig.slice(0, -1) + (event.sig.slice(-1) === '0' ? '1' : '0');
    expect(isVerifiedEvent(event)).toBe(false);
  });

  it('returns false for an event with a tampered id', () => {
    const event = JSON.parse(JSON.stringify(createEvent())) as ReturnType<typeof createEvent>;
    event.id = event.id.slice(0, -1) + (event.id.slice(-1) === '0' ? '1' : '0');
    expect(isVerifiedEvent(event)).toBe(false);
  });
});

describe('isVerifiedOwnEvent', () => {
  it('returns true when the event is valid and authored by the expected pubkey', () => {
    expect(isVerifiedOwnEvent(createEvent(), pubkey)).toBe(true);
  });

  it('returns false when the event is authored by a different pubkey', () => {
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: 1000,
        tags: [],
        content: 'hello',
      },
      otherSk,
    );
    expect(isVerifiedOwnEvent(event, pubkey)).toBe(false);
  });

  it('returns false for an event with an invalid signature', () => {
    const event = JSON.parse(JSON.stringify(createEvent())) as ReturnType<typeof createEvent>;
    event.sig = event.sig.slice(0, -1) + (event.sig.slice(-1) === '0' ? '1' : '0');
    expect(isVerifiedOwnEvent(event, pubkey)).toBe(false);
  });
});
