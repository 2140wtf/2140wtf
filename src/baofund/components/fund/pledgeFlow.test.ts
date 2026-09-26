import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contributeToFundraiser: vi.fn(),
}));

vi.mock('../../lib/baoFundraising', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/baoFundraising')>();
  return { ...original, contributeToFundraiser: mocks.contributeToFundraiser };
});

import { awaitingAddresses, confirmedPledgeFor, submitPledge } from './pledgeFlow';

const PUBKEY = 'c'.repeat(64);
const signer = {
  signEvent: async (e: unknown) => e,
} as never;

function request(overrides: Partial<Parameters<typeof submitPledge>[1]> = {}) {
  return {
    fundraiserId: 'fr_1',
    amountSats: 1000,
    rail: 'btc-testnet4' as const,
    judgeModel: 'deepseek-v4-flash',
    idempotencyKey: 'baofund:fr_1:btc-testnet4:1000:uuid-1',
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('submitPledge', () => {
  it('cashu: requires a donor-supplied token and forwards it (no faucet call exists)', async () => {
    const noToken = await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'cashu' }));
    expect(noToken.ok).toBe(false);
    expect(noToken.message).toContain('donor-supplied');
    expect(mocks.contributeToFundraiser).not.toHaveBeenCalled();

    mocks.contributeToFundraiser.mockResolvedValue({ fundraiser: {}, milestones: [], replayed: false });
    const withToken = await submitPledge(
      { signer, pubkey: PUBKEY },
      request({ rail: 'cashu', cashuToken: 'cashuBo2tok' }),
    );
    expect(withToken.ok).toBe(true);
    const input = mocks.contributeToFundraiser.mock.calls[0][2];
    expect(input.cashuToken).toBe('cashuBo2tok');
    expect(input.idempotencyKey).toBe('baofund:fr_1:btc-testnet4:1000:uuid-1');
    expect(input.preferredModel).toBe('deepseek-v4-flash');
  });

  it('maps UI testnet rail ids to the API contract (btc-testnet4 → l1, liquid-testnet → liquid)', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({ fundraiser: {}, milestones: [], replayed: false });
    await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'btc-testnet4' as never }));
    await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'liquid-testnet' as never }));
    expect(mocks.contributeToFundraiser.mock.calls[0][2].rail).toBe('l1');
    expect(mocks.contributeToFundraiser.mock.calls[1][2].rail).toBe('liquid');
  });

  it('non-cashu rails never forward a token', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({ fundraiser: {}, milestones: [], replayed: false });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'lightning' }));

    expect(res.ok).toBe(true);
    expect(mocks.contributeToFundraiser.mock.calls[0][2].cashuToken).toBeUndefined();
  });

  it('judge-model vote only ships for pledges of at least 1,000 sats', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({ fundraiser: {}, milestones: [], replayed: false });

    await submitPledge({ signer, pubkey: PUBKEY }, request({ amountSats: 500 }));

    expect(mocks.contributeToFundraiser.mock.calls[0][2].preferredModel).toBeUndefined();
  });

  it('a failed contribution surfaces the gate hint and the raw message', async () => {
    mocks.contributeToFundraiser.mockRejectedValue(
      Object.assign(new Error('This contribution rail is disabled until external funding is verified'), {
        code: 'FUNDRAISER_EXTERNAL_FUNDING_REQUIRED',
      }),
    );

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request());

    expect(res.ok).toBe(false);
    expect(res.message).toContain('external funding is verified'); // hint
    expect(res.message).toContain('(This contribution rail is disabled'); // raw server message kept
  });

  it('a failed contribution with an unknown error falls back to the raw message', async () => {
    mocks.contributeToFundraiser.mockRejectedValue(new Error('HTTP 502'));

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request());

    expect(res.ok).toBe(false);
    expect(res.message).toContain('HTTP 502');
  });

  it('the txid commit step does not report a misleading replay marker', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({
      fundraiser: {}, milestones: [], replayed: true,
      payment_instructions: { kind: 'address', address: 'tb1p2wslz457mz9trzql8nnnsv9lmprohe7ccy6pinj30vzw26zqt4sqp3kl58', amount_sats: 1000 },
    });
    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ txid: 'ab'.repeat(32) }));
    expect(res.ok).toBe(true);
    expect(res.message).not.toContain('(replayed)');
    expect(res.message).toContain('tx committed');
  });

  it('replayed contributions report the replay marker', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({ fundraiser: {}, milestones: [], replayed: true });

    // A non-on-chain rail: on-chain replays carry the deposit address and
    // must fail closed without one (see the fail-closed tests below).
    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'lightning' }));

    expect(res.ok).toBe(true);
    expect(res.message).toContain('(replayed)');
  });

  it('l1: the first call returns the escrow address as awaitingPayment', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({
      fundraiser: {},
      milestones: [],
      replayed: false,
      payment_instructions: {
        kind: 'address',
        address: 'tb1qescrowaddr',
        amount_sats: 1000,
        explorer_url: 'https://mempool.space/testnet4/address/tb1qescrowaddr',
      },
    });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'l1' }));

    expect(res.ok).toBe(true);
    expect(res.awaitingPayment).toEqual({
      address: 'tb1qescrowaddr',
      amountSats: 1000,
      explorerUrl: 'https://mempool.space/testnet4/address/tb1qescrowaddr',
      rail: 'l1',
    });
  });

  it('l1: the second call attaches the txid as the contribution reference', async () => {
    const txid = 'ef'.repeat(32);
    mocks.contributeToFundraiser.mockResolvedValue({
      fundraiser: {},
      milestones: [],
      replayed: true,
      payment_instructions: { kind: 'address', address: 'tb1qescrowaddr', amount_sats: 1000 },
    });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'l1', txid }));

    expect(res.ok).toBe(true);
    expect(res.awaitingPayment).toBeUndefined();
    expect(mocks.contributeToFundraiser.mock.calls[0][2].reference).toBe(txid);
    expect(res.message).toContain('tx committed');
  });

  it('liquid: address flow mirrors l1', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({
      fundraiser: {},
      milestones: [],
      replayed: false,
      payment_instructions: { kind: 'address', address: 'tex1qescrowaddr', amount_sats: 1000 },
    });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'liquid' }));

    expect(res.ok).toBe(true);
    expect(res.awaitingPayment?.address).toBe('tex1qescrowaddr');
  });

  it('liquid-testnet (UI rail id): address flow still returns the escrow address', async () => {
    // Regression: the UI offers 'liquid-testnet' while the API names the rail
    // 'liquid'; the address branch must map the UI id or the donor never sees
    // the deposit address and the modal reports the pledge as done.
    mocks.contributeToFundraiser.mockResolvedValue({
      fundraiser: {},
      milestones: [],
      replayed: false,
      payment_instructions: { kind: 'address', address: 'tex1quiflowaddr', amount_sats: 5000 },
    });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'liquid-testnet' }));

    expect(res.ok).toBe(true);
    expect(res.awaitingPayment?.address).toBe('tex1quiflowaddr');
    expect(res.awaitingPayment?.rail).toBe('liquid-testnet');
  });

  it('btc-testnet4: address flow works with the server explorer link when given', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({
      fundraiser: {},
      milestones: [],
      replayed: false,
      payment_instructions: {
        kind: 'address',
        address: 'tb1p2wslz457mz9trzql8nnnsv9lmprohe7ccy6pinj30vzw26zqt4sqp3kl58',
        amount_sats: 1000,
        explorer_url: 'https://mempool.space/testnet4/address/tb1p2wslz457mz9trzql8nnnsv9lmprohe7ccy6pinj30vzw26zqt4sqp3kl58',
      },
    });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request());

    expect(res.ok).toBe(true);
    expect(res.awaitingPayment?.rail).toBe('btc-testnet4');
    expect(res.awaitingPayment?.explorerUrl).toContain('mempool.space/testnet4/address/');
  });

  it('btc-testnet4: falls back to the public testnet4 explorer when the API omits the link', async () => {
    const address = 'tb1p2wslz457mz9trzql8nnnsv9lmprohe7ccy6pinj30vzw26zqt4sqp3kl58';
    mocks.contributeToFundraiser.mockResolvedValue({
      fundraiser: {},
      milestones: [],
      replayed: false,
      payment_instructions: { kind: 'address', address, amount_sats: 1000 },
    });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request());

    expect(res.ok).toBe(true);
    expect(res.awaitingPayment?.explorerUrl).toBe(`https://mempool.space/testnet4/address/${address}`);
  });

  it('btc-testnet4: the second call attaches the txid as the reference', async () => {
    const txid = 'ab'.repeat(32);
    mocks.contributeToFundraiser.mockResolvedValue({
      fundraiser: {},
      milestones: [],
      replayed: true,
      payment_instructions: { kind: 'address', address: 'tb1p2wslz457mz9trzql8nnnsv9lmprohe7ccy6pinj30vzw26zqt4sqp3kl58', amount_sats: 1000 },
    });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ txid }));

    expect(res.ok).toBe(true);
    expect(res.awaitingPayment).toBeUndefined();
    expect(mocks.contributeToFundraiser.mock.calls[0][2].reference).toBe(txid);
    expect(res.message).toContain('tx committed');
  });

  it('on-chain first call with NO payment instructions fails closed (no fabricated pledge)', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({ fundraiser: {}, milestones: [], replayed: false });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'l1' }));

    expect(res.ok).toBe(false);
    expect(res.awaitingPayment).toBeUndefined();
    expect(res.message).toMatch(/deposit address/i);
  });

  it('on-chain first call with an empty address fails closed', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({
      fundraiser: {},
      milestones: [],
      replayed: false,
      payment_instructions: { kind: 'address', address: '', amount_sats: 1000 },
    });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'l1' }));

    expect(res.ok).toBe(false);
    expect(res.awaitingPayment).toBeUndefined();
    expect(res.message).toMatch(/deposit address/i);
  });

  it('split outputs with a missing address fail closed instead of rendering an empty QR', async () => {
    mocks.contributeToFundraiser.mockResolvedValue({
      fundraiser: {},
      milestones: [],
      replayed: false,
      payment_instructions: {
        kind: 'addresses',
        total_sats: 1000,
        intent_id: 'g1',
        outputs: [{ milestone_id: 'm1', address: '', amount_sats: 1000 }],
      },
    });

    const res = await submitPledge({ signer, pubkey: PUBKEY }, request({ rail: 'l1' }));

    expect(res.ok).toBe(false);
    expect(res.awaitingPayment).toBeUndefined();
    expect(res.message).toMatch(/deposit address/i);
  });
});

