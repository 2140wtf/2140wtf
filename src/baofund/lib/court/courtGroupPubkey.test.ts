// courtGroupPubkey.test.ts — the empaneled-jury pin that gates the Execute
// verdict affordance.
//
// Two layers:
//   1. config resolution: VITE_FUND_COURT_GROUP_PUBKEY wins, the committed
//      standing-group key is the sane fallback;
//   2. wiring: a real FROST verdict folds to a terminal verdict exactly when
//      it was signed by the group key the app resolves — which is the
//      precondition MilestoneCourtSection uses to pass `onExecute`.
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  foldDisputeStatus,
  type CourtEvent,
  type FoldContext,
} from './disputeStatus';
import {
  courtGroupPinFromConfig,
  fundCourtGroupPubkey,
  STANDING_COURT_GROUP_PUBKEY,
} from './courtGroupPubkey';
import { escrowMarketId } from './escrowCourt';

afterEach(() => {
  vi.unstubAllEnvs();
});

const ESCROW_ID = 'escrow-pin-test';
const MARKET = escrowMarketId(ESCROW_ID);
const OPENED_AT = 1_700_000_000;
const DEADLINE = OPENED_AT + 20 * 3600;

const challengerSk = generateSecretKey();
const challenger = getPublicKey(challengerSk);
const respondentSk = generateSecretKey();
const respondent = getPublicKey(respondentSk);

describe('fund court group pin', () => {
  it('accepts only a 64-hex value from config, lowercased', () => {
    expect(courtGroupPinFromConfig('AB'.repeat(32))).toBe('ab'.repeat(32));
    expect(courtGroupPinFromConfig('ab'.repeat(31))).toBeNull();
    expect(courtGroupPinFromConfig('ab'.repeat(33))).toBeNull();
    expect(courtGroupPinFromConfig('zz'.repeat(32))).toBeNull();
    expect(courtGroupPinFromConfig(undefined)).toBeNull();
  });

  it('resolves the standing group key by default and the env pin when set', () => {
    expect(fundCourtGroupPubkey()).toBe(STANDING_COURT_GROUP_PUBKEY);
    expect(STANDING_COURT_GROUP_PUBKEY).toMatch(/^[0-9a-f]{64}$/);

    vi.stubEnv('VITE_FUND_COURT_GROUP_PUBKEY', 'CD'.repeat(32));
    expect(fundCourtGroupPubkey()).toBe('cd'.repeat(32));

    vi.stubEnv('VITE_FUND_COURT_GROUP_PUBKEY', 'not-a-key');
    expect(fundCourtGroupPubkey()).toBe(STANDING_COURT_GROUP_PUBKEY);
  });
});

function courtEvent(e: NostrEvent): CourtEvent {
  return { id: e.id, pubkey: e.pubkey, kind: e.kind, created_at: e.created_at, tags: e.tags, content: e.content, sig: e.sig };
}

function disputeEvent(): NostrEvent {
  return finalizeEvent(
    {
      kind: 38025,
      created_at: OPENED_AT,
      tags: [
        ['market', MARKET],
        ['challenger', challenger],
        ['original', respondent],
        ['proposed', challenger],
        ['deadline', String(DEADLINE)],
      ],
      content: JSON.stringify({
        marketId: MARKET,
        originalOutcome: respondent,
        proposedOutcome: challenger,
        evidenceHashes: ['f'.repeat(64)],
      }),
    },
    challengerSk,
  );
}

function foldContext(groupKey: string): FoldContext {
  return {
    partyAPubkey: challenger,
    partyBPubkey: respondent,
    courtGroupPubkey: groupKey,
    nowSeconds: OPENED_AT + 60,
  };
}

function frostVerdict(disputeId: string) {
  const jurors = [1, 2, 3].map((idx) => ({
    idx,
    nostrPubkey: '0'.repeat(63) + String(idx),
    stakeCapacitySats: 10_000,
    stakeCommitment: { amountSats: 10_000, bondAddress: 'bc1q', status: 'confirmed' as const },
    wotScore: 80,
    categories: ['escrow'],
    registeredAt: OPENED_AT,
    priority: idx,
  }));
  const { record, shares } = generateFrostKeys({ marketId: MARKET, disputeId, threshold: 2, jurors });
  const outcome = challenger;
  const supportingEventIds = [1, 2, 3].map((idx) => deriveSimulatedRevealEventId(idx, outcome, `salt-${idx}`));
  const verdictHash = hashDisputeVerdict({ disputeId: disputeId.toLowerCase(), outcome, supportingEventIds });
  const attestation = runDisputeOverrideSigning({
    dispute: {
      disputeId,
      marketId: MARKET,
      challengerPubkey: challenger,
      respondentPubkey: respondent,
      evidenceHashes: ['f'.repeat(64)],
      proposedOutcome: outcome,
    },
    dkg: record,
    shares,
    verdictHash,
    supportingEventIds,
  });
  const attEvent = finalizeEvent(
    buildDisputeAttestationEvent({ attestation, marketEventId: 'e'.repeat(64) }),
    generateSecretKey(),
  );
  return { groupKey: record.groupPubkeyXOnly, attEvent };
}

describe('verdict wiring under the configured pin (Execute affordance gate)', () => {
  it('folds a real verdict to terminal when signed by the configured group key', () => {
    const e = disputeEvent();
    const { groupKey, attEvent } = frostVerdict(e.id);
    vi.stubEnv('VITE_FUND_COURT_GROUP_PUBKEY', groupKey);
    const resolved = fundCourtGroupPubkey();
    expect(resolved).toBe(groupKey);
    expect(resolved).not.toBeNull();

    const v = foldDisputeStatus([courtEvent(e), courtEvent(attEvent)], e.id, foldContext(resolved!));
    expect(v!.terminal.kind).toBe('verdict');
    if (v!.terminal.kind === 'verdict') {
      expect(v!.terminal.winnerPubkey).toBe(challenger);
    }
  });

  it('rejects the same verdict when the pin names a different group (rogue jury)', () => {
    const e = disputeEvent();
    const { attEvent } = frostVerdict(e.id);
    const rogue = frostVerdict(e.id);
    vi.stubEnv('VITE_FUND_COURT_GROUP_PUBKEY', rogue.groupKey);
    const resolved = fundCourtGroupPubkey();
    expect(resolved).toBe(rogue.groupKey);

    const v = foldDisputeStatus([courtEvent(e), courtEvent(attEvent)], e.id, foldContext(resolved!));
    expect(v!.terminal.kind).toBe('invalid_attestation');
  });

  it('keeps the standing key as a real pin: foreign verdicts never flip', () => {
    const e = disputeEvent();
    const { attEvent } = frostVerdict(e.id);
    const resolved = fundCourtGroupPubkey();
    expect(resolved).toBe(STANDING_COURT_GROUP_PUBKEY);
    const v = foldDisputeStatus([courtEvent(e), courtEvent(attEvent)], e.id, foldContext(resolved!));
    expect(v!.terminal.kind).toBe('invalid_attestation');
  });
});
