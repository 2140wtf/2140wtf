// dkgConsole.test.ts — the S7 operator console fold (design §S7).
//
// Fixtures are REAL builders (buildDkgCommitmentEvent / buildEncryptedShareEvent
// / buildDkgComplaintEvent templates finalized by per-juror keys) so the fold
// and the jurors' own sessions accept byte-identical events.
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  buildDkgCommitmentEvent,
  buildSelectionEvent,
} from '@/baofund/court-core/events';
import {
  buildEncryptedShareEvent,
  buildDkgComplaintEvent,
} from '@/baofund/court-core/dkgMessages';
type CommitmentParams = Parameters<typeof buildDkgCommitmentEvent>[0];
import type { EncryptedVssShare, DkgComplaint } from '@/baofund/court-core/types';
import { foldDkgConsole } from './dkgConsole';
import type { CourtEvent } from './disputeStatus';
import { escrowMarketId } from './escrowCourt';

const ESCROW_ID = 'escrow-dkg-1';
const OPENED_AT = 1_700_000_000;
// dispute(2h) + opt-in(3h) + selection(1h) → dkg starts +6h, ends +10h.
const DKG_START = OPENED_AT + 6 * 3600;
const DKG_DEADLINE = OPENED_AT + 10 * 3600;

const partySk = generateSecretKey();
const party = getPublicKey(partySk);

const j1Sk = generateSecretKey();
const j2Sk = generateSecretKey();
const j3Sk = generateSecretKey();
const J1 = getPublicKey(j1Sk);
const J2 = getPublicKey(j2Sk);
const J3 = getPublicKey(j3Sk);

const SEED = 'a'.repeat(64);

function court(e: ReturnType<typeof finalizeEvent>): CourtEvent {
  return e as unknown as CourtEvent;
}

/** Real, signed kind-38025 dispute. Its EVENT ID is the ceremony key — the
 *  fold derives it, so every fixture builder takes it as a parameter. */
function disputeEvent(): CourtEvent {
  return court(finalizeEvent(
    {
      kind: 38025,
      created_at: OPENED_AT,
      tags: [['market', escrowMarketId(ESCROW_ID)]],
      content: JSON.stringify({ marketId: escrowMarketId(ESCROW_ID) }),
    },
    partySk,
  ));
}

const DISPUTE = disputeEvent();
const DISPUTE_ID = DISPUTE.id;

function selectionEvent(disputeId = DISPUTE_ID): CourtEvent {
  const t = buildSelectionEvent({
    disputeId,
    marketId: escrowMarketId(ESCROW_ID),
    selectedJurors: [
      { idx: 1, pubkey: J1, stake: 100 },
      { idx: 2, pubkey: J2, stake: 100 },
      { idx: 3, pubkey: J3, stake: 100 },
    ],
    backupJurors: [],
    seed: SEED,
    blockHash: 'b'.repeat(64),
    publisherPubkey: party,
  });
  return court(finalizeEvent({ ...t, created_at: DKG_START - 60 }, partySk));
}

function commitment(sk: Uint8Array, idx: number, at: number, disputeId = DISPUTE_ID): CourtEvent {
  const params: CommitmentParams = {
    disputeId,
    jurorIdx: idx,
    jurorPubkey: getPublicKey(sk),
    threshold: 2,
    phaseNonce: `nonce-${idx}`,
    pok: { nonce: 'n'.repeat(64), response: 'r'.repeat(64) },
    vssCommits: ['c'.repeat(66)],
  };
  return court(finalizeEvent({ ...buildDkgCommitmentEvent(params), created_at: at }, sk));
}

function share(fromSk: Uint8Array, fromIdx: number, toIdx: number, toPubkey: string, at: number, disputeId = DISPUTE_ID): CourtEvent {
  const payload: EncryptedVssShare = {
    disputeId,
    fromIdx,
    fromPubkey: getPublicKey(fromSk),
    toIdx,
    toPubkey,
    encryptedShare: 'e'.repeat(128),
    ephemeralPubkey: 'e'.repeat(66),
    phaseNonce: `nonce-${fromIdx}`,
  };
  return court(finalizeEvent({ ...buildEncryptedShareEvent(payload), created_at: at }, fromSk));
}

