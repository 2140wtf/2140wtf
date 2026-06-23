import { describe, expect, it } from 'vitest';

import { generateFrostKeys } from './dkg';
import { runNormalSigningRound, createCommitments, createRevealsAndPartialSigs, aggregateAttestation } from './signing';
import { buildAttestationMessage, verifyFinalSignature } from './crypto';
import type { SelectedJuror } from './types';

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

describe('FROST signing', () => {
  const jurors = [makeJuror(1), makeJuror(2), makeJuror(3)];
  const { record, shares } = generateFrostKeys({
    marketId: 'demo-market',
    disputeId: 'a'.repeat(64),
    threshold: 2,
    jurors,
  });

  it('runs a full normal signing round', () => {
    const attestation = runNormalSigningRound({
      marketId: 'demo-market',
      outcome: 'YES',
      round: 1,
      dkg: record,
      shares,
    });

    expect(attestation.kind).toBe(89);
    expect(attestation.marketId).toBe('demo-market');
    expect(attestation.outcome).toBe('YES');
    expect(attestation.groupPubkey).toBe(record.groupPubkeyXOnly);
    expect(attestation.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(attestation.pubNonce).toMatch(/^[0-9a-f]{64}$/);

    const valid = verifyFinalSignature(record.groupPubkey, attestation.message, attestation.signature);
    expect(valid).toBe(true);
  });

  it('creates fresh commitments per round', () => {
    const commitsA = createCommitments(shares);
    const commitsB = createCommitments(shares);
    for (let i = 0; i < shares.length; i++) {
      expect(commitsA[i].commit.binder_pn).not.toBe(commitsB[i].commit.binder_pn);
      expect(commitsA[i].commit.hidden_pn).not.toBe(commitsB[i].commit.hidden_pn);
    }
  });

  it('detects a corrupt partial signature', () => {
    const params = {
      marketId: 'demo-market',
      outcome: 'NO',
      round: 1,
      dkg: record,
      shares,
    };
    const commitments = createCommitments(shares);
    const reveals = createRevealsAndPartialSigs(params, commitments);

    // Corrupt the first partial signature.
    const corruptReveals = [
      { ...reveals[0], psig: '0'.repeat(reveals[0].psig.length) },
      ...reveals.slice(1),
    ];

    expect(() => aggregateAttestation(params, commitments, corruptReveals)).toThrow();
  });

  it('uses the dispute event id when provided', () => {
    const attestation = runNormalSigningRound({
      marketId: 'demo-market',
      outcome: 'YES',
      round: 1,
      disputeEventId: 'b'.repeat(64),
      dkg: record,
      shares,
    });

    const message = buildAttestationMessage('demo-market', 'YES', 1, 'b'.repeat(64));
    expect(attestation.message).toBe(message);
    expect(verifyFinalSignature(record.groupPubkey, message, attestation.signature)).toBe(true);
  });
});
