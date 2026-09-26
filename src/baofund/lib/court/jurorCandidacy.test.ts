/**
 * S4 fold tests - jurorCandidacy (COURT-GUI-WIRING-DESIGN.md §2 S4).
 *
 * Fixtures are REAL signed events: the vendor's buildJurorCandidacyEvent
 * produces the template and finalizeEvent signs it, so the fold's
 * signature-verification gate is exercised end-to-end (not mocked).
 */
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { buildJurorCandidacyEvent } from '@/baofund/court-core/events.js';
import { calculateBondAmount } from '@/baofund/court-core/escrow.js';
import {
  foldJurorCandidacies,
  parseCandidacyEvent,
  bondRequired,
  candidacyJoinRejection,
  candidacyFilter,
  allDisputesFilter,
  selectionsForJuror,
  type CourtEvent,
} from './jurorCandidacy';

const DISPUTE = 'a'.repeat(64);
const MARKET = 'market-1';

function signCandidacy(opts: {
  jurorSeckey?: Uint8Array;
  disputeId?: string;
  bondSats?: number;
  bondTxid?: string;
  bondVout?: number;
  bondScript?: string;
  deadline?: number;
  stakeCapacity?: number;
  createdAt?: number;
}): { event: CourtEvent; seckey: Uint8Array } {
  const seckey = opts.jurorSeckey ?? generateSecretKey();
  const template = buildJurorCandidacyEvent({
    disputeId: opts.disputeId ?? DISPUTE,
    marketId: MARKET,
    juror: {
      nostrPubkey: '',
      stakeCapacitySats: opts.stakeCapacity ?? 50_000,
      stakeCommitment: { amountSats: opts.bondSats ?? 10_000, bondAddress: 'tb1ptest', status: 'pending' },
      wotScore: 70,
      categories: ['markets'],
      registeredAt: opts.createdAt ?? 1_700_000_000,
    },
    bondAmountSats: opts.bondSats ?? 10_000,
    bondAddress: 'tb1ptest',
    bondTxid: opts.bondTxid,
    bondVout: opts.bondVout,
    bondScriptPubKey: opts.bondScript,
    deadlineSeconds: opts.deadline,
  });
  const signed = finalizeEvent(
    { kind: template.kind, created_at: opts.createdAt ?? 1_700_000_100, tags: template.tags, content: template.content },
    seckey,
  ) as unknown as CourtEvent;
  return { event: signed, seckey };
}

describe('parseCandidacyEvent - verify-before-parse', () => {
  it('parses a real signed candidacy end-to-end', () => {
    const { event } = signCandidacy({ bondTxid: 'ff'.repeat(32), bondVout: 0, bondScript: '5120' + 'ab'.repeat(32) });
    const parsed = parseCandidacyEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.jurorPubkey).toBe(event.pubkey.toLowerCase());
    expect(parsed!.disputeId).toBe(DISPUTE);
    expect(parsed!.marketId).toBe(MARKET);
    expect(parsed!.stakeCapacitySats).toBe(50_000);
    expect(parsed!.bondTxid).toBe('ff'.repeat(32));
    expect(parsed!.bondVout).toBe(0);
  });

  it('rejects a tampered signature (never renders unsigned content)', () => {
    const { event } = signCandidacy({});
    const tampered: CourtEvent = { ...event, content: JSON.stringify({ hijacked: true }) };
    expect(parseCandidacyEvent(tampered)).toBeNull();
  });

  it('rejects a wrong-kind event', () => {
    const { event } = signCandidacy({});
    expect(parseCandidacyEvent({ ...event, kind: 1 })).toBeNull();
  });
});

