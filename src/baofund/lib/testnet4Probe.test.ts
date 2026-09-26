import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROBE_CONFIG,
  applyProbeToDeposit,
  probeConfirmation,
  type ConfirmationEvidence,
  type ProbeConfig,
} from './testnet4Probe';
import { BTC_TESTNET4_GENESIS_HASH } from './testnet4Rail';

const TXID = 'aa'.repeat(32);
const BLOCK_HASH = 'bb'.repeat(32);

function cfg(overrides: Partial<ProbeConfig> = {}): ProbeConfig {
  return { ...DEFAULT_PROBE_CONFIG, fetchImpl: async () => { throw new Error('no fetch configured'); }, ...overrides };
}

/** Route-aware fake fetch: /block-height/0, /tx/<id>, /blocks/tip/height. */
function fakeFetch(routes: {
  genesis?: string;
  tip?: number;
  tx?: { status: number; body?: unknown } | 'network-error';
}): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/block-height/0')) {
      if (routes.genesis === 'network-error') throw new Error('genesis unreachable');
      return textRes(routes.genesis ?? BTC_TESTNET4_GENESIS_HASH, 200);
    }
    if (url.includes('/blocks/tip/height')) {
      if (routes.tip === undefined) throw new Error('tip unreachable');
      return textRes(String(routes.tip), 200);
    }
    if (url.includes(`/tx/${TXID}`)) {
      const t = routes.tx;
      if (t === 'network-error') throw new Error('tx unreachable');
      if (!t) throw new Error('unexpected tx query');
      if (t.status !== 200) return textRes('not found', t.status);
      return jsonRes(t.body, 200);
    }
    throw new Error(`unexpected URL: ${url}`);
  }) as unknown as typeof fetch;
}

function textRes(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const NOW = 1_789_000_000;

describe('probeConfirmation - confirmed path', () => {
  it('reports confirmed when tip − height + 1 ≥ minConfirmations (1)', async () => {
    const fetchImpl = fakeFetch({ tip: 50_000, tx: { status: 200, body: { status: { confirmed: true, block_height: 50_000, block_hash: BLOCK_HASH } } } });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl }), NOW);
    expect(e.status).toBe('confirmed');
    expect(e.confirmations).toBe(1);
    expect(e.blockHash).toBe(BLOCK_HASH);
    expect(e.blockHeight).toBe(50_000);
    expect(e.observedTipHeight).toBe(50_000);
    expect(e.genesisHashObserved).toBe(BTC_TESTNET4_GENESIS_HASH);
    expect(e.observedAtSeconds).toBe(NOW);
    expect(e.queryUrl).toContain(`/tx/${TXID}`);
  });

  it('counts confirmations as tip delta, not inclusion alone', async () => {
    const fetchImpl = fakeFetch({ tip: 50_009, tx: { status: 200, body: { status: { confirmed: true, block_height: 50_000, block_hash: BLOCK_HASH } } } });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl }), NOW);
    expect(e.status).toBe('confirmed');
    expect(e.confirmations).toBe(10);
  });

  it('respects a higher minConfirmations (pending below it)', async () => {
    const fetchImpl = fakeFetch({ tip: 50_000, tx: { status: 200, body: { status: { confirmed: true, block_height: 50_000, block_hash: BLOCK_HASH } } } });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl, minConfirmations: 6 }), NOW);
    expect(e.status).toBe('pending');
    expect(e.confirmations).toBe(1);
  });
});

describe('probeConfirmation - pending / not_found', () => {
  it('reports pending for an unconfirmed mempool tx', async () => {
    const fetchImpl = fakeFetch({ tip: 50_000, tx: { status: 200, body: { status: { confirmed: false } } } });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl }), NOW);
    expect(e.status).toBe('pending');
    expect(e.confirmations).toBe(0);
    expect(e.blockHash).toBeUndefined();
  });

  it('maps Esplora 400/404 to not_found (API healthy, tx absent) - no claim beyond that', async () => {
    for (const status of [400, 404]) {
      const fetchImpl = fakeFetch({ tip: 50_000, tx: { status } });
      const e = await probeConfirmation(TXID, cfg({ fetchImpl }), NOW);
      expect(e.status).toBe('not_found');
      expect(e.unavailableReason).toBeUndefined();
    }
  });
});

