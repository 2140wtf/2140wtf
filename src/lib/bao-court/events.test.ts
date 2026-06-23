import { describe, expect, it } from 'vitest';

import {
  BAO_COURT_DISPUTE_KIND,
  BAO_COURT_JUROR_CANDIDACY_KIND,
  BAO_COURT_SELECTION_KIND,
  BAO_COURT_VOTE_COMMIT_KIND,
  BAO_COURT_VOTE_REVEAL_KIND,
  BAO_COURT_FROST_COMMIT_KIND,
  BAO_COURT_FROST_REVEAL_KIND,
  BAO_COURT_ATTESTATION_KIND,
  buildDisputeEvent,
  buildJurorCandidacyEvent,
  buildSelectionEvent,
  buildVoteCommitEvent,
  buildVoteRevealEvent,
  buildFrostCommitEvent,
  buildFrostRevealEvent,
  buildAttestationEvent,
  parseJurorCandidacyEvent,
  parseSelectionEvent,
  parseDkgCommitmentEvent,
  parseVoteCommitEvent,
  parseVoteRevealEvent,
  validateSelectionEvent,
} from './events';
import type { FrostAttestation, JurorProfile } from './types';

describe('BAO Court event builders', () => {
  it('builds a dispute event with kind 38025 and required tags', () => {
    const template = buildDisputeEvent({
      marketId: 'demo-market',
      marketEventId: 'm'.repeat(64),
      disputeId: 'd'.repeat(64),
      originalOutcome: 'YES',
      proposedOutcome: 'NO',
      challengerPubkey: 'c'.repeat(64),
      evidenceHashes: ['e'.repeat(64)],
      disputeDeadline: 1_700_000_000,
    });

    expect(template.kind).toBe(BAO_COURT_DISPUTE_KIND);
    expect(template.tags).toContainEqual(['dispute', 'd'.repeat(64)]);
    expect(template.tags).toContainEqual(['market', 'demo-market']);
    expect(template.tags).toContainEqual(['original', 'YES']);
    expect(template.tags).toContainEqual(['proposed', 'NO']);
    expect(template.tags).toContainEqual(['appeal_type', 'frost']);
    expect(template.tags).toContainEqual(['evidence', 'e'.repeat(64)]);
    expect(JSON.parse(template.content)).toMatchObject({
      marketId: 'demo-market',
      disputeId: 'd'.repeat(64),
      originalOutcome: 'YES',
      proposedOutcome: 'NO',
    });
  });

  it('builds a juror candidacy event with kind 39001', () => {
    const juror: JurorProfile = {
      nostrPubkey: 'a'.repeat(64),
      stakeCapacitySats: 100_000,
      stakeCommitment: {
        amountSats: 10_000,
        bondAddress: 'bc1q...',
        status: 'confirmed',
        committedAt: 1_700_000_000,
      },
      wotScore: 80,
      categories: ['world', 'crypto'],
      registeredAt: 1_700_000_000,
    };

    const template = buildJurorCandidacyEvent({
      disputeId: 'd'.repeat(64),
      marketId: 'demo-market',
      juror,
      bondAmountSats: 10_000,
      bondAddress: 'bc1q...',
    });

    expect(template.kind).toBe(BAO_COURT_JUROR_CANDIDACY_KIND);
    expect(template.tags).toContainEqual(['bond', '10000']);
    expect(template.tags).toContainEqual(['address', 'bc1q...']);
    expect(template.tags).toContainEqual(['t', 'world']);
    expect(template.tags).toContainEqual(['t', 'crypto']);

    const parsed = parseJurorCandidacyEvent({ ...template, pubkey: juror.nostrPubkey, created_at: 1 });
    expect(parsed?.nostrPubkey).toBe(juror.nostrPubkey);
    expect(parsed?.stakeCapacitySats).toBe(100_000);
    expect(parsed?.categories).toEqual(['world', 'crypto']);
  });

  it('builds a selection event with kind 39002', () => {
    const template = buildSelectionEvent({
      disputeId: 'd'.repeat(64),
      marketId: 'demo-market',
      selectedJurors: [{ idx: 1, pubkey: 'a'.repeat(64), stake: 10_000 }],
      backupJurors: [{ idx: 2, pubkey: 'b'.repeat(64), stake: 10_000 }],
      seed: 's'.repeat(64),
      blockHash: 'h'.repeat(64),
    });

    expect(template.kind).toBe(BAO_COURT_SELECTION_KIND);
    expect(template.tags).toContainEqual(['selected', '1', 'a'.repeat(64), '10000']);
    expect(template.tags).toContainEqual(['backup', '2', 'b'.repeat(64), '10000']);

    const parsed = parseSelectionEvent(template);
    expect(parsed?.selected[0]).toEqual({ idx: 1, pubkey: 'a'.repeat(64), stake: 10_000 });
    expect(parsed?.backups[0]).toEqual({ idx: 2, pubkey: 'b'.repeat(64), stake: 10_000 });
  });

  it('distinguishes vote commit and reveal events with kind 39004', () => {
    const commit = buildVoteCommitEvent({
      disputeId: 'd'.repeat(64),
      jurorIdx: 1,
      commitHash: 'c'.repeat(64),
    });
    const reveal = buildVoteRevealEvent({
      disputeId: 'd'.repeat(64),
      jurorIdx: 1,
      outcome: 'YES',
      salt: 's'.repeat(64),
    });

    expect(commit.kind).toBe(BAO_COURT_VOTE_COMMIT_KIND);
    expect(reveal.kind).toBe(BAO_COURT_VOTE_REVEAL_KIND);
    expect(commit.tags).toContainEqual(['commit', 'c'.repeat(64)]);
    expect(reveal.tags).toContainEqual(['outcome', 'YES']);
    expect(reveal.tags).toContainEqual(['salt', 's'.repeat(64)]);

    const parsedCommit = parseVoteCommitEvent({ ...commit, pubkey: 'a'.repeat(64) });
    const parsedReveal = parseVoteRevealEvent({ ...reveal, pubkey: 'a'.repeat(64) });
    expect(parsedCommit?.commitHash).toBe('c'.repeat(64));
    expect(parsedReveal?.outcome).toBe('YES');
    expect(parsedReveal?.salt).toBe('s'.repeat(64));
  });

  it('builds a FROST commitment and reveal event', () => {
    const commit = buildFrostCommitEvent({
      disputeId: 'd'.repeat(64),
      jurorIdx: 1,
      commitmentPackage: { idx: 1, binder_pn: 'b'.repeat(64), hidden_pn: 'h'.repeat(64) },
    });
    const reveal = buildFrostRevealEvent({
      disputeId: 'd'.repeat(64),
      jurorIdx: 1,
      publicNonce: { idx: 1, binder_pn: 'b'.repeat(64), hidden_pn: 'h'.repeat(64) },
      partialSig: 'p'.repeat(128),
    });

    expect(commit.kind).toBe(BAO_COURT_FROST_COMMIT_KIND);
    expect(reveal.kind).toBe(BAO_COURT_FROST_REVEAL_KIND);
    expect(commit.tags).toContainEqual(['binder_pn', 'b'.repeat(64)]);
    expect(reveal.tags).toContainEqual(['psig', 'p'.repeat(128)]);
  });

  it('builds an attestation event using the attestation kind', () => {
    const attestation: FrostAttestation = {
      marketId: 'demo-market',
      outcome: 'YES',
      signature: 's'.repeat(128),
      pubNonce: 'n'.repeat(64),
      groupPubkey: 'g'.repeat(64),
      message: 'm'.repeat(64),
      kind: 39007,
      disputeEventId: 'd'.repeat(64),
    };

    const template = buildAttestationEvent({ attestation, marketEventId: 'e'.repeat(64) });
    expect(template.kind).toBe(BAO_COURT_ATTESTATION_KIND);
    expect(template.tags).toContainEqual(['p', 'g'.repeat(64)]);
    expect(template.tags).toContainEqual(['outcome', 'YES']);
    expect(template.tags).toContainEqual(['sig', 's'.repeat(128)]);
    expect(template.tags).toContainEqual(['dispute', 'd'.repeat(64)]);
  });

  it('parsers return null for malformed events', () => {
    expect(parseJurorCandidacyEvent({ kind: 1, pubkey: 'a'.repeat(64), tags: [], content: '', created_at: 0 })).toBeNull();
    expect(parseSelectionEvent({ kind: 1, tags: [], content: '' })).toBeNull();
    expect(parseDkgCommitmentEvent({ kind: 1, pubkey: 'a'.repeat(64), tags: [], content: '' })).toBeNull();
    expect(parseVoteCommitEvent({ kind: 1, pubkey: 'a'.repeat(64), tags: [], content: '' })).toBeNull();
    expect(parseVoteRevealEvent({ kind: 1, pubkey: 'a'.repeat(64), tags: [], content: '' })).toBeNull();
  });

  it('validates selection events', () => {
    const valid = buildSelectionEvent({
      disputeId: 'd'.repeat(64),
      marketId: 'demo-market',
      selectedJurors: [{ idx: 1, pubkey: 'a'.repeat(64), stake: 10_000 }],
      backupJurors: [],
      seed: 's'.repeat(64),
      blockHash: 'h'.repeat(64),
    });

    expect(validateSelectionEvent(valid, 'd'.repeat(64)).valid).toBe(true);
    expect(validateSelectionEvent(valid, 'x'.repeat(64)).valid).toBe(false);

    const noSelected = {
      ...valid,
      tags: valid.tags.filter((t) => t[0] !== 'selected'),
    };
    expect(validateSelectionEvent(noSelected).valid).toBe(false);

    const duplicateIdx = buildSelectionEvent({
      disputeId: 'd'.repeat(64),
      marketId: 'demo-market',
      selectedJurors: [{ idx: 1, pubkey: 'a'.repeat(64), stake: 10_000 }],
      backupJurors: [{ idx: 1, pubkey: 'b'.repeat(64), stake: 10_000 }],
      seed: 's'.repeat(64),
      blockHash: 'h'.repeat(64),
    });
    expect(validateSelectionEvent(duplicateIdx).valid).toBe(false);

    const badPubkey = buildSelectionEvent({
      disputeId: 'd'.repeat(64),
      marketId: 'demo-market',
      selectedJurors: [{ idx: 1, pubkey: 'not-hex', stake: 10_000 }],
      backupJurors: [],
      seed: 's'.repeat(64),
      blockHash: 'h'.repeat(64),
    });
    expect(validateSelectionEvent(badPubkey).valid).toBe(false);
  });
});
