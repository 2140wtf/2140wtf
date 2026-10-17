// dmCallLane: the raw extras contract. The strict community parser validates
// the known fields and DROPS unknown extras by design; the call layer reads
// epk/nonce from the RAW payload, so this module re-validates them itself.

import { describe, expect, it } from 'vitest';
import { newDmCallEphemeral, newDmCallOffer } from '@/baofund/community/dmCallKeys.js';
import { parseCallSignal } from '@/baofund/community/dmSignaling.js';
import {
  DM_CALL_SIGNAL_TTL_SEC,
  buildDmCallAcceptPayload,
  buildDmCallOfferPayload,
  buildDmCallPayload,
  readDmCallExtras,
} from './dmCallLane';

const CALL_ID = 'ab'.repeat(16);
const NONCE = 'cd'.repeat(16);

describe('dmCallLane', () => {
  it('builds the schema fields + extras and the strict parser drops the extras', () => {
    const keys = newDmCallOffer();
    const payload = buildDmCallOfferPayload('offer', CALL_ID, keys, { rn: CALL_ID, nowSec: () => 1_700_000_000 });
    expect(payload).toMatchObject({
      v: 1,
      t: 'bao-call-v1',
      op: 'offer',
      callId: CALL_ID,
      iat: 1_700_000_000,
      exp: 1_700_000_000 + DM_CALL_SIGNAL_TTL_SEC,
      rn: CALL_ID,
      epk: keys.ephemeral.pubHex,
      nonce: keys.callNonceHex,
    });
    const parsed = parseCallSignal(payload);
    expect(parsed).toBeTruthy();
    expect(Object.keys(parsed as object).sort()).toEqual(['callId', 'exp', 'iat', 'op', 'rn', 't', 'v']);
    expect(readDmCallExtras(payload)).toEqual({ epk: keys.ephemeral.pubHex, nonce: keys.callNonceHex });
  });

  it('accept payloads echo the offer nonce and carry the responder ephemeral', () => {
    const ephemeral = newDmCallEphemeral();
    const payload = buildDmCallAcceptPayload(CALL_ID, NONCE, ephemeral, { rn: CALL_ID, nowSec: () => 1_700_000_000 });
    expect(payload).toMatchObject({ op: 'accept', callId: CALL_ID, nonce: NONCE, epk: ephemeral.pubHex });
    expect(parseCallSignal(payload)?.op).toBe('accept');
  });

  it('readDmCallExtras is strict and never throws', () => {
    for (const hostile of [null, 'x', 42, [], {}, { epk: 'UPPER'.repeat(16) }, { epk: 'zz'.repeat(32), nonce: 'ZZ'.repeat(16) }]) {
      expect(readDmCallExtras(hostile)).toEqual({ epk: null, nonce: null });
    }
    // Per-field strictness: a valid epk with a malformed nonce is NOT nulled together.
    expect(readDmCallExtras({ epk: 'ab'.repeat(32), nonce: 'zz'.repeat(16) })).toEqual({ epk: 'ab'.repeat(32), nonce: null });
    expect(readDmCallExtras({ epk: 'ab'.repeat(32), nonce: 'cd'.repeat(16) })).toEqual({ epk: 'ab'.repeat(32), nonce: 'cd'.repeat(16) });
  });

  it('builders refuse malformed own inputs loudly', () => {
    expect(() => buildDmCallPayload({ op: 'offer', callId: 'junk' })).toThrow();
    expect(() => buildDmCallPayload({ op: 'offer', callId: CALL_ID, ttlSec: 0 })).toThrow();
    // TTL is capped at the schema's 1 h bound.
    expect(() => buildDmCallPayload({ op: 'end', callId: CALL_ID, ttlSec: 4000 })).toThrow();
  });
});
