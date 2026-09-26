import { describe, expect, it } from 'vitest';
import {
  applySpendToDeposit,
  classifySpend,
  cltvSatisfied,
  DEFAULT_OBSERVE_CONFIG,
  observeSpend,
  tapscriptFromWitness,
  LOCKTIME_THRESHOLD,
  type ObserveConfig,
  type SpendObservation,
} from './testnet4Observe';
import { founderClaimLeaf, donorRefundLeaf, hexToBytes } from './testnet4Taproot';
import { BTC_TESTNET4_GENESIS_HASH } from './testnet4Rail';

// ── Leaf fixtures (real step-2 builders - the module must match THEIR bytes) ─

const FOUNDER_KEY = hexToBytes('dff1e77f7a1d4f2f2e1e1d3c4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7'.slice(0, 64).padEnd(64, '0').slice(0, 64));
const DONOR_KEY = hexToBytes('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0');

// Distinct keys → distinct leaf bytes (the partition classifySpend relies on).
const founderLeaf = founderClaimLeaf(FOUNDER_KEY, 900_000, 'blocks');
const donorLeaf = donorRefundLeaf(DONOR_KEY, 900_072, 'blocks');

const FOUNDER = founderLeaf.script;
const DONOR = donorLeaf.script;

function cfgWith(routes: {
  genesis?: string;
  tx?: unknown | 'network-error';
  block?: unknown | 'network-error';
  tip?: number | 'network-error';
}): ObserveConfig {
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const text = (body: string, status = 200) => new Response(body, { status });
    if (url.endsWith('/block-height/0')) {
      if (routes.genesis === 'network-error') throw new Error('genesis unreachable');
      return text(routes.genesis ?? BTC_TESTNET4_GENESIS_HASH);
    }
    if (url.includes('/blocks/tip/height')) {
      if (routes.tip === 'network-error' || routes.tip === undefined) throw new Error('tip unreachable');
      return text(String(routes.tip));
    }
    if (url.includes('/block/') && !url.includes('/block-height/')) {
      if (routes.block === 'network-error' || routes.block === undefined) throw new Error('block unreachable');
      return new Response(JSON.stringify(routes.block), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/tx/')) {
      if (routes.tx === 'network-error' || routes.tx === undefined) throw new Error('tx unreachable');
      return new Response(JSON.stringify(routes.tx), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected URL ${url}`);
  }) as unknown as typeof fetch;
  return { ...DEFAULT_OBSERVE_CONFIG, fetchImpl };
}

// A confirmed spend tx of the funding output: witness [script, control],
// nLocktime = 900_000 (the CLTV boundary itself).
const SPEND_TXID = 'ab'.repeat(32);
const FUNDING_TXID = 'cd'.repeat(32);
// Real testnet4 block hash shape (fetched from the live API 2026-09-13; fixture only).
const BLOCK_HASH = '00000000be96f98a7a972abc2a1b49c8c9c667cf950b6477386e6df9406fd0f2';
const CONTROL = 'c0' + '11'.repeat(65); // 0xc0 first byte, 66+ bytes

function spendTx(witness: string[], locktime: number, blockHeight = 900_050) {
  return {
    txid: SPEND_TXID,
    locktime,
    vin: [{ txid: FUNDING_TXID, vout: 0, witness, is_coinbase: false }],
    vout: [{ scriptpubkey: '0014' + 'e0'.repeat(20), value: 1 }],
    status: { confirmed: true, block_height: blockHeight, block_hash: BLOCK_HASH, block_time: 1_789_000_000 },
  };
}

// Mined at height 900_050 ≥ 900_000 → height-based CLTV satisfied.
const MINED_HEIGHT = 900_050;
const TIP = 900_060; // 11 confirmations
const MEDIANTIME = 1_789_000_000;

const OBSERVE_INPUT = {
  spendTxid: SPEND_TXID,
  fundingTxid: FUNDING_TXID,
  founderClaimScript: FOUNDER,
  donorRefundScript: DONOR,
  founderClaimLocktime: 900_000,
  donorRefundLocktime: 900_072,
};

const NOW = 1_789_000_500;

describe('cltvSatisfied - BIP-65 semantics with injected clocks', () => {
  it('height-based: block height at target satisfies; below does not', () => {
    expect(cltvSatisfied(900_000, 900_000, MEDIANTIME, 900_000)).toBe(true);
    expect(cltvSatisfied(900_000, 900_000, MEDIANTIME, 899_999)).toBe(false);
    expect(cltvSatisfied(900_050, 900_000, MEDIANTIME, 900_050)).toBe(true);
  });

  it('height-based ignores mediantime entirely (no accidental time path)', () => {
    expect(cltvSatisfied(900_000, 900_000, 0, 900_000)).toBe(true);
    expect(cltvSatisfied(900_000, 900_000, 9_999_999_999, 900_000)).toBe(true);
  });

  it('time-based: mediantime must EXCEED target and nLockTime must be ≥ target', () => {
    const target = LOCKTIME_THRESHOLD + 1_000_000; // unix-time domain
    expect(cltvSatisfied(target, target, target + 1, 9_000_000)).toBe(true);
    expect(cltvSatisfied(target, target, target, 9_000_000)).toBe(false); // must be strictly greater
    expect(cltvSatisfied(target, target, target + 10_000, 9_000_000)).toBe(true);
    // nLockTime below the target fails even with a far-future mediantime.
    expect(cltvSatisfied(target - 1, target, target + 10_000, 9_000_000)).toBe(false);
  });

  it('domain split at the threshold matches the step-2 leaf builders', () => {
    expect(LOCKTIME_THRESHOLD).toBe(500_000_000);
  });
});

describe('classifySpend - witness-only path decision (pure)', () => {
  it('founder leaf bytes → founder_claim when its CLTV is satisfied by the block', () => {
    expect(
      classifySpend({
        revealedScript: FOUNDER,
        spendTxLocktime: 900_000,
        blockMediantimeSeconds: MEDIANTIME,
        blockHeight: MINED_HEIGHT,
        founderClaimScript: FOUNDER,
        donorRefundScript: DONOR,
        founderClaimLocktime: 900_000,
        donorRefundLocktime: 900_072,
      }),
    ).toBe('founder_claim');
  });

  it('donor leaf bytes → donor_refund when its CLTV is satisfied', () => {
    expect(
      classifySpend({
        revealedScript: DONOR,
        spendTxLocktime: 900_072,
        blockMediantimeSeconds: MEDIANTIME,
        blockHeight: 900_072, // donor CLTV boundary - mined at/after target
        founderClaimScript: FOUNDER,
        donorRefundScript: DONOR,
        founderClaimLocktime: 900_000,
        donorRefundLocktime: 900_072,
      }),
    ).toBe('donor_refund');
  });

  it('a script matching NEITHER authorized leaf → foreign', () => {
    expect(
      classifySpend({
        revealedScript: hexToBytes('face' + '00'.repeat(30)),
        spendTxLocktime: 0,
        blockMediantimeSeconds: MEDIANTIME,
        blockHeight: MINED_HEIGHT,
        founderClaimScript: FOUNDER,
        donorRefundScript: DONOR,
        founderClaimLocktime: 900_000,
        donorRefundLocktime: 900_072,
      }),
    ).toBe('foreign');
  });

  it('script match + CLTV unsatisfied by the mined block = loud typed error (consensus impossibility)', () => {
    // Donor leaf unlocks at 900_072 but the block is 900_050.
    expect(() =>
      classifySpend({
        revealedScript: DONOR,
        spendTxLocktime: 900_072,
        blockMediantimeSeconds: MEDIANTIME,
        blockHeight: MINED_HEIGHT,
        founderClaimScript: FOUNDER,
        donorRefundScript: DONOR,
        founderClaimLocktime: 900_000,
        donorRefundLocktime: 900_072,
      }),
    ).toThrow(/CLTV.*unsatisfied|unsatisfied/);
  });

  it('the two authorized leaves are byte-distinct (the partition is real)', () => {
    expect(Buffer.from(FOUNDER).equals(Buffer.from(DONOR))).toBe(false);
  });
});

describe('tapscriptFromWitness - BIP-341 witness shapes ([args…, script, control(, annex)])', () => {
  it('extracts the script from [sig, script, control] - the REAL mined shape (tx e97a7d3e…)', () => {
    // Sizes from the live testnet4 claim spend: 64B sig, 39B script, 129B CB.
    const sig = 'e0' + '11'.repeat(63);
    expect(tapscriptFromWitness([sig, 'abcd', CONTROL])).toBe('abcd');
  });

  it('extracts the script from [sig, script, control, annex]', () => {
    const sig = 'e0' + '11'.repeat(63);
    expect(tapscriptFromWitness([sig, 'abcd', CONTROL, '50' + '00'])).toBe('abcd');
  });

  it('extracts from a keyless [script, control] stack (exotic but valid)', () => {
    expect(tapscriptFromWitness(['abcd', CONTROL])).toBe('abcd');
  });

  it('does NOT confuse a 32-byte pubkey arg for the control block', () => {
    // args = [32B pubkey] → [pubkey, script, control]: script is item 1.
    const pub = 'ab'.repeat(32);
    expect(tapscriptFromWitness([pub, 'abcd', CONTROL])).toBe('abcd');
  });

  it('rejects non-taproot shapes: too few items, wrong control first byte, oversized', () => {
    expect(tapscriptFromWitness(['abcd'])).toBeNull();
    expect(tapscriptFromWitness(['abcd', 'ff' + '11'.repeat(65)])).toBeNull(); // control must start 0xc0-0xc3
    expect(tapscriptFromWitness(['abcd', CONTROL, '01', '02'])).toBeNull(); // two items after CB
    expect(tapscriptFromWitness([])).toBeNull();
  });

  it('lowercases the returned hex', () => {
    expect(tapscriptFromWitness(['a'.repeat(64), 'ABCD', CONTROL])).toBe('abcd');
  });
});

describe('observeSpend - networked fold over a fake Esplora', () => {
  it('classifies a confirmed founder-claim spend end to end', async () => {
    const cfg = cfgWith({
      // REAL mined shape: [64B sig, script, control] (tx e97a7d3e3bb0…).
      tx: spendTx(['e0' + '11'.repeat(63), Buffer.from(FOUNDER).toString('hex'), CONTROL], 900_000),
      block: { id: BLOCK_HASH, mediantime: MEDIANTIME, height: MINED_HEIGHT },
      tip: TIP,
    });
    const o = await observeSpend({ ...OBSERVE_INPUT, cfg }, NOW);
    expect(o.path).toBe('founder_claim');
    expect(o.confirmations).toBe(TIP - MINED_HEIGHT + 1);
    expect(o.blockHash).toBe(BLOCK_HASH);
    expect(o.blockMediantimeSeconds).toBe(MEDIANTIME);
    expect(o.spendTxLocktime).toBe(900_000);
    expect(o.revealedScriptHex).toBe(Buffer.from(FOUNDER).toString('hex'));
    expect(o.genesisHashObserved).toBe(BTC_TESTNET4_GENESIS_HASH);
    expect(o.observedAtSeconds).toBe(NOW);
    expect(o.unavailableReason).toBeUndefined();
  });

  it('classifies a confirmed donor-refund spend end to end', async () => {
    const cfg = cfgWith({
      tx: spendTx([Buffer.from(DONOR).toString('hex'), CONTROL], 900_072, 900_072), // mined at the donor CLTV boundary
      block: { id: BLOCK_HASH, mediantime: MEDIANTIME, height: MINED_HEIGHT + 100 },
      tip: TIP + 100,
    });
    const o = await observeSpend({ ...OBSERVE_INPUT, cfg }, NOW);
    expect(o.path).toBe('donor_refund');
  });

  it('records foreign spends honestly instead of ignoring them', async () => {
    const cfg = cfgWith({
      tx: spendTx(['face' + '00'.repeat(30), CONTROL], 0),
      block: { id: BLOCK_HASH, mediantime: MEDIANTIME, height: MINED_HEIGHT },
      tip: TIP,
    });
    const o = await observeSpend({ ...OBSERVE_INPUT, cfg }, NOW);
    expect(o.path).toBe('foreign');
  });

  it('refuses to decide from mempool: unconfirmed spend → unavailable', async () => {
    const tx = spendTx([Buffer.from(FOUNDER).toString('hex'), CONTROL], 900_000);
    (tx as { status: { confirmed: boolean } }).status.confirmed = false;
    const cfg = cfgWith({ tx, block: { mediantime: MEDIANTIME }, tip: TIP });
    const o = await observeSpend({ ...OBSERVE_INPUT, cfg }, NOW);
    expect(o.unavailableReason).toMatch(/not confirmed/);
  });

  it('a spending tx that does not consume THIS funding tx → unavailable', async () => {
    const tx = spendTx([Buffer.from(FOUNDER).toString('hex'), CONTROL], 900_000);
    (tx as { vin: Array<{ txid: string }> }).vin[0].txid = 'ef'.repeat(32);
    const cfg = cfgWith({
      tx,
      block: { mediantime: MEDIANTIME },
      tip: TIP,
    });
    const o = await observeSpend({ ...OBSERVE_INPUT, cfg }, NOW);
    expect(o.unavailableReason).toMatch(/no input consuming funding tx/);
  });

  it('reorg in flight (tip below spend block) → unavailable, never counted', async () => {
    const cfg = cfgWith({
      tx: spendTx([Buffer.from(FOUNDER).toString('hex'), CONTROL], 900_000),
      block: { mediantime: MEDIANTIME },
      tip: MINED_HEIGHT - 1,
    });
    const o = await observeSpend({ ...OBSERVE_INPUT, cfg }, NOW);
    expect(o.unavailableReason).toMatch(/reorg/);
  });

  it('all transport failures → honest unavailable with the stage named', async () => {
    const a = await observeSpend({ ...OBSERVE_INPUT, cfg: cfgWith({ genesis: 'network-error' }) }, NOW);
    expect(a.unavailableReason).toMatch(/genesis pin/);
    const b = await observeSpend({ ...OBSERVE_INPUT, cfg: cfgWith({ tx: 'network-error', tip: TIP, block: {} }) }, NOW);
    expect(b.unavailableReason).toMatch(/spend tx fetch failed/);
    const c = await observeSpend({ ...OBSERVE_INPUT, cfg: cfgWith({ tx: spendTx([Buffer.from(FOUNDER).toString('hex'), CONTROL], 900_000), block: 'network-error', tip: TIP }) }, NOW);
    expect(c.unavailableReason).toMatch(/block header fetch failed/);
    const d = await observeSpend({ ...OBSERVE_INPUT, cfg: cfgWith({ tx: spendTx([Buffer.from(FOUNDER).toString('hex'), CONTROL], 900_000), block: { mediantime: MEDIANTIME }, tip: 'network-error' }) }, NOW);
    expect(d.unavailableReason).toMatch(/tip probe failed/);
  });

  it('wrong chain (genesis mismatch) THROWS network_mismatch - never evidence from another chain', async () => {
    const cfg = cfgWith({
      genesis: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
      tx: spendTx([Buffer.from(FOUNDER).toString('hex'), CONTROL], 900_000),
      block: { mediantime: MEDIANTIME },
      tip: TIP,
    });
    await expect(observeSpend({ ...OBSERVE_INPUT, cfg }, NOW)).rejects.toThrow(/network_mismatch/);
  });

  it('malformed txids are rejected before any network contact', async () => {
    const cfg = cfgWith({ tip: TIP });
    await expect(observeSpend({ ...OBSERVE_INPUT, spendTxid: 'ZZ'.repeat(32), cfg }, NOW)).rejects.toThrow(/malformed_txid/);
  });

  it('block missing mediantime → unavailable (CLTV needs consensus time, not a guess)', async () => {
    const cfg = cfgWith({
      tx: spendTx([Buffer.from(FOUNDER).toString('hex'), CONTROL], 900_000),
      block: { id: BLOCK_HASH },
      tip: TIP,
    });
    const o = await observeSpend({ ...OBSERVE_INPUT, cfg }, NOW);
    expect(o.unavailableReason).toMatch(/mediantime/);
  });
});

describe('applySpendToDeposit - lifecycle fold (pure)', () => {
  const obs = (path: SpendObservation['path'], spendTxid = SPEND_TXID): SpendObservation => ({
    rail: 'btc-testnet4',
    spendTxid,
    path,
    confirmations: 1,
    blockHash: BLOCK_HASH,
    blockHeight: MINED_HEIGHT,
    blockMediantimeSeconds: MEDIANTIME,
    spendTxLocktime: 900_000,
    revealedScriptHex: 'abcd',
    genesisHashObserved: BTC_TESTNET4_GENESIS_HASH,
    queryUrl: 'x',
    observedAtSeconds: NOW,
  });

  it('maps founder_claim → spent_claim; donor_refund → spent_refund; foreign → foreign_spend', () => {
    expect(applySpendToDeposit(FUNDING_TXID, obs('founder_claim'))).toBe('spent_claim');
    expect(applySpendToDeposit(FUNDING_TXID, obs('donor_refund'))).toBe('spent_refund');
    expect(applySpendToDeposit(FUNDING_TXID, obs('foreign'))).toBe('foreign_spend');
  });

  it('refuses evidence whose spend txid equals the funding txid', () => {
    expect(() => applySpendToDeposit(FUNDING_TXID, obs('founder_claim', FUNDING_TXID))).toThrow(/bad_state/);
  });
});