describe('foldJurorCandidacies - one edition per juror, latest wins', () => {
  it('keeps only the newest edition per juror and drops invalid events', () => {
    const jurorSk = generateSecretKey();
    const old = signCandidacy({ jurorSeckey: jurorSk, createdAt: 1_700_000_100, stakeCapacity: 10_000 });
    const newer = signCandidacy({ jurorSeckey: jurorSk, createdAt: 1_700_000_200, stakeCapacity: 99_000 });
    const unsigned = signCandidacy({ createdAt: 1_700_000_300, stakeCapacity: 123_456 });
    const broken: CourtEvent = { ...unsigned.event, sig: '0'.repeat(128) };

    const folded = foldJurorCandidacies([old.event, newer.event, broken], {
      nowSeconds: 1_700_001_000,
      bondVerified: new Map(),
    });
    expect(folded).toHaveLength(1);
    expect(folded[0].eventId).toBe(newer.event.id);
    expect(folded[0].stakeCapacitySats).toBe(99_000);
  });

  it('sorts by stake capacity and injects the bond-verification outcome', () => {
    const txid = 'ab'.repeat(32);
    const a = signCandidacy({ stakeCapacity: 20_000, bondTxid: txid, bondVout: 1 });
    const b = signCandidacy({ stakeCapacity: 80_000, bondTxid: txid, bondVout: 2 });

    const verified = foldJurorCandidacies([a.event, b.event], {
      nowSeconds: 1_700_001_000,
      bondVerified: new Map([[`${txid}:1`, true]]),
    });
    expect(verified.map((c) => c.stakeCapacitySats)).toEqual([80_000, 20_000]);
    expect(verified[1].bondVerified).toBe(true); // a's UTXO key matched
    expect(verified[0].bondVerified).toBe(false); // b's did not
  });

  it('resolves same-second editions deterministically (input order never decides)', () => {
    const jurorSk = generateSecretKey();
    const e1 = signCandidacy({ jurorSeckey: jurorSk, createdAt: 1_700_000_500, stakeCapacity: 10_000 });
    const e2 = signCandidacy({ jurorSeckey: jurorSk, createdAt: 1_700_000_500, stakeCapacity: 10_000 });
    if (e1.event.id === e2.event.id) {
      // Degenerate fixture (same bytes) - fold must still be single-edition.
      const once = foldJurorCandidacies([e1.event], { nowSeconds: 0, bondVerified: new Map() });
      expect(once).toHaveLength(1);
      return;
    }
    // Fold in both orders: the winner must be the same (higher event id).
    const winner = e1.event.id > e2.event.id ? e1.event.id : e2.event.id;
    const forward = foldJurorCandidacies([e1.event, e2.event], { nowSeconds: 0, bondVerified: new Map() });
    const reverse = foldJurorCandidacies([e2.event, e1.event], { nowSeconds: 0, bondVerified: new Map() });
    expect(forward).toHaveLength(1);
    expect(reverse).toHaveLength(1);
    expect(forward[0].eventId).toBe(winner);
    expect(reverse[0].eventId).toBe(winner);
  });
});

describe('bondRequired - vendor math re-exported without drift', () => {
  it('matches calculateBondAmount (5% base, min 10k, doubling rounds)', () => {
    expect(bondRequired(0, 1)).toBe(calculateBondAmount(0, 1));
    expect(bondRequired(0, 1)).toBe(10_000);
    expect(bondRequired(1_000_000, 1)).toBe(50_000);
    expect(bondRequired(1_000_000, 3)).toBe(calculateBondAmount(1_000_000, 3));
    expect(bondRequired(1_000_000, 3)).toBe(200_000);
  });
});

describe('candidacyJoinRejection - deny-by-default, first reason wins', () => {
  const base = {
    bondAmountSats: 50_000,
    requiredBondSats: 50_000,
    nowSeconds: 1_700_000_000,
    bondTxid: 'cd'.repeat(32),
    bondVout: 0,
    bondVerified: true,
  };

  it('allows an all-gates-pass candidacy', () => {
    expect(candidacyJoinRejection(base)).toBeNull();
  });

  it('refuses a bond below the requirement (before any other check)', () => {
    expect(candidacyJoinRejection({ ...base, bondAmountSats: 49_999, bondVerified: false, optInDeadlineSeconds: 1 })).toBe('bond_below_requirement');
  });

  it('refuses a closed opt-in window', () => {
    expect(candidacyJoinRejection({ ...base, optInDeadlineSeconds: 1_699_999_999 })).toBe('opt_in_window_closed');
    expect(candidacyJoinRejection({ ...base, optInDeadlineSeconds: 1_700_000_000 })).toBe('opt_in_window_closed'); // boundary: deadline is exclusive
    expect(candidacyJoinRejection({ ...base, optInDeadlineSeconds: 1_700_000_001 })).toBeNull();
  });

  it('refuses a missing or unverified bond proof', () => {
    expect(candidacyJoinRejection({ ...base, bondTxid: undefined })).toBe('missing_bond_proof');
    expect(candidacyJoinRejection({ ...base, bondVout: undefined })).toBe('missing_bond_proof');
    expect(candidacyJoinRejection({ ...base, bondVerified: false })).toBe('bond_not_verified');
  });
});

describe('relay filters', () => {
  it('scope queries to the court kinds', () => {
    expect(candidacyFilter(DISPUTE)).toEqual({ kinds: [39001], '#e': [DISPUTE], limit: 200 });
    expect(allDisputesFilter()).toEqual({ kinds: [38025], limit: 100 });
    const sel = selectionsForJuror('AB'.repeat(32));
    expect(sel.kinds).toEqual([39002]);
    expect(sel['#p']).toEqual(['ab'.repeat(32)]);
    expect(sel.limit).toBe(100);
  });
});
