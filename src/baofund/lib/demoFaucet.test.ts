/**
 * demoFaucet contract: demo-only, async claim polling, URL-safe keys, and the
 * funded-ledger-rail probe used by the demo pledge path. `fundFetch` is
 * mocked at the module boundary - the HTTP engine has its own tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fundFetch = vi.fn();

vi.mock('./fundHttp', () => ({
  fundFetch: (...args: unknown[]) => fundFetch(...args),
}));

import { claimDemoSats, demoFundedRail, pollDemoClaim, DEMO_CLAIM_MAX_SATS } from './demoFaucet';
import { DEMO_FUND_API_BASE, fundNetworkApiBase, fundNetwork, isDemoNetwork } from './fundNetwork';

const signer = { signEvent: async (event: unknown) => event } as unknown as Parameters<typeof claimDemoSats>[0];

beforeEach(() => {
  fundFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fundNetwork', () => {
  it('defaults to testnet and switches to demo by env', () => {
    expect(fundNetwork()).toBe('testnet');
    expect(isDemoNetwork()).toBe(false);
    vi.stubEnv('VITE_BAO_FUND_NETWORK', 'demo');
    expect(fundNetwork()).toBe('demo');
    expect(isDemoNetwork()).toBe(true);
    expect(fundNetworkApiBase()).toBe(DEMO_FUND_API_BASE);
  });

  it('testnet keeps its own base (env override wins)', () => {
    vi.stubEnv('VITE_BAO_FUND_API_URL', 'https://fund.example/api');
    expect(fundNetworkApiBase()).toBe('https://fund.example/api');
  });
});

describe('claimDemoSats', () => {
  it('is demo-only: refuses on the testnet network', async () => {
    const res = await claimDemoSats(signer);
    expect(res.status).toBe('failed');
    expect(res.message).toContain('demo-only');
    expect(fundFetch).not.toHaveBeenCalled();
  });

  it('claims on lightning, polls claim-status and returns the claimed sats', async () => {
    vi.stubEnv('VITE_BAO_FUND_NETWORK', 'demo');
    fundFetch.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/v1/wallet/claim') {
        expect(opts?.method).toBe('POST');
        expect(opts?.body?.rail).toBe('lightning');
        expect(String(opts?.body?.idempotency_key)).toMatch(/^baofund-lightning-[A-Za-z0-9-]{1,40}$/);
        expect(String(opts?.body?.idempotency_key).length).toBeLessThanOrEqual(64);
        return { data: { status: 'pending', rail: 'lightning', amount_sats: 1_000 } };
      }
      if (path.startsWith('/v1/wallet/claim-status/')) {
        return { data: { status: 'completed', result: { claimed_sats: 1_000 } } };
      }
      throw new Error(`unexpected ${path}`);
    });

    const res = await claimDemoSats(signer, { amountSats: 1_000, pollMs: 1, timeoutMs: 200 });
    expect(res).toEqual({ rail: 'lightning', status: 'completed', claimedSats: 1_000 });
    expect(fundFetch.mock.calls.filter(([p]) => p === '/v1/wallet/claim')).toHaveLength(1);
    expect(fundFetch.mock.calls.some(([p]) => String(p).startsWith('/v1/wallet/claim-status/'))).toBe(true);
  });

  it('falls through to the next rail when one fails', async () => {
    vi.stubEnv('VITE_BAO_FUND_NETWORK', 'demo');
    fundFetch.mockImplementation(async (path: string, _opts?: { body?: Record<string, unknown> }) => {
      if (path === '/v1/wallet/claim' && _opts?.body?.rail === 'lightning') {
        throw new Error('No LNbits wallet available');
      }
      if (path === '/v1/wallet/claim') return { data: { status: 'pending' } };
      return { data: { status: 'completed', result: { claimed_sats: 500 } } };
    });

    const res = await claimDemoSats(signer, { amountSats: 500, pollMs: 1, timeoutMs: 200 });
    expect(res).toEqual({ rail: 'cashu', status: 'completed', claimedSats: 500 });
  });

  it('reports a failed claim with the API reason', async () => {
    vi.stubEnv('VITE_BAO_FUND_NETWORK', 'demo');
    fundFetch.mockImplementation(async (path: string) => {
      if (path === '/v1/wallet/claim') return { data: { status: 'pending' } };
      return { data: { status: 'failed', result: { code: 'ECASH_ERROR', error: 'Fedimint claim failed' } } };
    });

    const res = await claimDemoSats(signer, { amountSats: 500, pollMs: 1, timeoutMs: 200, rails: ['ecash'] });
    expect(res.status).toBe('failed');
    expect(res.message).toContain('Fedimint claim failed');
  });

  it('clamps the requested amount to the per-claim ceiling', async () => {
    vi.stubEnv('VITE_BAO_FUND_NETWORK', 'demo');
    fundFetch.mockImplementation(async (path: string) => {
      if (path === '/v1/wallet/claim') return { data: { status: 'pending' } };
      return { data: { status: 'completed', result: { claimed_sats: DEMO_CLAIM_MAX_SATS } } };
    });
    await claimDemoSats(signer, { amountSats: 999_999, pollMs: 1, timeoutMs: 200 });
    const claimCall = fundFetch.mock.calls.find(([p]) => p === '/v1/wallet/claim');
    expect(claimCall?.[1]?.body?.amount_sats).toBe(DEMO_CLAIM_MAX_SATS);
  });
});

describe('pollDemoClaim', () => {
  it('keeps polling while pending and times out as pending', async () => {
    vi.stubEnv('VITE_BAO_FUND_NETWORK', 'demo');
    fundFetch.mockResolvedValue({ data: { status: 'pending' } });
    const res = await pollDemoClaim(signer, 'baofund-cashu-x', 1, 25);
    expect(res.status).toBe('pending');
    expect(fundFetch.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('demoFundedRail', () => {
  it('picks the first ledger rail with enough balance', async () => {
    fundFetch.mockResolvedValue({ data: { cashu: { sats: 0 }, ecash: { sats: 2_000 } } });
    await expect(demoFundedRail(signer, 1_000)).resolves.toEqual({ rail: 'ecash', balanceSats: 2_000 });
    await expect(demoFundedRail(signer, 5_000)).resolves.toBeNull();
  });
});