describe('payment auto-detection', () => {
  const awaiting = {
    address: 'tb1pSINGLE',
    amountSats: 1_000,
    explorerUrl: '',
    rail: 'btc-testnet4' as const,
  };

  it('awaitingAddresses: single address, or every split output', () => {
    expect(awaitingAddresses(awaiting)).toEqual(['tb1pSINGLE']);
    expect(awaitingAddresses({
      ...awaiting,
      outputs: [
        { milestoneId: 'm1', address: 'tb1pA', amountSats: 500, explorerUrl: '' },
        { milestoneId: 'm2', address: 'tb1pB', amountSats: 500, explorerUrl: '' },
      ],
    })).toEqual(['tb1pA', 'tb1pB']);
  });

  it('confirmedPledgeFor: only a confirmed contribution on one of the addresses matches', () => {
    const row = (over: Record<string, unknown>) => ({
      id: 1, fundraiser_id: 'fr_1', contributor_pubkey: PUBKEY, amount_sats: 1_000,
      rail: 'l1', reference: null as string | null, created_at: '', status: 'pending',
      deposit_address: 'tb1pSINGLE', ...over,
    });
    const pending = row({ id: 1, status: 'pending' });
    const other = row({ id: 2, status: 'confirmed', deposit_address: 'tb1pOTHER' });
    expect(confirmedPledgeFor([pending, other], ['tb1pSINGLE'])).toBeNull();
    const confirmed = row({ id: 1, status: 'confirmed', reference: 'ab'.repeat(32) });
    expect(confirmedPledgeFor([confirmed, other], ['tb1pSINGLE'])?.id).toBe(1);
    expect(confirmedPledgeFor([confirmed], ['tb1pA', 'tb1pB'])).toBeNull();
  });
});