describe('probeConfirmation - honest unavailable', () => {
  it('never claims confirmation when the tx fetch throws', async () => {
    const fetchImpl = fakeFetch({ tx: 'network-error' });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl }), NOW);
    expect(e.status).toBe('unavailable');
    expect(e.confirmations).toBe(0);
    expect(e.unavailableReason).toMatch(/tx fetch failed/);
  });

  it('stays unavailable when the genesis pin fetch fails (no tx evidence without a chain)', async () => {
    const fetchImpl = fakeFetch({ genesis: 'network-error' });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl }), NOW);
    expect(e.status).toBe('unavailable');
    expect(e.unavailableReason).toMatch(/genesis pin/);
  });

  it('maps HTTP 500/503 to unavailable with the status recorded', async () => {
    const fetchImpl = fakeFetch({ tx: { status: 503 } });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl }), NOW);
    expect(e.status).toBe('unavailable');
    expect(e.unavailableReason).toMatch(/503/);
  });

  it('stays unavailable when a confirmed tx reports garbage block fields', async () => {
    const badHeight = fakeFetch({ tip: 50_000, tx: { status: 200, body: { status: { confirmed: true, block_height: 'x', block_hash: BLOCK_HASH } } } });
    expect((await probeConfirmation(TXID, cfg({ fetchImpl: badHeight }), NOW)).status).toBe('unavailable');
    const badHash = fakeFetch({ tip: 50_000, tx: { status: 200, body: { status: { confirmed: true, block_height: 50_000, block_hash: 'zz' } } } });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl: badHash }), NOW);
    expect(e.status).toBe('unavailable');
    expect(e.unavailableReason).toMatch(/block_hash/);
  });

  it('detects a reorg-in-flight (tip below inclusion height) and refuses to count', async () => {
    const fetchImpl = fakeFetch({ tip: 49_999, tx: { status: 200, body: { status: { confirmed: true, block_height: 50_000, block_hash: BLOCK_HASH } } } });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl }), NOW);
    expect(e.status).toBe('unavailable');
    expect(e.unavailableReason).toMatch(/reorg/);
  });

  it('stays unavailable when the tip probe fails after a good tx answer', async () => {
    const fetchImpl = fakeFetch({ tx: { status: 200, body: { status: { confirmed: true, block_height: 50_000, block_hash: BLOCK_HASH } } }, tip: undefined });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl }), NOW);
    expect(e.status).toBe('unavailable');
    expect(e.unavailableReason).toMatch(/tip probe failed/);
  });
});

describe('probeConfirmation - genesis-pin network check (§2)', () => {
  it('THROWS typed network_mismatch when block 0 is not the testnet4 genesis (wrong chain / lying proxy)', async () => {
    const mainnetGenesis = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
    const fetchImpl = fakeFetch({ genesis: mainnetGenesis, tx: { status: 200, body: { status: { confirmed: true } } } });
    await expect(probeConfirmation(TXID, cfg({ fetchImpl }), NOW)).rejects.toThrow(/network_mismatch/);
    await expect(probeConfirmation(TXID, cfg({ fetchImpl }), NOW)).rejects.toThrow(/NOT the pinned chain/);
  });

  it('rejects a non-hash genesis answer as bad_response (not unavailable-silence)', async () => {
    const fetchImpl = fakeFetch({ genesis: 'hello world' });
    const e = await probeConfirmation(TXID, cfg({ fetchImpl }), NOW);
    expect(e.status).toBe('unavailable');
    expect(e.unavailableReason).toMatch(/non-hash/);
  });

  it('rejects malformed txids before any network contact', async () => {
    const fetchImpl = fakeFetch({ tx: { status: 200, body: {} } });
    await expect(probeConfirmation('ZZ'.repeat(32), cfg({ fetchImpl }), NOW)).rejects.toThrow(/malformed_txid/);
    await expect(probeConfirmation(TXID.toUpperCase(), cfg({ fetchImpl }), NOW)).rejects.toThrow(/lowercase/);
  });

  it('rejects a minConfirmations config below 1', async () => {
    await expect(probeConfirmation(TXID, cfg({ minConfirmations: 0 }), NOW)).rejects.toThrow(/bad_config/);
  });
});

describe('applyProbeToDeposit', () => {
  const base: ConfirmationEvidence = {
    rail: 'btc-testnet4',
    txid: TXID,
    status: 'confirmed',
    confirmations: 1,
    genesisHashObserved: BTC_TESTNET4_GENESIS_HASH,
    queryUrl: 'x',
    observedAtSeconds: NOW,
  };

  it('folds confirmed → confirmed; everything else keeps broadcast (no claim either way)', () => {
    expect(applyProbeToDeposit(TXID, base)).toBe('confirmed');
    expect(applyProbeToDeposit(TXID, { ...base, status: 'pending' })).toBe('broadcast');
    expect(applyProbeToDeposit(TXID, { ...base, status: 'not_found' })).toBe('broadcast');
    expect(applyProbeToDeposit(TXID, { ...base, status: 'unavailable', unavailableReason: 'x' })).toBe('broadcast');
  });

  it('refuses evidence for a DIFFERENT txid (evidence must match the deposit)', () => {
    expect(() => applyProbeToDeposit('cc'.repeat(32), base)).toThrow(/does not match/);
  });
});
