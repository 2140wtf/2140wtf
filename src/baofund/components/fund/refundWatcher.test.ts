import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { findRefundCandidates, claimRefund } from './refundWatcher';

const DONOR = 'b'.repeat(64);

const deps = {
  signer: { signEvent: vi.fn(async (e: unknown) => e) },
  donorPubkey: DONOR,
  donorPrivkey: '11'.repeat(32),
};

const contribution = { id: 42, fundraiser_id: 'fr_1', amount_sats: 999, rail: 'cashu', contributor_pubkey: DONOR };

beforeEach(() => {
  vi.restoreAllMocks();
  deps.signer.signEvent.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('findRefundCandidates', () => {
  it('returns only the donor\u2019s escrowed contributions', async () => {
    const rows = [
      { ...contribution, lock_secret: 'ls', cashu_token: 'ct' },
      { id: 43, fundraiser_id: 'fr_1', amount_sats: 500, rail: 'cashu', contributor_pubkey: 'other'.padEnd(64, '0') },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) }));
    const result = await findRefundCandidates({ donorPubkey: DONOR }, ['fr_1']);
    expect(result).toHaveLength(1);
    expect(result[0].amountSats).toBe(999);
    vi.unstubAllGlobals();
  });
});

describe('findRefundCandidates normalization (wave 4)', () => {
  it('matches an uppercase API pubkey and a numeric-string amount', async () => {
    const rows = [
      { id: 44, fundraiser_id: 'fr_1', amount_sats: '777', rail: 'cashu', contributor_pubkey: DONOR.toUpperCase(), lock_secret: 'ls', cashu_token: 'ct' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) }));
    const result = await findRefundCandidates({ donorPubkey: DONOR }, ['fr_1']);
    expect(result).toHaveLength(1);
    expect(result[0].amountSats).toBe(777);
    vi.unstubAllGlobals();
  });
});

describe('claimRefund fail-closed boundary', () => {
  const candidate = { contributionId: 42, fundraiserId: 'fr_1', amountSats: 999, rail: 'cashu' };
  it.each([{}, { data: { escrow_release: { swap: { mint: 'https://mint.example.com', inputs: [], outputs: [] } } } }])('does not treat an HTTP-success payload as recovered funds', async body => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await claimRefund(deps, candidate);
    expect(result.ok).toBe(false);
    expect(result.refundedSats).toBe(0);
    expect(result.message).toContain('No refund was submitted');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deps.signer.signEvent).not.toHaveBeenCalled();
  });
  it('never reads or uses the donor private key while the recovery contract is unavailable', async () => {
    let keyAccessed = false;
    const result = await claimRefund({ ...deps, get donorPrivkey(): string { keyAccessed = true; throw new Error('must not request a private key'); } }, candidate);
    expect(result.ok).toBe(false);
    expect(keyAccessed).toBe(false);
  });
  it('preserves the stored wallet without claiming the candidate amount was returned', async () => {
    const before = JSON.stringify({ mintUrl: 'https://mint.example.com', proofs: [{ secret: 'synthetic-proof', amount: 1 }] });
    localStorage.setItem('bao-fund-wallet', before);
    const result = await claimRefund(deps, { ...candidate, amountSats: Number.MAX_SAFE_INTEGER });
    expect(localStorage.getItem('bao-fund-wallet')).toBe(before);
    expect(result.refundedSats).toBe(0);
    localStorage.removeItem('bao-fund-wallet');
  });
});
