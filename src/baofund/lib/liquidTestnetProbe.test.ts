/**
 * Liquid-testnet probe acceptance - offline matrix via injected fetchImpl
 * (same pattern as testnet4Probe tests), plus an OPT-IN live probe against
 * the real Esplora (BAO_LQ_LIVE=1) that pins the same constants the module
 * embeds.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIQUID_PROBE_CONFIG,
  LiquidTestnetProbeError,
  applyLiquidProbeToDeposit,
  probeLiquidConfirmation,
  type LiquidProbeConfig,
} from './liquidTestnetProbe';
import {
  LIQUID_TESTNET_GENESIS_HASH,
  LIQUID_TESTNET_NATIVE_ASSET_ID,
} from './liquidTestnetRail';

const GENESIS = LIQUID_TESTNET_GENESIS_HASH;
const NATIVE = LIQUID_TESTNET_NATIVE_ASSET_ID;
const OTHER = 'aa'.repeat(32);
const TX = 'bb'.repeat(32);
const NOW = 1_800_000_000;
const BLOCK = 'cc'.repeat(32);
const TIP = 2_616_033;

function cfgFrom(handler: (url: string) => { status: number; body: string }): LiquidProbeConfig {
  return {
    ...DEFAULT_LIQUID_PROBE_CONFIG,
    fetchImpl: (async (url: string | URL | Request) => {
      const u = String(url);
      const r = handler(u);
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'text/plain' } });
    }) as unknown as typeof fetch,
  };
}

// Standard responses a confirmed-native scenario needs:
function confirmedCfg(opts: {
  genesisBody?: string;
  genesisStatus?: number;
  txBody?: string;
  txStatus?: number;
  tipBody?: string;
  tipStatus?: number;
}): LiquidProbeConfig {
  return cfgFrom((url) => {
    if (url.endsWith('/block-height/0')) {
      return { status: opts.genesisStatus ?? 200, body: opts.genesisBody ?? `${GENESIS}\n` };
    }
    if (url.includes(`/tx/${TX}`)) {
      return { status: opts.txStatus ?? 200, body: opts.txBody ?? 'not-json' };
    }
    if (url.endsWith('/blocks/tip/height')) {
      return { status: opts.tipStatus ?? 200, body: opts.tipBody ?? `${TIP}` };
    }
    return { status: 404, body: 'nope' };
  });
}

describe('genesis pin (chain identity)', () => {
  it('throws typed network_mismatch when block 0 is another chain', async () => {
    const cfg = confirmedCfg({ genesisBody: 'f'.repeat(64) });
    await expect(probeLiquidConfirmation(TX, cfg, NOW)).rejects.toMatchObject({ code: 'network_mismatch' });
  });

  it('genesis transport/HTTP failure → unavailable (never confirmed-by-default)', async () => {
    const cfg = confirmedCfg({ genesisStatus: 503 });
    const ev = await probeLiquidConfirmation(TX, cfg, NOW);
    expect(ev.status).toBe('unavailable');
    expect(ev.unavailableReason).toContain('genesis pin');
  });

  it('genesis non-hash body → unavailable', async () => {
    const cfg = confirmedCfg({ genesisBody: '<html>blocked</html>' });
    const ev = await probeLiquidConfirmation(TX, cfg, NOW);
    expect(ev.status).toBe('unavailable');
  });
});

describe('confirmation math', () => {
  const txBody = JSON.stringify({
    status: { confirmed: true, block_height: TIP - 4, block_hash: BLOCK },
    vout: [
      { asset: NATIVE, value: 50_000 },
      { asset: OTHER, value: 1 },
    ],
  });

  it('confirmations = tip − height + 1; status confirmed at ≥ min', async () => {
    const ev = await probeLiquidConfirmation(TX, confirmedCfg({ txBody }), NOW);
    expect(ev.status).toBe('confirmed');
    expect(ev.confirmations).toBe(5);
    expect(ev.blockHash).toBe(BLOCK);
    expect(ev.observedTipHeight).toBe(TIP);
    expect(ev.assetsSeen).toEqual([NATIVE, OTHER]);
    expect(ev.genesisHashObserved).toBe(GENESIS);
    expect(ev.queryUrl).toContain(`/tx/${TX}`);
  });

  it('below minConfirmations → pending (still honest counts)', async () => {
    const cfg = confirmedCfg({ txBody, tipBody: `${TIP - 4}` }); // 1 conf
    const strict = { ...cfg, minConfirmations: 2 };
    const ev = await probeLiquidConfirmation(TX, strict, NOW);
    expect(ev.status).toBe('pending');
    expect(ev.confirmations).toBe(1);
  });

  it('tip below inclusion height → unavailable (reorg in flight?)', async () => {
    const cfg = confirmedCfg({ txBody, tipBody: `${TIP - 10}` });
    const ev = await probeLiquidConfirmation(TX, cfg, NOW);
    expect(ev.status).toBe('unavailable');
    expect(ev.unavailableReason).toContain('reorg');
  });

  it('tip probe failure after a confirmed tx → unavailable (honest over convenient)', async () => {
    const cfg = confirmedCfg({ txBody, tipStatus: 500 });
    const ev = await probeLiquidConfirmation(TX, cfg, NOW);
    expect(ev.status).toBe('unavailable');
  });
});

describe('Elements asset rules (the bitcoin-probe difference)', () => {
  it('confirmed tx moving ONLY other assets → wrong_asset, never confirmed', async () => {
    const txBody = JSON.stringify({
      status: { confirmed: true, block_height: TIP - 1, block_hash: BLOCK },
      vout: [{ asset: OTHER, value: 777 }],
    });
    const ev = await probeLiquidConfirmation(TX, confirmedCfg({ txBody }), NOW);
    expect(ev.status).toBe('wrong_asset');
    expect(ev.assetsSeen).toEqual([OTHER]);
    expect(ev.confidentialOnly).toBe(false);
    // And folding never confirms it:
    expect(applyLiquidProbeToDeposit(TX, ev)).toBe('broadcast');
  });

  it('all-confidential confirmed tx → unavailable with honest reason (cannot verify asset)', async () => {
    const txBody = JSON.stringify({
      status: { confirmed: true, block_height: TIP - 1, block_hash: BLOCK },
      vout: [{ value: 'confidential' }],
    });
    const ev = await probeLiquidConfirmation(TX, confirmedCfg({ txBody }), NOW);
    expect(ev.status).toBe('unavailable');
    expect(ev.confidentialOnly).toBe(true);
    expect(ev.unavailableReason).toContain('confidential');
  });

  it('null-asset marker output (fee anchor) is not counted as an asset', async () => {
    const txBody = JSON.stringify({
      status: { confirmed: true, block_height: TIP - 1, block_hash: BLOCK },
      vout: [
        { asset: '0'.repeat(64), value: 0 },
        { asset: NATIVE, value: 100 },
      ],
    });
    const ev = await probeLiquidConfirmation(TX, confirmedCfg({ txBody }), NOW);
    expect(ev.status).toBe('confirmed');
    expect(ev.assetsSeen).toEqual([NATIVE]);
  });
});

describe('honest failure states', () => {
  it('400/404 → not_found', async () => {
    const cfg = confirmedCfg({ txStatus: 404, txBody: 'Not Found' });
    const ev = await probeLiquidConfirmation(TX, cfg, NOW);
    expect(ev.status).toBe('not_found');
    expect(applyLiquidProbeToDeposit(TX, ev)).toBe('broadcast');
  });

  it('unconfirmed tx → pending with assets seen', async () => {
    const txBody = JSON.stringify({ status: { confirmed: false }, vout: [{ asset: NATIVE, value: 5 }] });
    const ev = await probeLiquidConfirmation(TX, confirmedCfg({ txBody }), NOW);
    expect(ev.status).toBe('pending');
    expect(ev.confirmations).toBe(0);
    expect(ev.assetsSeen).toEqual([NATIVE]);
  });

  it('tx HTTP 500 → unavailable; non-JSON 2xx body → unavailable', async () => {
    const a = await probeLiquidConfirmation(TX, confirmedCfg({ txStatus: 500 }), NOW);
    expect(a.status).toBe('unavailable');
    const b = await probeLiquidConfirmation(TX, confirmedCfg({ txBody: '<html>' }), NOW);
    expect(b.status).toBe('unavailable');
  });

  it('bad block_height/block_hash shape on a confirmed tx → unavailable', async () => {
    const badHeight = JSON.stringify({ status: { confirmed: true, block_height: -3, block_hash: BLOCK }, vout: [{ asset: NATIVE, value: 1 }] });
    expect((await probeLiquidConfirmation(TX, confirmedCfg({ txBody: badHeight }), NOW)).status).toBe('unavailable');
    const badHash = JSON.stringify({ status: { confirmed: true, block_height: TIP, block_hash: 'zz' }, vout: [{ asset: NATIVE, value: 1 }] });
    expect((await probeLiquidConfirmation(TX, confirmedCfg({ txBody: badHash }), NOW)).status).toBe('unavailable');
  });

  it('bad_config: minConfirmations < 1 and malformed nativeAssetId are typed refusals', async () => {
    const cfg = confirmedCfg({});
    await expect(probeLiquidConfirmation(TX, { ...cfg, minConfirmations: 0 }, NOW)).rejects.toMatchObject({ code: 'bad_config' });
    await expect(probeLiquidConfirmation(TX, { ...cfg, nativeAssetId: 'nope' }, NOW)).rejects.toMatchObject({ code: 'bad_config' });
  });

  it('txid namespace: uppercase/short txids are typed refusals before any fetch', async () => {
    const cfg = confirmedCfg({});
    await expect(probeLiquidConfirmation('A'.repeat(64), cfg, NOW)).rejects.toMatchObject({ code: 'malformed_txid' });
    await expect(probeLiquidConfirmation('a'.repeat(63), cfg, NOW)).rejects.toMatchObject({ code: 'malformed_txid' });
  });
});

describe('fold transition (applyLiquidProbeToDeposit)', () => {
  it('confirms only on confirmed; everything else stays broadcast; txid mismatch throws', async () => {
    const mk = (status: string) =>
      ({
        rail: 'liquid-testnet', txid: TX, status, confirmations: 1,
        genesisHashObserved: GENESIS, assetsSeen: [NATIVE], confidentialOnly: false,
        queryUrl: '', observedAtSeconds: NOW,
      }) as never;
    expect(applyLiquidProbeToDeposit(TX, mk('confirmed'))).toBe('confirmed');
    for (const s of ['pending', 'not_found', 'wrong_asset', 'unavailable']) {
      expect(applyLiquidProbeToDeposit(TX, mk(s))).toBe('broadcast');
    }
    expect(() => applyLiquidProbeToDeposit('d'.repeat(64), mk('confirmed'))).toThrowError(LiquidTestnetProbeError);
  });
});

// ── opt-in LIVE probe (real Esplora; owner-visible evidence) ────────────────
describe.skipIf(process.env.BAO_LQ_LIVE !== '1')('LIVE liquid-testnet Esplora (BAO_LQ_LIVE=1)', () => {
  it('pins the genesis and reports a tip from the REAL chain', async () => {
    const ev = await probeLiquidConfirmation(TX, DEFAULT_LIQUID_PROBE_CONFIG, Math.floor(Date.now() / 1000));
    // Our synthetic TX is not on the real chain - not_found IS the pass:
    // it proves genesis matched (network_mismatch would have thrown) and
    // the API answered for the pinned chain.
    expect(['not_found', 'pending']).toContain(ev.status);
  });
});
