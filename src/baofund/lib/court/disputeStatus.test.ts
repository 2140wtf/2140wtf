// disputeStatus.test.ts - the S1/S2 fold (design §2, rounds 1–5).
//
// Fixtures follow escrowCourt.test.ts: REAL FROST ceremonies (generateFrostKeys
// → runDisputeOverrideSigning) drive the verdict path, so the GUI fold and the
// release gate accept/reject byte-identically.
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  buildDisputeAttestationEvent,
  deriveSimulatedRevealEventId,
  generateFrostKeys,
  hashDisputeVerdict,
  runDisputeOverrideSigning,
} from '@/baofund/court-core';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import {
  attestationsFilter,
  canOpenDispute,
  disputesFilter,
  foldDisputeStatus,
  parseDisputeEvent,
  refundRaceCopy,
  verifyAttestationForDispute,
  type CourtEvent,
  type FoldContext,
} from './disputeStatus';
import { escrowMarketId } from './escrowCourt';

const ESCROW_ID = 'escrow-e2e-1';
const MARKET = escrowMarketId(ESCROW_ID);

const challengerSk = generateSecretKey();
const challenger = getPublicKey(challengerSk);
const respondentSk = generateSecretKey();
const respondent = getPublicKey(respondentSk);
const sybilSk = generateSecretKey();
const sybil = getPublicKey(sybilSk);

const OPENED_AT = 1_700_000_000;
const DEADLINE = OPENED_AT + 20 * 3600;

function ctx(over: Partial<FoldContext> = {}): FoldContext {
  return {
    partyAPubkey: challenger,
    partyBPubkey: respondent,
    courtGroupPubkey: 'g'.repeat(64), // replaced by real group keys in verdict tests
    nowSeconds: OPENED_AT + 60,
    ...over,
  };
}

/** Real, party-authored kind-38025 dispute event (challenger signs). */
function disputeEvent(over: { author?: Uint8Array; contentOverride?: Record<string, unknown>; tags?: string[][] } = {}): NostrEvent {
  const sk = over.author ?? challengerSk;
  return finalizeEvent(
    {
      kind: 38025,
      created_at: OPENED_AT,
      tags: over.tags ?? [
        ['market', MARKET],
        ['challenger', challenger],
        ['original', respondent],
        ['proposed', challenger],
        ['deadline', String(DEADLINE)],
      ],
      content: JSON.stringify(
        over.contentOverride ?? {
          marketId: MARKET,
          originalOutcome: respondent,
          proposedOutcome: challenger,
          evidenceHashes: ['f'.repeat(64)],
        },
      ),
    },
    sk,
  );
}

function toCourtEvent(e: NostrEvent): CourtEvent {
  return { id: e.id, pubkey: e.pubkey, kind: e.kind, created_at: e.created_at, tags: e.tags, content: e.content, sig: e.sig };
}

describe('parseDisputeEvent - drop everything foreign (round-1/2 rules)', () => {
  it('accepts a party-authored, verified dispute', () => {
    const e = disputeEvent();
    const d = parseDisputeEvent(toCourtEvent(e), ctx());
    expect(d).not.toBeNull();
    expect(d!.disputeId).toBe(e.id);
    expect(d!.escrowId).toBe(ESCROW_ID);
    expect(d!.challengerPubkey).toBe(challenger);
    expect(d!.respondentPubkey).toBe(respondent);
    expect(d!.openedAt).toBe(OPENED_AT);
    expect(d!.evidenceHashes).toEqual(['f'.repeat(64)]);
  });

  it('drops a sybil-authored dispute against our escrow', () => {
    const e = disputeEvent({ author: sybilSk });
    expect(parseDisputeEvent(toCourtEvent(e), ctx())).toBeNull();
  });

  it('drops a tampered (bad-signature) event', () => {
    const e = disputeEvent();
    const tampered = { ...e, content: e.content.replace('f'.repeat(64), 'a'.repeat(64)) } as NostrEvent;
    expect(parseDisputeEvent(toCourtEvent(tampered), ctx())).toBeNull();
  });

  it('drops non-escrow markets and wrong kinds', () => {
    const e = disputeEvent({ contentOverride: { marketId: 'some-market', originalOutcome: respondent, proposedOutcome: challenger, evidenceHashes: [] } });
    expect(parseDisputeEvent(toCourtEvent(e), ctx())).toBeNull();
    const other = { ...disputeEvent(), kind: 38029 } as NostrEvent;
    expect(parseDisputeEvent(toCourtEvent(other), ctx())).toBeNull();
  });

  it('drops a challenger tag naming a non-party', () => {
    const e = disputeEvent({ tags: [['market', MARKET], ['challenger', sybil], ['original', respondent], ['proposed', sybil], ['deadline', String(DEADLINE)]] });
    expect(parseDisputeEvent(toCourtEvent(e), ctx())).toBeNull();
  });
});

