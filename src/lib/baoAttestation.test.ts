import { describe, expect, it } from 'vitest';

import {
  ATTESTATION_QUORUM_PCT,
  BAO_ATTESTATION_BALLOT_KIND,
  BAO_PROOF_OF_WORK_KIND,
  BAO_RESOLUTION_ARTIFACT_KIND,
  attestationActive,
  ballotAddress,
  buildBallotEvent,
  buildObjectionEvent,
  buildProofOfWorkEvent,
  canUserVote,
  formatTimeLeft,
  openRound,
  parseResolutionArtifact,
  quorumPct,
  resolutionKind,
  snapshotWeight,
  tallyPct,
  timeLeft,
  voterBallot,
  type AttestationRound,
  type MilestoneAttestation,
} from './baoAttestation';
import type { NostrEvent } from '@nostrify/nostrify';

const MARKET_ID = 'baofund-fr_abc-0';
const VOTER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const PROOF_ID = 'c'.repeat(64);
const TRIGGER_ID = 'd'.repeat(64);

function round(partial: Partial<AttestationRound>): AttestationRound {
  return {
    id: 'round-1',
    round_no: 1,
    trigger_type: 'objection',
    trigger_event_id: TRIGGER_ID,
    window_open: 1_800_000_000,
    window_close: 1_800_100_000,
    extended: false,
    snapshot: { [VOTER]: 5_000, [OTHER]: 3_000 },
    ring_total_sats: 8_000,
    outcome: null,
    ballots: [],
    tally: { yes_sats: 0, no_sats: 0, cast_sats: 0, ring_total_sats: 8_000, quorum_reached: false, voters: 0 },
    ...partial,
  };
}

function att(partial: Partial<MilestoneAttestation['milestone']>, rounds: AttestationRound[] = []): MilestoneAttestation {
  return {
    milestone: {
      proof_event_id: null,
      proof_submitted_at: null,
      objection_window_close: null,
      attestation_resolution: null,
      attestation_artifact_id: null,
      ...partial,
    },
    rounds,
  };
}

describe('event kinds', () => {
  it('pins the agreed kind numbers', () => {
    expect(BAO_PROOF_OF_WORK_KIND).toBe(37107);
    expect(BAO_ATTESTATION_BALLOT_KIND).toBe(33831);
    expect(BAO_RESOLUTION_ARTIFACT_KIND).toBe(36789);
    expect(ATTESTATION_QUORUM_PCT).toBe(50);
  });
});

describe('buildProofOfWorkEvent', () => {
  it('builds kind 37107 with d-tag = market id, url as r tag, notes as content', () => {
    const t = buildProofOfWorkEvent({ marketId: MARKET_ID, deliverableUrl: ' https://example.com/build ', notes: ' shipped ' });
    expect(t.kind).toBe(37107);
    expect(t.tags).toContainEqual(['d', MARKET_ID]);
    expect(t.tags).toContainEqual(['r', 'https://example.com/build']);
    expect(t.content).toBe('shipped');
  });

  it('omits the r tag and defaults content when no url/notes', () => {
    const t = buildProofOfWorkEvent({ marketId: MARKET_ID });
    expect(t.tags).toEqual([['d', MARKET_ID]]);
    expect(t.content).toBe('');
  });
});

describe('buildObjectionEvent', () => {
  it('is a kind-33831 NO ballot on round 1, e-tagging the proof', () => {
    const t = buildObjectionEvent({ marketId: MARKET_ID, proofEventId: PROOF_ID, reason: ' not delivered ' });
    expect(t.kind).toBe(33831);
    expect(t.tags).toEqual([
      ['d', `${MARKET_ID}:1`],
      ['e', PROOF_ID],
      ['vote', 'no'],
    ]);
    expect(t.content).toBe('not delivered');
  });

  it('omits the e-tag on the timeout path (deadline passed, no proof)', () => {
    const t = buildObjectionEvent({ marketId: MARKET_ID });
    expect(t.tags).toEqual([
      ['d', `${MARKET_ID}:1`],
      ['vote', 'no'],
    ]);
    expect(t.content).toBe('');
  });
});

describe('buildBallotEvent', () => {
  it('builds kind 33831 with d/e/vote tags for the round', () => {
    const t = buildBallotEvent({ marketId: MARKET_ID, roundNo: 2, triggerEventId: TRIGGER_ID, vote: 'yes' });
    expect(t.kind).toBe(33831);
    expect(t.tags).toEqual([
      ['d', `${MARKET_ID}:2`],
      ['e', TRIGGER_ID],
      ['vote', 'yes'],
    ]);
    expect(t.content).toBe('');
  });
});

describe('ballotAddress', () => {
  it('formats the NIP-33 address as kind:pubkey:market_id:round_no', () => {
    expect(ballotAddress(VOTER, MARKET_ID, 1)).toBe(`33831:${VOTER}:${MARKET_ID}:1`);
  });
});

