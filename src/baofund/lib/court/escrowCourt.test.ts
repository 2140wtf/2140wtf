// src/lib/court/escrowCourt.test.ts
//
// End-to-end adapter tests: real FROST ceremonies (via the vendored court)
// drive the escrow-dispute verification the operator will rely on.

import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  buildDisputeAttestationEvent,
  deriveSimulatedRevealEventId,
  generateFrostKeys,
  hashCommit,
  hashDisputeVerdict,
  runDisputeOverrideSigning,
  type DisputeCase,
  type JurorVote,
  type SelectedJuror,
} from '@/baofund/court-core';
import {
  ESCROW_MARKET_PREFIX,
  buildEscrowDisputeCase,
  escrowCourtCanResolveInTime,
  escrowCourtTotalPhaseSeconds,
  escrowMarketId,
  escrowOutcomeForWinner,
  tallyEscrowJurorVotes,
  verifyEscrowCourtAttestation,
} from './escrowCourt';
import {
  MULTISIG_REFUND_PERIOD_SECONDS,
  OPERATOR_SIGN_MIN_LOCKTIME_MARGIN_SECONDS,
} from '../cashu/escrowMultisig';

const partyA = getPublicKey(generateSecretKey());
const partyB = getPublicKey(generateSecretKey());
const outsider = getPublicKey(generateSecretKey());

function makeJuror(idx: number): SelectedJuror {
  return {
    idx,
    nostrPubkey: '0'.repeat(63) + String(idx),
    stakeCapacitySats: 10_000,
    stakeCommitment: { amountSats: 10_000, bondAddress: 'bc1q...', status: 'confirmed' },
    wotScore: 80,
    categories: ['escrow'],
    registeredAt: 1_700_000_000,
    priority: idx,
  };
}

function dispute(): DisputeCase {
  return {
    ...buildEscrowDisputeCase({
      escrowId: 'battle-abc123',
      challengerPubkey: partyA,
      respondentPubkey: partyB,
      proposedWinnerPubkey: partyA,
      evidenceHashes: ['f'.repeat(64)],
    }),
    disputeId: 'd'.repeat(64),
  };
}

describe('escrowMarketId', () => {
  it('namespaces escrow ids into the court market space', () => {
    expect(escrowMarketId('battle-1')).toBe(`${ESCROW_MARKET_PREFIX}battle-1`);
  });
  it('rejects empty ids', () => {
    expect(() => escrowMarketId('  ')).toThrow();
  });
});

describe('buildEscrowDisputeCase', () => {
  it('normalizes keys and sets the winner as proposed outcome', () => {
    const d = buildEscrowDisputeCase({
      escrowId: 'b1',
      challengerPubkey: '02' + partyA, // compressed form accepted
      respondentPubkey: partyB.toUpperCase(), // case-insensitive
      proposedWinnerPubkey: partyB,
    });
    expect(d.challengerPubkey).toBe(partyA);
    expect(d.respondentPubkey).toBe(partyB);
    expect(d.proposedOutcome).toBe(partyB);
    expect(d.marketId).toBe(escrowMarketId('b1'));
  });
  it('rejects a proposed winner who is not a party', () => {
    expect(() =>
      buildEscrowDisputeCase({
        escrowId: 'b1',
        challengerPubkey: partyA,
        respondentPubkey: partyB,
        proposedWinnerPubkey: outsider,
      }),
    ).toThrow(/one of the two/);
  });
  it('rejects identical parties', () => {
    expect(() =>
      buildEscrowDisputeCase({
        escrowId: 'b1',
        challengerPubkey: partyA,
        respondentPubkey: partyA,
        proposedWinnerPubkey: partyA,
      }),
    ).toThrow(/distinct/);
  });
});

describe('ESCROW_DISPUTE_APPEAL_TIMINGS', () => {
  it('fits inside the escrow refund locktime minus the operator margin', () => {
    const budget = MULTISIG_REFUND_PERIOD_SECONDS - OPERATOR_SIGN_MIN_LOCKTIME_MARGIN_SECONDS;
    expect(escrowCourtTotalPhaseSeconds()).toBeLessThanOrEqual(budget);
    expect(escrowCourtCanResolveInTime(0)).toBe(true);
  });
  it('refuses when the remaining locktime cannot fit a court cycle', () => {
    const budget = MULTISIG_REFUND_PERIOD_SECONDS - OPERATOR_SIGN_MIN_LOCKTIME_MARGIN_SECONDS;
    expect(escrowCourtCanResolveInTime(budget)).toBe(false);
  });
});

describe('tallyEscrowJurorVotes', () => {
  function vote(idx: number, outcome: string): JurorVote {
    const salt = `salt-${idx}`;
    return { idx, pubkey: '0'.repeat(63) + String(idx), commit: hashCommit(outcome, salt), reveal: { outcome, salt } };
  }
  it('returns the majority party as winner', () => {
    const votes = [vote(1, partyA), vote(2, partyB), vote(3, partyB)];
    expect(tallyEscrowJurorVotes(votes, partyA, partyB).winnerPubkey).toBe(partyB);
  });
  it('rejects a market-style outcome that pays nobody', () => {
    const votes = [vote(1, 'YES'), vote(2, 'YES')];
    expect(() => tallyEscrowJurorVotes(votes, partyA, partyB)).toThrow(/escrow party/);
  });
  it('excludes commit-reveal mismatches as slashing evidence, never aborts', () => {
    const bad: JurorVote = { idx: 1, pubkey: 'p', commit: hashCommit(partyA, 'x'), reveal: { outcome: partyB, salt: 'x' } };
    const good: JurorVote = { idx: 2, pubkey: 'q', commit: hashCommit(partyA, 'y'), reveal: { outcome: partyA, salt: 'y' } };
    const tally = tallyEscrowJurorVotes([bad, good], partyA, partyB);
    expect(tally.winnerPubkey).toBe(partyA);
    expect(tally.invalidReveals).toHaveLength(1);
    expect(tally.supportingVotes).toHaveLength(1);
  });
  it('throws when only invalid reveals remain', () => {
    const bad: JurorVote = { idx: 1, pubkey: 'p', commit: hashCommit(partyA, 'x'), reveal: { outcome: partyB, salt: 'x' } };
    expect(() => tallyEscrowJurorVotes([bad], partyA, partyB)).toThrow(/escrow party/);
  });
});