describe('foldDisputeStatus - phases, gate, and verdicts', () => {
  it('active dispute: phases anchored at openedAt, refund-race gate true early', () => {
    const e = disputeEvent();
    const v = foldDisputeStatus([toCourtEvent(e)], e.id, ctx());
    expect(v).not.toBeNull();
    expect(v!.terminal.kind).toBe('active');
    expect(v!.activePhase).toBe('dispute');
    expect(v!.canStillResolveInTime).toBe(true);
    expect(v!.phases[0]).toEqual({ phase: 'dispute', startsAt: OPENED_AT, endsAt: OPENED_AT + 2 * 3600 });
  });

  it('a court cycle opened too long ago fails the refund-race gate', () => {
    const e = disputeEvent();
    const v = foldDisputeStatus([toCourtEvent(e)], e.id, ctx({ nowSeconds: OPENED_AT + 23 * 3600 }));
    expect(v!.canStillResolveInTime).toBe(false);
  });

  it('a real FROST verdict flips to terminal - through the same verifier the gate uses', () => {
    const e = disputeEvent();
    const disputeId = e.id;
    const jurors = [1, 2, 3].map((idx) => ({ idx, nostrPubkey: '0'.repeat(63) + String(idx), stakeCapacitySats: 10_000, stakeCommitment: { amountSats: 10_000, bondAddress: 'bc1q', status: 'confirmed' as const }, wotScore: 80, categories: ['escrow'], registeredAt: 1_700_000_000, priority: idx }));
    const { record, shares } = generateFrostKeys({ marketId: MARKET, disputeId, threshold: 2, jurors });
    const outcome = challenger;
    const supportingEventIds = [1, 2, 3].map((idx) => deriveSimulatedRevealEventId(idx, outcome, `salt-${idx}`));
    const verdictHash = hashDisputeVerdict({ disputeId: disputeId.toLowerCase(), outcome, supportingEventIds });
    const attestation = runDisputeOverrideSigning({ dispute: { disputeId, marketId: MARKET, challengerPubkey: challenger, respondentPubkey: respondent, evidenceHashes: ['f'.repeat(64)], proposedOutcome: outcome }, dkg: record, shares, verdictHash, supportingEventIds });
    const pubSk = generateSecretKey();
    const attEvent = finalizeEvent(buildDisputeAttestationEvent({ attestation, marketEventId: 'e'.repeat(64) }), pubSk);

    const v = foldDisputeStatus([toCourtEvent(e), toCourtEvent(attEvent)], e.id, ctx({ courtGroupPubkey: record.groupPubkeyXOnly }));
    expect(v!.terminal.kind).toBe('verdict');
    if (v!.terminal.kind === 'verdict') {
      expect(v!.terminal.winnerPubkey).toBe(challenger);
      expect(v!.terminal.attestationEventId).toBe(attEvent.id);
    }
  });

  it('an attestation from the WRONG jury surfaces as invalid evidence, never a verdict', () => {
    const e = disputeEvent();
    const disputeId = e.id;
    const mkJurors = () => [1, 2, 3].map((idx) => ({ idx, nostrPubkey: '0'.repeat(63) + String(idx), stakeCapacitySats: 10_000, stakeCommitment: { amountSats: 10_000, bondAddress: 'bc1q', status: 'confirmed' as const }, wotScore: 80, categories: ['escrow'], registeredAt: 1_700_000_000, priority: idx }));
    // TWO independent ceremonies for the SAME dispute id - the attacker runs
    // their own DKG and signs with THEIR group key (the dispute-derived-key
    // forgery class). Verification is pinned to the REAL empaneled key.
    const real = generateFrostKeys({ marketId: MARKET, disputeId, threshold: 2, jurors: mkJurors() });
    const rogue = generateFrostKeys({ marketId: MARKET, disputeId, threshold: 2, jurors: mkJurors() });
    const outcome = challenger;
    const supportingEventIds = [1, 2, 3].map((idx) => deriveSimulatedRevealEventId(idx, outcome, `salt-${idx}`));
    const verdictHash = hashDisputeVerdict({ disputeId: disputeId.toLowerCase(), outcome, supportingEventIds });
    const attestation = runDisputeOverrideSigning({ dispute: { disputeId, marketId: MARKET, challengerPubkey: challenger, respondentPubkey: respondent, evidenceHashes: ['f'.repeat(64)], proposedOutcome: outcome }, dkg: rogue.record, shares: rogue.shares, verdictHash, supportingEventIds });
    const attEvent = finalizeEvent(buildDisputeAttestationEvent({ attestation, marketEventId: 'e'.repeat(64) }), generateSecretKey());

    const v = foldDisputeStatus([toCourtEvent(e), toCourtEvent(attEvent)], e.id, ctx({ courtGroupPubkey: real.record.groupPubkeyXOnly }));
    expect(v!.terminal.kind).toBe('invalid_attestation');
  });

  it('an attestation bound to a DIFFERENT dispute is skipped, not surfaced', () => {
    const e = disputeEvent();
    const jurors = [1, 2, 3].map((idx) => ({ idx, nostrPubkey: '0'.repeat(63) + String(idx), stakeCapacitySats: 10_000, stakeCommitment: { amountSats: 10_000, bondAddress: 'bc1q', status: 'confirmed' as const }, wotScore: 80, categories: ['escrow'], registeredAt: 1_700_000_000, priority: idx }));
    const { record, shares } = generateFrostKeys({ marketId: MARKET, disputeId: 'c'.repeat(64), threshold: 2, jurors });
    const outcome = challenger;
    const supportingEventIds = [1, 2, 3].map((idx) => deriveSimulatedRevealEventId(idx, outcome, `salt-${idx}`));
    const verdictHash = hashDisputeVerdict({ disputeId: 'c'.repeat(64), outcome, supportingEventIds });
    const attestation = runDisputeOverrideSigning({ dispute: { disputeId: 'c'.repeat(64), marketId: MARKET, challengerPubkey: challenger, respondentPubkey: respondent, evidenceHashes: ['f'.repeat(64)], proposedOutcome: outcome }, dkg: record, shares, verdictHash, supportingEventIds });
    const attEvent = finalizeEvent(buildDisputeAttestationEvent({ attestation, marketEventId: 'e'.repeat(64) }), generateSecretKey());

    const v = foldDisputeStatus([toCourtEvent(e), toCourtEvent(attEvent)], e.id, ctx({ courtGroupPubkey: record.groupPubkeyXOnly }));
    expect(v!.terminal.kind).toBe('active');
  });

  it('verifyAttestationForDispute agrees with the fold on the winner', () => {
    const e = disputeEvent();
    const disputeId = e.id;
    const d = parseDisputeEvent(toCourtEvent(e), ctx())!;
    const jurors = [1, 2, 3].map((idx) => ({ idx, nostrPubkey: '0'.repeat(63) + String(idx), stakeCapacitySats: 10_000, stakeCommitment: { amountSats: 10_000, bondAddress: 'bc1q', status: 'confirmed' as const }, wotScore: 80, categories: ['escrow'], registeredAt: 1_700_000_000, priority: idx }));
    const { record, shares } = generateFrostKeys({ marketId: MARKET, disputeId, threshold: 2, jurors });
    const outcome = respondent;
    const supportingEventIds = [1, 2, 3].map((idx) => deriveSimulatedRevealEventId(idx, outcome, `salt-${idx}`));
    const verdictHash = hashDisputeVerdict({ disputeId: disputeId.toLowerCase(), outcome, supportingEventIds });
    const attestation = runDisputeOverrideSigning({ dispute: { disputeId, marketId: MARKET, challengerPubkey: challenger, respondentPubkey: respondent, evidenceHashes: ['f'.repeat(64)], proposedOutcome: outcome }, dkg: record, shares, verdictHash, supportingEventIds });
    const attEvent = toCourtEvent(finalizeEvent(buildDisputeAttestationEvent({ attestation, marketEventId: 'e'.repeat(64) }), generateSecretKey()));
    const c = ctx({ courtGroupPubkey: record.groupPubkeyXOnly });
    expect(verifyAttestationForDispute(attEvent, d, c)).toEqual({ valid: true, winnerPubkey: respondent });
  });
});