describe('parseResolutionArtifact', () => {
  function ev(kind: number, tags: string[][]): NostrEvent {
    return { id: 'e'.repeat(64), pubkey: 'f'.repeat(64), created_at: 1_800_000_000, kind, tags, content: '', sig: '0'.repeat(128) };
  }

  it('parses rank=100 as YES and rank=0 as NO', () => {
    expect(parseResolutionArtifact(ev(36789, [['d', MARKET_ID], ['rank', '100']]))).toEqual({ marketId: MARKET_ID, outcome: 'yes' });
    expect(parseResolutionArtifact(ev(36789, [['d', MARKET_ID], ['rank', '0']]))).toEqual({ marketId: MARKET_ID, outcome: 'no' });
  });

  it('rejects wrong kinds and malformed tags', () => {
    expect(parseResolutionArtifact(ev(30382, [['d', MARKET_ID], ['rank', '100']]))).toBeNull();
    expect(parseResolutionArtifact(ev(36789, [['rank', '100']]))).toBeNull();
    expect(parseResolutionArtifact(ev(36789, [['d', MARKET_ID], ['rank', '50']]))).toBeNull();
  });
});

describe('timeLeft / formatTimeLeft', () => {
  it('returns ms until close, clamped at zero', () => {
    const now = Date.parse('2026-07-29T12:00:00Z');
    expect(timeLeft('2026-07-29T13:00:00Z', now)).toBe(3_600_000);
    expect(timeLeft('2026-07-29T11:00:00Z', now)).toBe(0);
    expect(timeLeft(null, now)).toBe(0);
  });

  it('accepts unix seconds (legacy API shape)', () => {
    const now = 1_800_000_000_000;
    expect(timeLeft(1_800_000_100, now)).toBe(100_000);
  });

  it('formats durations for countdown labels', () => {
    expect(formatTimeLeft(0)).toBe('closed');
    expect(formatTimeLeft(30_000)).toBe('under a minute');
    expect(formatTimeLeft(47 * 60_000)).toBe('47m');
    expect(formatTimeLeft((4 * 60 + 12) * 60_000)).toBe('4h 12m');
    expect(formatTimeLeft((6 * 24 * 60 + 3 * 60) * 60_000)).toBe('6d 3h');
  });
});

describe('quorumPct / tallyPct', () => {
  it('computes quorum as cast over ring total', () => {
    expect(quorumPct(4_000, 8_000)).toBe(50);
    expect(quorumPct(100, 0)).toBe(0);
    expect(quorumPct(100, Number.NaN)).toBe(0);
  });

  it('splits cast sats into yes/no percentages', () => {
    expect(tallyPct(3, 1)).toEqual({ yes: 75, no: 25 });
    expect(tallyPct(0, 0)).toEqual({ yes: 0, no: 0 });
  });
});

describe('snapshotWeight / canUserVote / voterBallot', () => {
  it('reads weights from the record snapshot shape', () => {
    const snap = { [VOTER]: 5_000 };
    expect(snapshotWeight(snap, VOTER)).toBe(5_000);
    expect(snapshotWeight(snap, OTHER)).toBeNull();
    expect(canUserVote(snap, VOTER)).toBe(true);
    expect(canUserVote(snap, OTHER)).toBe(false);
    expect(canUserVote(snap, undefined)).toBe(false);
  });

  it('reads weights from the array snapshot shape', () => {
    const snap = [{ pubkey: VOTER, weight_sats: 2_500 }];
    expect(snapshotWeight(snap, VOTER)).toBe(2_500);
    expect(snapshotWeight(snap, OTHER)).toBeNull();
  });

  it('treats a legacy string list as membership without weights', () => {
    expect(canUserVote([VOTER], VOTER)).toBe(true);
    expect(snapshotWeight([VOTER], VOTER)).toBe(0);
    expect(canUserVote([VOTER], OTHER)).toBe(false);
  });

  it('handles empty snapshots', () => {
    expect(canUserVote(null, VOTER)).toBe(false);
    expect(canUserVote(undefined, VOTER)).toBe(false);
    expect(canUserVote({}, VOTER)).toBe(false);
  });

  it('finds the voter’s latest ballot in a round', () => {
    const r = round({ ballots: [{ voter_pubkey: VOTER, vote: 'no', weight_sats: 5_000 }] });
    expect(voterBallot(r, VOTER)?.vote).toBe('no');
    expect(voterBallot(r, OTHER)).toBeNull();
    expect(voterBallot(r, undefined)).toBeNull();
  });
});

describe('openRound / attestationActive / resolutionKind', () => {
  it('finds the live round (no outcome yet)', () => {
    const closed = round({ id: 'r1', outcome: 'yes' });
    const live = round({ id: 'r2', round_no: 2 });
    expect(openRound(att({}, [closed, live]))?.id).toBe('r2');
    expect(openRound(att({}, [closed]))).toBeNull();
    expect(openRound(undefined)).toBeNull();
  });

  it('stays active while proof is in or a round exists, until resolved', () => {
    expect(attestationActive(att({ proof_event_id: PROOF_ID }))).toBe(true);
    expect(attestationActive(att({}, [round({})]))).toBe(true);
    expect(attestationActive(att({ proof_event_id: PROOF_ID, attestation_resolution: 'yes' }))).toBe(false);
    expect(attestationActive(att({}))).toBe(false);
    expect(attestationActive(undefined)).toBe(false);
  });

  it('classifies resolution outcomes for badges', () => {
    expect(resolutionKind(att({ attestation_resolution: 'yes' }, [round({ outcome: 'yes' })]))).toBe('yes');
    expect(resolutionKind(att({ attestation_resolution: 'no' }, [round({ outcome: 'no' })]))).toBe('no');
    // YES with no rounds ever run = objection window lapsed quietly.
    expect(resolutionKind(att({ attestation_resolution: 'yes' }))).toBe('default');
    expect(resolutionKind(att({ attestation_resolution: 'default' }))).toBe('default');
    expect(resolutionKind(att({}))).toBeNull();
  });
});
