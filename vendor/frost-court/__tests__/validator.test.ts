import { describe, expect, it } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { validateAttestationEvent, verifyRawSignature } from '../validator';
import { BAO_COURT_ATTESTATION_KIND } from '../events';
import { generateFrostKeys } from '../dkg';
import { runNormalSigningRound } from '../signing';
import type { SelectedJuror } from '../types';

function makeJuror(idx: number): SelectedJuror {
  return {
    idx,
    nostrPubkey: '0'.repeat(63) + String(idx),
    stakeCapacitySats: 10_000,
    stakeCommitment: {
      amountSats: 10_000,
      bondAddress: 'bc1q...',
      status: 'confirmed',
      committedAt: 1_700_000_000,
    },
    wotScore: 80,
    categories: ['world'],
    registeredAt: 1_700_000_000,
    priority: idx,
  };
}

describe('validateAttestationEvent', () => {
  const jurors = [makeJuror(1), makeJuror(2), makeJuror(3)];
  const { record, shares } = generateFrostKeys({
    marketId: 'demo-market',
    disputeId: 'a'.repeat(64),
    threshold: 2,
    jurors,
  });

  function buildValidEvent() {
    const attestation = runNormalSigningRound({
      marketId: 'demo-market',
      outcome: 'YES',
      round: 1,
      disputeEventId: 'd'.repeat(64),
      dkg: record,
      shares,
    });

    return {
      kind: BAO_COURT_ATTESTATION_KIND,
      id: 'e'.repeat(64),
      pubkey: 'p'.repeat(64),
      created_at: 1,
      sig: 'x'.repeat(128),
      tags: [
        ['e', 'm'.repeat(64), '', 'root'],
        ['m', 'demo-market'],
        ['p', attestation.groupPubkey],
        ['outcome', attestation.outcome],
        ['nonce', attestation.pubNonce],
        ['sig', attestation.signature],
        ['ver', 'FROST-BIP340-v1'],
        ['dispute', 'd'.repeat(64)],
      ],
      content: JSON.stringify({
        marketId: 'demo-market',
        outcome: 'YES',
        message: attestation.message,
        disputeEventId: 'd'.repeat(64),
      }),
    };
  }

  it('accepts a valid FROST attestation event', () => {
    const event = buildValidEvent();
    const result = validateAttestationEvent(event);
    expect(result.valid).toBe(true);
    expect(result.outcome).toBe('YES');
  });

  it('rejects events with the wrong kind', () => {
    const event = { ...buildValidEvent(), kind: 1 };
    expect(validateAttestationEvent(event).valid).toBe(false);
  });

  it('rejects events with an invalid group pubkey', () => {
    const event = buildValidEvent();
    event.tags = event.tags.map((t) => (t[0] === 'p' ? ['p', 'bad'] : t));
    expect(validateAttestationEvent(event).valid).toBe(false);
  });

  it('rejects a signature that does not verify', () => {
    const event = buildValidEvent();
    const sigTag = event.tags.find((t) => t[0] === 'sig');
    if (sigTag) sigTag[1] = '0'.repeat(128);
    expect(validateAttestationEvent(event).valid).toBe(false);
  });

  it('validates against an expected group pubkey', () => {
    const event = buildValidEvent();
    const attestation = runNormalSigningRound({
      marketId: 'demo-market',
      outcome: 'YES',
      round: 1,
      disputeEventId: 'd'.repeat(64),
      dkg: record,
      shares,
    });

    expect(validateAttestationEvent(event, attestation.groupPubkey).valid).toBe(true);
    expect(validateAttestationEvent(event, '0'.repeat(64)).valid).toBe(false);
  });

  it('verifyRawSignature verifies a plain schnorr signature', () => {
    const message = sha256(new TextEncoder().encode('hello'));
    const messageHex = bytesToHex(message);
    const seckey = hexToBytes('0'.repeat(63) + '1');
    const pubkey = bytesToHex(schnorr.getPublicKey(seckey));
    const signature = bytesToHex(schnorr.sign(message, seckey));

    expect(verifyRawSignature(pubkey, messageHex, signature)).toBe(true);
    expect(verifyRawSignature(pubkey, messageHex, '0'.repeat(128))).toBe(false);
  });
});