describe('canOpenDispute + copy + filters (S1 + round-3)', () => {
  it('blocks a second dispute and the refund race; allows a fresh one', () => {
    expect(canOpenDispute({ elapsedSeconds: 100, existingDispute: { disputeId: 'x' } as never })).toEqual({ ok: false, code: 'dispute_already_open' });
    expect(canOpenDispute({ elapsedSeconds: 23 * 3600, existingDispute: null })).toEqual({ ok: false, code: 'court_cannot_beat_refund' });
    expect(canOpenDispute({ elapsedSeconds: 100, existingDispute: null })).toEqual({ ok: true });
  });
  it('role-specific refund-race copy differs (round-3)', () => {
    expect(refundRaceCopy('donor')).toMatch(/pledge refunds automatically/);
    expect(refundRaceCopy('founder')).toMatch(/refund wins/);
  });
  it('relay filters use only strfry-indexable keys (authors + single-char tags)', () => {
    // strfry rejects multi-char tag filters ("unindexed tag filter"): disputes
    // are found by the escrow parties, attestations by their single-char `d`.
    expect(disputesFilter(['A'.repeat(64), 'B'.repeat(64)])).toEqual({
      kinds: [38025],
      authors: ['a'.repeat(64), 'b'.repeat(64)],
      limit: 50,
    });
    expect(attestationsFilter('a'.repeat(64))).toEqual({ kinds: [39007], '#d': ['a'.repeat(64)], limit: 10 });
  });
});