describe('verifyEscrowCourtAttestation', () => {
  const jurors = [makeJuror(1), makeJuror(2), makeJuror(3)];
  const d = dispute();
  const { record, shares } = generateFrostKeys({
    marketId: d.marketId,
    disputeId: d.disputeId,
    threshold: 2,
    jurors,
  });
  const publisherSecret = generateSecretKey();
  const publisher = getPublicKey(publisherSecret);

  function signedAttestation(outcome: string, disputeId = d.disputeId, dkg = record, shr = shares) {
    // v0.5.x wire format: the FROST signature certifies the TALLY, so the
    // attestation must bind a verdict commitment recomputable from the
    // published supporting reveal event ids (validator.ts recomputes it).
    const supportingEventIds = [1, 2, 3].map((idx) =>
      deriveSimulatedRevealEventId(idx, outcome, `salt-${idx}`),
    );
    const verdictHash = hashDisputeVerdict({
      disputeId: disputeId.toLowerCase(),
      outcome,
      supportingEventIds,
    });
    const attestation = runDisputeOverrideSigning({
      dispute: { ...d, disputeId, proposedOutcome: outcome },
      dkg,
      shares: shr,
      verdictHash,
      supportingEventIds,
    });
    return finalizeEvent(
      buildDisputeAttestationEvent({ attestation, marketEventId: 'e'.repeat(64) }),
      publisherSecret,
    );
  }

  const ctx = {
    dispute: d,
    partyAPubkey: partyA,
    partyBPubkey: partyB,
    courtGroupPubkey: record.groupPubkeyXOnly,
    trustedPublisherPubkeys: [publisher],
  };

  it('accepts a valid court verdict and extracts the winner', () => {
    const event = signedAttestation(partyA);
    const res = verifyEscrowCourtAttestation(event, ctx);
    expect(res.error).toBeUndefined();
    expect(res.valid).toBe(true);
    expect(res.winnerPubkey).toBe(partyA);
  });

  it('accepts a verdict for the other party too (court decides, not the operator)', () => {
    const event = signedAttestation(partyB);
    expect(verifyEscrowCourtAttestation(event, ctx).winnerPubkey).toBe(partyB);
  });

  it('rejects a kind-89 repackage of a dispute attestation (release gate requires kind 39007)', () => {
    // Kind 89 is the weaker market-attestation branch (no verdict-tally
    // requirement). Re-signing the same FROST-bearing event as kind 89 must
    // NOT authorize an escrow payout.
    const native = signedAttestation(partyA);
    const laundered = finalizeEvent({ ...native, kind: 89 }, publisherSecret);
    const res = verifyEscrowCourtAttestation(laundered, ctx);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('kind-39007');
  });

  it('rejects a verdict bound to a different dispute', () => {
    const other = generateFrostKeys({
      marketId: d.marketId,
      disputeId: 'c'.repeat(64),
      threshold: 2,
      jurors,
    });
    const event = signedAttestation(partyA, 'c'.repeat(64), other.record, other.shares);
    const res = verifyEscrowCourtAttestation(event, {
      ...ctx,
      courtGroupPubkey: other.record.groupPubkeyXOnly,
    });
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/[Dd]ispute/);
  });

  it('rejects a verdict from the wrong jury', () => {
    const event = signedAttestation(partyA);
    const res = verifyEscrowCourtAttestation(event, {
      ...ctx,
      // Any group key other than the empaneled jury's must fail. (The old
      // fixture used the dispute-derived key - publicly computable, so a
      // forgery magnet; the helper was removed on purpose.)
      courtGroupPubkey: 'a'.repeat(64),
    });
    expect(res.valid).toBe(false);
  });

  it('refuses to verify when the dispute case has no dispute event id', () => {
    const event = signedAttestation(partyA);
    const res = verifyEscrowCourtAttestation(event, {
      ...ctx,
      dispute: { ...d, disputeId: '' },
    });
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/dispute event id/i);
  });

  it('rejects an untrusted publisher', () => {
    const event = signedAttestation(partyA);
    const res = verifyEscrowCourtAttestation(event, {
      ...ctx,
      trustedPublisherPubkeys: [outsider],
    });
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/publisher/);
  });

  it('rejects when the outcome tag is swapped to an outsider', () => {
    const event = signedAttestation(partyA);
    const tampered = {
      ...event,
      tags: event.tags.map((t) => (t[0] === 'outcome' ? ['outcome', outsider] : t)),
    };
    const res = verifyEscrowCourtAttestation(tampered, ctx);
    expect(res.valid).toBe(false);
  });
});

describe('escrowOutcomeForWinner', () => {
  it('normalizes to x-only and rejects garbage', () => {
    expect(escrowOutcomeForWinner('02' + partyA)).toBe(partyA);
    expect(() => escrowOutcomeForWinner('not-a-key')).toThrow();
  });
});