function complaint(victimSk: Uint8Array, victimIdx: number, accusedIdx: number, accusedPubkey: string, at: number, defense = false, disputeId = DISPUTE_ID): CourtEvent {
  const c: DkgComplaint = {
    disputeId,
    victimIdx,
    victimPubkey: getPublicKey(victimSk),
    accusedIdx,
    accusedPubkey,
    encryptedShareEventId: 'a'.repeat(64),
    revealedShare: 'b'.repeat(64),
    commitmentEventId: 'c'.repeat(64),
    ...(defense ? { defense: { decryptionProof: 'p'.repeat(64), validShare: 'w'.repeat(64), defendedAt: at } } : {}),
  };
  return court(finalizeEvent({ ...buildDkgComplaintEvent(c), created_at: at }, victimSk));
}

const NOW = DKG_START + 120;

describe('foldDkgConsole — honesty before ceremony data exists', () => {
  it('reports no_dispute (found:false) without a bound 38025', () => {
    const v = foldDkgConsole({ escrowId: ESCROW_ID, disputeEvent: null, selectionEvent: null, ceremonyEvents: [], nowSeconds: NOW });
    expect(v.found).toBe(false);
    expect(v.phase).toBe('no_dispute');
    expect(v.disputeId).toBeNull();
    expect(v.roster).toEqual([]);
  });

  it('reports not_selected when the dispute exists but no roster does', () => {
    const v = foldDkgConsole({ escrowId: ESCROW_ID, disputeEvent: DISPUTE, selectionEvent: null, ceremonyEvents: [], nowSeconds: NOW });
    expect(v.found).toBe(true);
    expect(v.phase).toBe('not_selected');
    expect(v.disputeId).toBe(DISPUTE_ID);
  });
});

