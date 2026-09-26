import { describe, expect, it } from 'vitest';
import type { BaoContribution } from '../baoFundraising';
import { pickDonorEscrowContribution } from './donorContribution';

const DONOR = 'aa'.repeat(32);
const OTHER = 'bb'.repeat(32);

function contribution(overrides: Partial<BaoContribution>): BaoContribution {
  return {
    id: 1,
    fundraiser_id: 'fr_x',
    contributor_pubkey: DONOR,
    amount_sats: 1000,
    rail: 'cashu',
    reference: null,
    created_at: '2026-09-23T00:00:00Z',
    status: 'escrowed',
    ...overrides,
  } as BaoContribution;
}

describe('pickDonorEscrowContribution', () => {
  it('selects the single escrowed cashu row for the donor (case-insensitive pubkey)', () => {
    const row = pickDonorEscrowContribution([
      contribution({ id: 7, contributor_pubkey: DONOR.toUpperCase() }),
      contribution({ id: 8, contributor_pubkey: OTHER }),
    ], DONOR);
    expect(row?.id).toBe(7);
  });

  it('refuses when multiple escrowed cashu rows make the target ambiguous', () => {
    expect(pickDonorEscrowContribution([
      contribution({ id: 7 }),
      contribution({ id: 9 }),
    ], DONOR)).toBeNull();
  });

  it('ignores other rails and already-refunded rows', () => {
    expect(pickDonorEscrowContribution([
      contribution({ id: 7, rail: 'l1', status: 'confirmed' }),
      contribution({ id: 9, status: 'refunded' }),
    ], DONOR)).toBeNull();
  });

  it('ignores rows whose refund markers show the money already went back (status stays escrowed)', () => {
    // The API keeps status escrowed/confirmed on a refund; refunded_at /
    // refund_initiated_at are the only signal (BaoContribution doc). Picking
    // such a row would attempt a second refund.
    expect(pickDonorEscrowContribution([
      contribution({ id: 7, refunded_at: '2026-01-02T00:00:00Z' }),
    ], DONOR)).toBeNull();
    expect(pickDonorEscrowContribution([
      contribution({ id: 7, refund_initiated_at: '2026-01-01T00:00:00Z' }),
    ], DONOR)).toBeNull();
  });

  it('resolves the single live row when an older refunded row would otherwise make it ambiguous', () => {
    expect(pickDonorEscrowContribution([
      contribution({ id: 7, refunded_at: '2026-01-02T00:00:00Z' }),
      contribution({ id: 9 }),
    ], DONOR)?.id).toBe(9);
  });

  it('treats a missing status as live but excludes other donors', () => {
    expect(pickDonorEscrowContribution([contribution({ id: 7, status: undefined })], DONOR)?.id).toBe(7);
    expect(pickDonorEscrowContribution([contribution({ id: 7, status: undefined, contributor_pubkey: OTHER })], DONOR)).toBeNull();
  });
});