describe('foldDkgConsole — ceremony replay', () => {
  it('binds by escrow, shows the DKG deadline from the dispute anchor', () => {
    const v = foldDkgConsole({
      escrowId: ESCROW_ID,
      disputeEvent: DISPUTE,
      selectionEvent: selectionEvent(),
      ceremonyEvents: [commitment(j1Sk, 1, DKG_START + 10)],
      nowSeconds: NOW,
    });
    expect(v.escrowId).toBe(ESCROW_ID);
    expect(v.deadline).toBe(DKG_DEADLINE);
    expect(v.roster.map((r) => r.idx)).toEqual([1, 2, 3]);
    expect(v.phase).toBe('dkg_round_1');
    expect(v.missingRound1).toEqual([2, 3]);
    expect(v.expired).toBe(false);
  });

  it('moves to dkg_round_2 when every juror commits', () => {
    const v = foldDkgConsole({
      escrowId: ESCROW_ID,
      disputeEvent: DISPUTE,
      selectionEvent: selectionEvent(),
      ceremonyEvents: [commitment(j1Sk, 1, DKG_START + 10), commitment(j2Sk, 2, DKG_START + 20), commitment(j3Sk, 3, DKG_START + 30)],
      nowSeconds: NOW,
    });
    expect(v.phase).toBe('dkg_round_2');
    expect(v.missingRound1).toEqual([]);
    expect(v.missingRound2).toEqual([1, 2, 3]);
  });

  it('counts per-target share deliveries and reports missing round-2 jurors', () => {
    const v = foldDkgConsole({
      escrowId: ESCROW_ID,
      disputeEvent: DISPUTE,
      selectionEvent: selectionEvent(),
      ceremonyEvents: [
        commitment(j1Sk, 1, DKG_START + 10), commitment(j2Sk, 2, DKG_START + 20), commitment(j3Sk, 3, DKG_START + 30),
        // Round 2: J1 and J2 exchange shares with each other only — nobody
        // targets J3, so J3 is the stalled participant (participation is
        // counted per RECIPIENT, matching the machine's accept_round_2).
        share(j1Sk, 1, 1, J1, DKG_START + 40), share(j1Sk, 1, 2, J2, DKG_START + 41),
        share(j2Sk, 2, 1, J1, DKG_START + 43), share(j2Sk, 2, 2, J2, DKG_START + 45),
      ],
      nowSeconds: NOW,
    });
    expect(v.warnings, v.warnings.join('|')).toEqual([]);
    const j3 = v.round2.find((r) => r.idx === 3);
    expect(j3).toBeUndefined();
    expect(v.round2.find((r) => r.idx === 1)?.shares).toBe(2);
    expect(v.missingRound2).toEqual([3]);
    expect(v.phase).toBe('dkg_round_2');
  });

  it('reports awaiting_transcript_finalize when round 2 completes', () => {
    const v = foldDkgConsole({
      escrowId: ESCROW_ID,
      disputeEvent: DISPUTE,
      selectionEvent: selectionEvent(),
      ceremonyEvents: [
        commitment(j1Sk, 1, DKG_START + 10), commitment(j2Sk, 2, DKG_START + 20), commitment(j3Sk, 3, DKG_START + 30),
        share(j1Sk, 1, 1, J1, DKG_START + 40), share(j1Sk, 1, 2, J2, DKG_START + 41), share(j1Sk, 1, 3, J3, DKG_START + 42),
        share(j2Sk, 2, 1, J1, DKG_START + 43), share(j2Sk, 2, 2, J2, DKG_START + 44), share(j2Sk, 2, 3, J3, DKG_START + 45),
        share(j3Sk, 3, 1, J1, DKG_START + 46), share(j3Sk, 3, 2, J2, DKG_START + 47), share(j3Sk, 3, 3, J3, DKG_START + 48),
      ],
      nowSeconds: NOW,
    });
    // No public transcript-finalize event exists in v1 — the console must
    // show the honest transport state, not invent 'certified'.
    expect(v.phase).toBe('awaiting_transcript_finalize');
    expect(v.missingRound2).toEqual([]);
  });

  it('surfaces complaints with their possession anchor and defense flag', () => {
    const v = foldDkgConsole({
      escrowId: ESCROW_ID,
      disputeEvent: DISPUTE,
      selectionEvent: selectionEvent(),
      ceremonyEvents: [
        commitment(j1Sk, 1, DKG_START + 10), commitment(j2Sk, 2, DKG_START + 20), commitment(j3Sk, 3, DKG_START + 30),
        complaint(j1Sk, 1, 2, J2, DKG_START + 50),
        complaint(j3Sk, 3, 1, J1, DKG_START + 60, true),
      ],
      nowSeconds: NOW,
    });
    expect(v.warnings, v.warnings.join('|')).toEqual([]);
    expect(v.complaints).toHaveLength(2);
    expect(v.complaints[0]).toMatchObject({ victimIdx: 1, accusedIdx: 2, accusedPubkey: J2, hasDefense: false });
    expect(v.complaints[1]).toMatchObject({ victimIdx: 3, accusedIdx: 1, hasDefense: true });
  });

  it('ignores ceremony events bound to a different dispute', () => {
    const foreign = 'f'.repeat(64);
    const v = foldDkgConsole({
      escrowId: ESCROW_ID,
      disputeEvent: DISPUTE,
      selectionEvent: selectionEvent(),
      ceremonyEvents: [commitment(j1Sk, 1, DKG_START + 10, foreign)],
      nowSeconds: NOW,
    });
    expect(v.round1).toEqual([]);
    expect(v.missingRound1).toEqual([1, 2, 3]);
  });

  it('warns (never crashes) on out-of-order publishes and malformed events', () => {
    const malformed = { ...commitment(j2Sk, 2, DKG_START + 20) };
    const v = foldDkgConsole({
      escrowId: ESCROW_ID,
      disputeEvent: DISPUTE,
      selectionEvent: selectionEvent(),
      ceremonyEvents: [
        // A share BEFORE all commitments → machine transition warning.
        share(j1Sk, 1, 1, J1, DKG_START + 5),
        commitment(j1Sk, 1, DKG_START + 10),
        // Malformed commitment (no phase_nonce) → strict-parse warning.
        (() => { const e = { ...malformed }; e.tags = e.tags.filter((t) => t[0] !== 'phase_nonce'); e.content = JSON.stringify({ ...(JSON.parse(e.content) as object), phaseNonce: undefined }); return court(e as unknown as ReturnType<typeof finalizeEvent>); })(),
      ],
      nowSeconds: NOW,
    });
    expect(v.warnings.length).toBeGreaterThanOrEqual(2);
    expect(v.round1.map((r) => r.idx)).toEqual([1]);
  });

  it('marks the ceremony expired past the DKG deadline with round 2 incomplete', () => {
    const v = foldDkgConsole({
      escrowId: ESCROW_ID,
      disputeEvent: DISPUTE,
      selectionEvent: selectionEvent(),
      ceremonyEvents: [commitment(j1Sk, 1, DKG_START + 10)],
      nowSeconds: DKG_DEADLINE + 5,
    });
    expect(v.expired).toBe(true);
    expect(v.failure).toContain('expired');
  });
});
