// @vitest-environment node
/**
 * liquidTestnetAccount tests — key/address parity with bao.markets is the
 * core contract (vectors generated from the markets implementation on this
 * machine, 2026-09-22). Explorer reads are injected; the confidential path
 * uses an injected unblinder so the suite never initialises the zkp wasm.
 */
import { describe, expect, it } from 'vitest';
import { address as liquidAddress, networks, payments, script as liquidScript, Transaction, type TxOutput } from 'liquidjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import { LIQUID_TESTNET_NATIVE_ASSET_ID, validateLiquidTestnetAddress } from '../../lib/liquidTestnetRail';
import {
  deriveLiquidTestnetAccount,
  deriveLiquidTestnetAccountFromSeed,
  estimateLiquidVsize,
  generateLiquidTestnetMnemonic,
  importLiquidTestnetAccountFromMnemonic,
  sendLiquidTestnet,
  scanLiquidTestnetUtxos,
  unblindLiquidOutput,
  LIQUID_TESTNET_FEE_RATE_SAT_VB,
  type LiquidUtxo,
} from './liquidTestnetAccount';

const BASE = 'https://blockstream.info/liquidtestnet/api';
const NATIVE = LIQUID_TESTNET_NATIVE_ASSET_ID;
const SEED = new Uint8Array(32).fill(0x22);
const WIRE_ASSET = Uint8Array.from(Buffer.from(NATIVE, 'hex').reverse());

const assetBuf = (displayHex: string): Buffer => Buffer.concat([Buffer.from([1]), Buffer.from(displayHex, 'hex').reverse()]);
const valueBuf = (n: number): Buffer => Buffer.concat([Buffer.from([1]), Buffer.from(n.toString(16).padStart(16, '0'), 'hex')]);

const json = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const text = (body: string, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => body }) as unknown as Response;

function fetchFor(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}`;
    const route = routes[key] ?? routes[String(input)];
    if (!route) throw new Error(`unexpected fetch: ${key}`);
    return route();
  }) as unknown as typeof fetch;
}

function fundingTx(script: Uint8Array, valueSats: number, opts: { asset?: string; confidential?: boolean } = {}): Transaction {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, 7), 0, 0xffffffff, Buffer.alloc(0));
  if (opts.confidential) {
    tx.addOutput(
      Buffer.from(script),
      Buffer.concat([Buffer.from([0x08]), Buffer.alloc(32, 3)]),
      Buffer.concat([Buffer.from([0x0a]), Buffer.alloc(32, 4)]),
      Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 5)]),
      Buffer.alloc(3, 1),
      Buffer.alloc(3, 2),
    );
  } else {
    tx.addOutput(Buffer.from(script), valueBuf(valueSats), assetBuf(opts.asset ?? NATIVE), Buffer.from([0]));
  }
  return tx;
}

// ── parity ───────────────────────────────────────────────────────────────────

describe('liquidTestnetAccount — markets parity vectors', () => {
  it('derives the same key material and addresses as bao.markets', () => {
    const account = deriveLiquidTestnetAccountFromSeed(SEED, 0);
    expect(Buffer.from(account.spendPrivateKey).toString('hex')).toBe('6cf3f851297eb1d1de22ba071828d76772d979c4a451ff4718ec9c9f98bf1c4a');
    expect(Buffer.from(account.spendPublicKey).toString('hex')).toBe('0395718e10a43f0448064ec8aea9328db1a0e8076b17fc4be033c96271fc5c6779');
    expect(Buffer.from(account.blindingPrivateKey).toString('hex')).toBe('6a9702619321bc040daaeb4ea4c99ace15c3ea6b8a18c874d9a257b9ecc45f4a');
    expect(Buffer.from(account.blindingPublicKey).toString('hex')).toBe('02f236cd6aaf49955277b2309465cf9562920790bec415873a27e14753d3cbcb64');
    expect(account.unconfidentialAddress).toBe('tex1qsxp05t96708chlu4ksrken0c77ha9teyjjccmw');
    expect(account.confidentialAddress).toBe(
      'tlq1qqterdnt24aye25nhkgcfgew0j43fypushmzptpe6yls5w57ne09kfqvzlgkt4u7030letdq8dnxl3aa062hjgjvywmh0qp44d',
    );
    expect(account.index).toBe(0);
  });

  it('index 1 differs and matches the markets vector', () => {
    const account = deriveLiquidTestnetAccountFromSeed(SEED, 1);
    expect(Buffer.from(account.spendPublicKey).toString('hex')).toBe('03d12689aff33aeba2c7b5c27744bcef0a56ac7d6c09959dfe5e71dce147f346e2');
    expect(account.unconfidentialAddress).toBe('tex1qs9kmp6gjhtk4f502s8z4gdrqls8zp26k0qv2sk');
  });

  it('derives from the identity secret hex identically to the raw seed', () => {
    const fromHex = deriveLiquidTestnetAccount('22'.repeat(32));
    const fromSeed = deriveLiquidTestnetAccountFromSeed(SEED);
    expect(Buffer.from(fromHex.spendPrivateKey).toString('hex')).toBe(Buffer.from(fromSeed.spendPrivateKey).toString('hex'));
    expect(fromHex.confidentialAddress).toBe(fromSeed.confidentialAddress);
    expect(() => deriveLiquidTestnetAccount('22'.repeat(31))).toThrow(/64 lowercase hex/);
  });

  it('initialises the real secp256k1-zkp unblinder (wasm smoke)', async () => {
    // A malformed output must fail INSIDE the wasm path, not with the
    // factory-unavailable guard - proving the real unblinder is loadable.
    const bogus = {
      value: Buffer.concat([Buffer.from([0x08]), Buffer.alloc(32, 3)]),
      asset: Buffer.concat([Buffer.from([0x0a]), Buffer.alloc(32, 4)]),
      nonce: Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 5)]),
      script: Buffer.alloc(22),
      rangeProof: Buffer.alloc(3, 1),
      surjectionProof: Buffer.alloc(3, 2),
    } as unknown as TxOutput;
    await expect(unblindLiquidOutput(bogus, new Uint8Array(32).fill(9))).rejects.not.toThrow(/factory unavailable/);
  });

  it('produces addresses the rail validator accepts (unconfidential)', () => {
    const account = deriveLiquidTestnetAccountFromSeed(SEED);
    expect(() => validateLiquidTestnetAddress(account.unconfidentialAddress)).not.toThrow();
    // The settlement rail stays unconfidential-only: a tlq1 destination is
    // rejected (long confidential form trips the rail's length guard before
    // its prefix classifier; either way it is never accepted).
    expect(() => validateLiquidTestnetAddress(account.confidentialAddress)).toThrow();
  });
});

// ── created/imported mnemonic wallets ────────────────────────────────────────

describe('liquidTestnetAccount — mnemonic import/generate', () => {
  const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  it('imports a BIP-39 phrase through mnemonicToSeed and the frozen derivation', () => {
    const account = importLiquidTestnetAccountFromMnemonic(MNEMONIC);
    // BIP-39 seed → sha256 → the frozen 32-byte label derivation.
    const expected = deriveLiquidTestnetAccountFromSeed(sha256(mnemonicToSeedSync(MNEMONIC)));
    expect(account.confidentialAddress).toBe(expected.confidentialAddress);
    expect(account.unconfidentialAddress).toBe(expected.unconfidentialAddress);
    // Normalization: case + whitespace do not change the derived pair.
    const messy = importLiquidTestnetAccountFromMnemonic(`  ${MNEMONIC.toUpperCase().replace(/ /g, '   ')}  `);
    expect(messy.confidentialAddress).toBe(account.confidentialAddress);
  });

  it('rejects malformed and unknown-word phrases', () => {
    expect(() => importLiquidTestnetAccountFromMnemonic('abandon abandon abandon')).toThrow(/Invalid mnemonic/);
    expect(() =>
      importLiquidTestnetAccountFromMnemonic(
        'zzzz abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      ),
    ).toThrow(/Invalid mnemonic/);
  });

  it('generates a fresh mnemonic that derives a valid address pair', () => {
    const mnemonic = generateLiquidTestnetMnemonic(12);
    expect(mnemonic.split(' ')).toHaveLength(12);
    const account = importLiquidTestnetAccountFromMnemonic(mnemonic);
    expect(account.confidentialAddress.startsWith('tlq1')).toBe(true);
    expect(account.unconfidentialAddress.startsWith('tex1')).toBe(true);
    expect(() => validateLiquidTestnetAddress(account.unconfidentialAddress)).not.toThrow();
    expect(generateLiquidTestnetMnemonic(24).split(' ')).toHaveLength(24);
    // Two generations differ (fresh entropy, not a fixed phrase).
    expect(generateLiquidTestnetMnemonic(12)).not.toBe(mnemonic);
  });
});

// ── scan ─────────────────────────────────────────────────────────────────────

describe('liquidTestnetAccount — UTXO scan', () => {
  it('reads an explicit LBTC UTXO from the funding transaction', async () => {
    const account = deriveLiquidTestnetAccountFromSeed(SEED);
    const tx = fundingTx(liquidAddress.toOutputScript(account.unconfidentialAddress, networks.testnet), 100_000);
    const txid = tx.getId();
    const routes: Record<string, () => Response> = {
      [`${BASE}/address/${account.confidentialAddress}/utxo`]: () => json([]),
      [`${BASE}/address/${account.unconfidentialAddress}/utxo`]: () =>
        json([{ txid, vout: 0, status: { confirmed: true, block_height: 42 } }]),
      [`${BASE}/tx/${txid}/hex`]: () => text(tx.toHex()),
    };
    const utxos = await scanLiquidTestnetUtxos(account, { fetchFn: fetchFor(routes), baseUrl: BASE });
    expect(utxos).toHaveLength(1);
    expect(utxos[0]).toMatchObject({ txid, vout: 0, value: 100_000, confidential: false, address: account.unconfidentialAddress });
    expect(Buffer.from(utxos[0].assetCommitment).toString('hex')).toBe(assetBuf(NATIVE).toString('hex'));
  });

  it('unblinds a confidential UTXO with the account blinding key', async () => {
    const account = deriveLiquidTestnetAccountFromSeed(SEED);
    const tx = fundingTx(liquidAddress.toOutputScript(account.confidentialAddress, networks.testnet), 0, { confidential: true });
    const txid = tx.getId();
    const routes: Record<string, () => Response> = {
      [`${BASE}/address/${account.confidentialAddress}/utxo`]: () => json([{ txid, vout: 0, status: { confirmed: false, block_height: null } }]),
      [`${BASE}/address/${account.unconfidentialAddress}/utxo`]: () => json([]),
      [`${BASE}/tx/${txid}/hex`]: () => text(tx.toHex()),
    };
    const seenKeys: string[] = [];
    const utxos = await scanLiquidTestnetUtxos(account, {
      fetchFn: fetchFor(routes),
      baseUrl: BASE,
      unblind: async (_out: TxOutput, key: Uint8Array) => {
        seenKeys.push(Buffer.from(key).toString('hex'));
        return {
          valueSats: 42_000,
          assetId: NATIVE,
          asset: WIRE_ASSET,
          assetBlindingFactor: new Uint8Array(32).fill(0xab),
          valueBlindingFactor: new Uint8Array(32).fill(0xcd),
        };
      },
    });
    expect(seenKeys).toEqual([Buffer.from(account.blindingPrivateKey).toString('hex')]);
    expect(utxos).toHaveLength(1);
    expect(utxos[0]).toMatchObject({ value: 42_000, confidential: true, address: account.confidentialAddress });
    expect(Buffer.from(utxos[0].assetBlindingFactor).toString('hex')).toBe('ab'.repeat(32));
    expect(Buffer.from(utxos[0].valueBlindingFactor).toString('hex')).toBe('cd'.repeat(32));
    expect(Buffer.from(utxos[0].assetWire).toString('hex')).toBe(Buffer.from(WIRE_ASSET).toString('hex'));
  });

  it('counts a UTXO once when Esplora lists it under both address forms', async () => {
    // A confidential output has the same script as its unconfidential form,
    // so both address endpoints return the same outpoint. Counting it twice
    // doubled the balance (live-caught on the first faucet-funded wallet).
    const account = deriveLiquidTestnetAccountFromSeed(SEED);
    const tx = fundingTx(liquidAddress.toOutputScript(account.confidentialAddress, networks.testnet), 0, { confidential: true });
    const txid = tx.getId();
    const entry = { txid, vout: 0, status: { confirmed: true, block_height: 9 } };
    const routes: Record<string, () => Response> = {
      [`${BASE}/address/${account.confidentialAddress}/utxo`]: () => json([entry]),
      [`${BASE}/address/${account.unconfidentialAddress}/utxo`]: () => json([entry]),
      [`${BASE}/tx/${txid}/hex`]: () => text(tx.toHex()),
    };
    let unblindCalls = 0;
    const utxos = await scanLiquidTestnetUtxos(account, {
      fetchFn: fetchFor(routes),
      baseUrl: BASE,
      unblind: async () => {
        unblindCalls += 1;
        return {
          valueSats: 100_000,
          assetId: NATIVE,
          asset: WIRE_ASSET,
          assetBlindingFactor: new Uint8Array(32),
          valueBlindingFactor: new Uint8Array(32),
        };
      },
    });
    expect(utxos).toHaveLength(1);
    expect(utxos[0]).toMatchObject({ txid, vout: 0, value: 100_000 });
    expect(unblindCalls).toBe(1);
  });

  it('ignores UTXOs that do not move the native asset', async () => {
    const account = deriveLiquidTestnetAccountFromSeed(SEED);
    const tx = fundingTx(liquidAddress.toOutputScript(account.unconfidentialAddress, networks.testnet), 100_000, { asset: 'ab'.repeat(32) });
    const txid = tx.getId();
    const routes: Record<string, () => Response> = {
      [`${BASE}/address/${account.confidentialAddress}/utxo`]: () => json([]),
      [`${BASE}/address/${account.unconfidentialAddress}/utxo`]: () => json([{ txid, vout: 0, status: { confirmed: true, block_height: 1 } }]),
      [`${BASE}/tx/${txid}/hex`]: () => text(tx.toHex()),
    };
    expect(await scanLiquidTestnetUtxos(account, { fetchFn: fetchFor(routes), baseUrl: BASE })).toEqual([]);
  });

  it('refuses a funding tx whose parsed id does not match the utxo entry', async () => {
    const account = deriveLiquidTestnetAccountFromSeed(SEED);
    const tx = fundingTx(liquidAddress.toOutputScript(account.unconfidentialAddress, networks.testnet), 100_000);
    const routes: Record<string, () => Response> = {
      [`${BASE}/address/${account.confidentialAddress}/utxo`]: () => json([]),
      [`${BASE}/address/${account.unconfidentialAddress}/utxo`]: () => json([{ txid: 'ff'.repeat(32), vout: 0, status: { confirmed: true } }]),
      [`${BASE}/tx/${'ff'.repeat(32)}/hex`]: () => text(tx.toHex()),
    };
    await expect(scanLiquidTestnetUtxos(account, { fetchFn: fetchFor(routes), baseUrl: BASE })).rejects.toThrow(/parses to/);
  });
});

// ── send ─────────────────────────────────────────────────────────────────────

function explicitUtxo(account: ReturnType<typeof deriveLiquidTestnetAccountFromSeed>, value: number, iface = false): LiquidUtxo {
  return {
    txid: 'aa'.repeat(32),
    vout: 0,
    value,
    status: { confirmed: true, block_height: 10 },
    index: account.index,
    address: iface ? account.confidentialAddress : account.unconfidentialAddress,
    confidential: false,
    script: liquidAddress.toOutputScript(account.unconfidentialAddress, networks.testnet),
    valueCommitment: valueBuf(value),
    assetCommitment: assetBuf(NATIVE),
    nonce: Buffer.from([0]),
    assetWire: WIRE_ASSET,
    assetBlindingFactor: new Uint8Array(32),
    valueBlindingFactor: new Uint8Array(32),
  };
}

describe('liquidTestnetAccount — send', () => {
  const account = deriveLiquidTestnetAccountFromSeed(SEED);
  const recipientAccount = deriveLiquidTestnetAccountFromSeed(new Uint8Array(32).fill(0x33));
  const destination = recipientAccount.unconfidentialAddress;

  it('builds, signs and broadcasts an explicit send with the mandatory fee output', async () => {
    const routes = { [`POST ${BASE}/tx`]: () => text('cd'.repeat(32)) };
    const res = await sendLiquidTestnet(account, {
      to: destination,
      sats: 50_000,
      utxos: [explicitUtxo(account, 100_000)],
      fetchFn: fetchFor(routes),
      baseUrl: BASE,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.txid).toBe('cd'.repeat(32));
    const parsed = Transaction.fromHex(res.rawTx);
    // The fee must cover the ACTUAL transaction vsize (no CT discount), not
    // the naive base-size estimate — the live node refused the latter.
    expect(res.feeSats).toBeGreaterThanOrEqual(Math.ceil(parsed.virtualSize(false) * LIQUID_TESTNET_FEE_RATE_SAT_VB));
    expect(res.changeAddress).toBe(account.unconfidentialAddress);
    expect(parsed.ins).toHaveLength(1);
    expect(parsed.outs).toHaveLength(3);
    expect(parsed.outs[0].value.equals(valueBuf(50_000))).toBe(true);
    expect(parsed.outs[0].asset.equals(assetBuf(NATIVE))).toBe(true);
    expect(parsed.outs[1].value.equals(valueBuf(100_000 - 50_000 - res.feeSats))).toBe(true);
    expect(parsed.outs[2].script.length).toBe(0);
    expect(parsed.outs[2].value.equals(valueBuf(res.feeSats))).toBe(true);
    expect(parsed.ins[0].witness.length).toBe(2);

    // Regression lock (live-caught): the witness signature must verify over
    // the ACTUAL sighash with prehash:false. @noble/curves v2 defaults to
    // prehash:true, which sha256's the sighash again and fails on-chain with
    // "Signature must be zero for failed CHECK(MULTI)SIG operation".
    const input = parsed.ins[0];
    if (!input) return;
    const witness = input.witness;
    const sigItem = Buffer.from(witness[0] ?? []);
    const pubItem = Buffer.from(witness[1] ?? []);
    const decoded = liquidScript.signature.decode(sigItem);
    const prevScript = liquidAddress.toOutputScript(account.unconfidentialAddress, networks.testnet);
    const legacyScript = payments.p2pkh({ hash: prevScript.subarray(2) }).output;
    if (!legacyScript) return;
    const sighash = parsed.hashForWitnessV0(0, legacyScript, valueBuf(100_000), 0x01);
    expect(decoded.signature.length).toBe(64); // script.signature.decode returns compact r||s
    expect(pubItem.equals(Buffer.from(account.spendPublicKey))).toBe(true);
    expect(secp256k1.verify(decoded.signature, new Uint8Array(sighash), pubItem, { prehash: false })).toBe(true);
    expect(decoded.hashType).toBe(0x01);
  });

  it('spends a confidential input through its real commitments', async () => {
    const confidentialUtxo: LiquidUtxo = {
      ...explicitUtxo(account, 80_000, true),
      confidential: true,
      valueCommitment: Buffer.concat([Buffer.from([0x08]), Buffer.alloc(32, 3)]),
      assetCommitment: Buffer.concat([Buffer.from([0x0a]), Buffer.alloc(32, 4)]),
      nonce: Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 5)]),
      assetBlindingFactor: new Uint8Array(32).fill(0xab),
      valueBlindingFactor: new Uint8Array(32).fill(0xcd),
    };
    const routes = { [`POST ${BASE}/tx`]: () => text('ee'.repeat(32)) };
    const res = await sendLiquidTestnet(account, {
      to: destination,
      sats: 60_000,
      utxos: [confidentialUtxo],
      fetchFn: fetchFor(routes),
      baseUrl: BASE,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const parsed = Transaction.fromHex(res.rawTx);
    expect(parsed.outs[0].value.equals(valueBuf(60_000))).toBe(true);
    expect(parsed.ins[0].witness.length).toBe(2);
  });

  it('blinds a confidential destination so the recipient can unblind it (real wasm)', async () => {
    const res = await sendLiquidTestnet(account, {
      to: recipientAccount.confidentialAddress,
      sats: 60_000,
      utxos: [explicitUtxo(account, 100_000)],
      fetchFn: fetchFor({ [`POST ${BASE}/tx`]: () => text('dd'.repeat(32)) }),
      baseUrl: BASE,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const parsed = Transaction.fromHex(res.rawTx);
    const blinded = parsed.outs[0];
    if (!blinded) return;
    expect((blinded.rangeProof ?? new Uint8Array()).length).toBeGreaterThan(0);
    expect((blinded.surjectionProof ?? new Uint8Array()).length).toBeGreaterThan(0);
    expect(blinded.value.length).toBe(33);
    expect(blinded.asset.length).toBe(33);
    // The kilobyte-scale range proof must be covered by the fee (live-caught
    // "fee below the node minimum" when the naive base estimate was used).
    expect(res.feeSats).toBeGreaterThanOrEqual(Math.ceil(parsed.virtualSize(false) * LIQUID_TESTNET_FEE_RATE_SAT_VB));
    // The recipient's blinding key opens it — real secp256k1-zkp unblinding.
    const opened = await unblindLiquidOutput(blinded, recipientAccount.blindingPrivateKey);
    expect(opened.valueSats).toBe(60_000);
    expect(opened.assetId.toLowerCase()).toBe(NATIVE.toLowerCase());
    // Change stays explicit (honest, documented): only the destination is blinded.
    expect(parsed.outs[1].value.equals(valueBuf(100_000 - 60_000 - res.feeSats))).toBe(true);
  });

  it('keeps the change and fee outputs explicit beside a blinded destination (mixed)', async () => {
    const res = await sendLiquidTestnet(account, {
      to: recipientAccount.confidentialAddress,
      sats: 40_000,
      utxos: [explicitUtxo(account, 100_000)],
      fetchFn: fetchFor({ [`POST ${BASE}/tx`]: () => text('fe'.repeat(32)) }),
      baseUrl: BASE,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const parsed = Transaction.fromHex(res.rawTx);
    // Exactly 3 outputs: blinded destination, explicit change, explicit fee.
    expect(parsed.outs).toHaveLength(3);
    const [dest, change, feeOut] = parsed.outs;
    if (!dest || !change || !feeOut) return;
    // Destination: amount + asset committed, range + surjection proofs present.
    expect(dest.value.length).toBe(33);
    expect(dest.asset.length).toBe(33);
    expect((dest.rangeProof ?? new Uint8Array()).length).toBeGreaterThan(0);
    expect((dest.surjectionProof ?? new Uint8Array()).length).toBeGreaterThan(0);
    // Change: explicit amount/asset, no CT payload.
    expect(change.value.equals(valueBuf(100_000 - 40_000 - res.feeSats))).toBe(true);
    expect(change.asset.equals(assetBuf(NATIVE))).toBe(true);
    expect((change.rangeProof ?? new Uint8Array()).length).toBe(0);
    // Mandatory Elements fee output: empty script, fee amount.
    expect(feeOut.script.length).toBe(0);
    expect(feeOut.value.equals(valueBuf(res.feeSats))).toBe(true);
    expect(res.changeAddress).toBe(account.unconfidentialAddress);
    // The committed amount/asset open with the recipient's blinding key.
    const opened = await unblindLiquidOutput(dest, recipientAccount.blindingPrivateKey);
    expect(opened.valueSats).toBe(40_000);
    expect(opened.assetId.toLowerCase()).toBe(NATIVE.toLowerCase());
  });

  it('fails closed with a typed error when the zkp factory is unavailable', async () => {
    const attempt = async (zkpFactory: () => Promise<unknown>) => {
      let fetchCalls = 0;
      const res = await sendLiquidTestnet(account, {
        to: recipientAccount.confidentialAddress,
        sats: 50_000,
        utxos: [explicitUtxo(account, 100_000)],
        fetchFn: (async () => {
          fetchCalls += 1;
          throw new Error('network must not be touched');
        }) as unknown as typeof fetch,
        baseUrl: BASE,
        zkpFactory,
      });
      return { res, fetchCalls };
    };

    // A rejecting factory (wasm/context unavailable) refuses with the typed,
    // actionable code - before any network or broadcast work.
    const rejected = await attempt(async () => {
      throw new Error('wasm unavailable (injected)');
    });
    expect(rejected.res.ok).toBe(false);
    if (!rejected.res.ok) {
      expect(rejected.res.code).toBe('blinding_unavailable');
      expect(rejected.res.message).toMatch(/blinding context/);
      expect(rejected.res.message).toMatch(/wasm unavailable \(injected\)/);
    }
    expect(rejected.fetchCalls).toBe(0);

    // A factory that resolves to nothing is also refused, never treated as
    // "no blinding needed" (which would send an unblinded output).
    const empty = await attempt(async () => null);
    expect(empty.res.ok).toBe(false);
    if (!empty.res.ok) expect(empty.res.code).toBe('blinding_unavailable');
    expect(empty.fetchCalls).toBe(0);
  });

  it('never asks for the zkp context when every output is explicit', async () => {
    let factoryCalls = 0;
    const res = await sendLiquidTestnet(account, {
      to: destination,
      sats: 50_000,
      utxos: [explicitUtxo(account, 100_000)],
      fetchFn: fetchFor({ [`POST ${BASE}/tx`]: () => text('ef'.repeat(32)) }),
      baseUrl: BASE,
      zkpFactory: async () => {
        factoryCalls += 1;
        throw new Error('must not be called for explicit sends');
      },
    });
    expect(res.ok).toBe(true);
    expect(factoryCalls).toBe(0);
  });

  it('completes a create → unblind → spend → unblind round trip (real wasm)', async () => {
    const holder = deriveLiquidTestnetAccountFromSeed(new Uint8Array(32).fill(0x44));
    const recipient = deriveLiquidTestnetAccountFromSeed(new Uint8Array(32).fill(0x55));

    // 1. Fund the holder's CONFIDENTIAL address from an explicit input, then
    //    salvage the blinded output into a funding tx the scan can read.
    const first = await sendLiquidTestnet(account, {
      to: holder.confidentialAddress,
      sats: 70_000,
      utxos: [explicitUtxo(account, 100_000)],
      fetchFn: fetchFor({ [`POST ${BASE}/tx`]: () => text('11'.repeat(32)) }),
      baseUrl: BASE,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const blindedOutput = Transaction.fromHex(first.rawTx).outs[0];
    const funding = new Transaction();
    funding.addInput(Buffer.alloc(32, 9), 0, 0xffffffff, Buffer.alloc(0));
    funding.addOutput(
      blindedOutput.script,
      blindedOutput.value,
      blindedOutput.asset,
      blindedOutput.nonce,
      blindedOutput.rangeProof,
      blindedOutput.surjectionProof,
    );
    const fundingTxid = funding.getId();

    // 2. Scan with the REAL unblinder: value and blinders must come back.
    const scanRoutes: Record<string, () => Response> = {
      [`${BASE}/address/${holder.confidentialAddress}/utxo`]: () =>
        json([{ txid: fundingTxid, vout: 0, status: { confirmed: true, block_height: 5 } }]),
      [`${BASE}/address/${holder.unconfidentialAddress}/utxo`]: () => json([]),
      [`${BASE}/tx/${fundingTxid}/hex`]: () => text(funding.toHex()),
    };
    const spent = await scanLiquidTestnetUtxos(holder, { fetchFn: fetchFor(scanRoutes), baseUrl: BASE });
    expect(spent).toHaveLength(1);
    const held = spent[0];
    if (!held) return;
    expect(held).toMatchObject({ value: 70_000, confidential: true });
    expect(held.assetBlindingFactor.some((b) => b !== 0)).toBe(true);
    expect(held.valueBlindingFactor.some((b) => b !== 0)).toBe(true);

    // 3. Spend the confidential UTXO to the recipient's confidential address.
    const second = await sendLiquidTestnet(holder, {
      to: recipient.confidentialAddress,
      sats: 65_000,
      utxos: [held],
      fetchFn: fetchFor({ [`POST ${BASE}/tx`]: () => text('22'.repeat(32)) }),
      baseUrl: BASE,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // 4. The recipient unblinds the new output.
    const out = Transaction.fromHex(second.rawTx).outs[0];
    const opened = await unblindLiquidOutput(out, recipient.blindingPrivateKey);
    expect(opened.valueSats).toBe(65_000);
    expect(opened.assetId.toLowerCase()).toBe(NATIVE.toLowerCase());
  });

  it('refuses cross-chain destinations and reports insufficient funds honestly', async () => {
    const missing = await sendLiquidTestnet(account, {
      to: 'tb1q3ejchc0s0st9rnzlry0m3fgc9j6vgwat3tq5ts',
      sats: 1000,
      utxos: [explicitUtxo(account, 100_000)],
      fetchFn: fetchFor({}),
      baseUrl: BASE,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('invalid_address');

    const noFunds = await sendLiquidTestnet(account, {
      to: destination,
      sats: 100_000,
      utxos: [explicitUtxo(account, 1000)],
      fetchFn: fetchFor({}),
      baseUrl: BASE,
    });
    expect(noFunds.ok).toBe(false);
    if (!noFunds.ok) expect(noFunds.code).toBe('insufficient_funds');
  });

  it('rolls dust change into the fee', async () => {
    const fee = Math.max(1, Math.ceil(estimateLiquidVsize(1, 3) * LIQUID_TESTNET_FEE_RATE_SAT_VB));
    const res = await sendLiquidTestnet(account, {
      to: destination,
      sats: 50_000,
      utxos: [explicitUtxo(account, 50_000 + fee + 100)],
      fetchFn: fetchFor({ [`POST ${BASE}/tx`]: () => text('ab'.repeat(32)) }),
      baseUrl: BASE,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changeAddress).toBeNull();
    expect(res.feeSats).toBe(fee + 100);
    const parsed = Transaction.fromHex(res.rawTx);
    expect(parsed.outs).toHaveLength(2);
    expect(parsed.outs[0].value.equals(valueBuf(50_000))).toBe(true);
    expect(parsed.outs[1].value.equals(valueBuf(fee + 100))).toBe(true);
  });

  it('maps broadcast failures and never reports a fake txid', async () => {
    const res = await sendLiquidTestnet(account, {
      to: destination,
      sats: 50_000,
      utxos: [explicitUtxo(account, 100_000)],
      fetchFn: fetchFor({ [`POST ${BASE}/tx`]: () => text('bad-txns-in-ne-out', 400) }),
      baseUrl: BASE,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('broadcast_failed');
      expect(res.message).toMatch(/malformed|rejected/i);
    }
  });
});

// ── receive-chain rotation ───────────────────────────────────────────────────

describe('liquidTestnetAccount — receive-chain rotation', () => {
  const account = deriveLiquidTestnetAccountFromSeed(SEED);
  const rotated = deriveLiquidTestnetAccountFromSeed(SEED, 1);

  it('scans every receive index up to receiveIndex and tags each utxo', async () => {
    const tx0 = fundingTx(liquidAddress.toOutputScript(account.unconfidentialAddress, networks.testnet), 100_000);
    const tx1 = fundingTx(liquidAddress.toOutputScript(rotated.unconfidentialAddress, networks.testnet), 60_000);
    const routes: Record<string, () => Response> = {
      [`${BASE}/address/${account.confidentialAddress}/utxo`]: () => json([]),
      [`${BASE}/address/${account.unconfidentialAddress}/utxo`]: () => json([{ txid: tx0.getId(), vout: 0, status: { confirmed: true, block_height: 10 } }]),
      [`${BASE}/address/${rotated.confidentialAddress}/utxo`]: () => json([]),
      [`${BASE}/address/${rotated.unconfidentialAddress}/utxo`]: () => json([{ txid: tx1.getId(), vout: 0, status: { confirmed: true, block_height: 11 } }]),
      [`${BASE}/tx/${tx0.getId()}/hex`]: () => text(tx0.toHex()),
      [`${BASE}/tx/${tx1.getId()}/hex`]: () => text(tx1.toHex()),
    };
    const utxos = await scanLiquidTestnetUtxos(account, { fetchFn: fetchFor(routes), baseUrl: BASE, receiveIndex: 1 });
    expect(utxos).toHaveLength(2);
    expect(utxos.map((u) => u.index).sort()).toEqual([0, 1]);
    expect(utxos.find((u) => u.index === 1)?.address).toBe(rotated.unconfidentialAddress);

    // The default stays single-index: an index-1 route must NOT be fetched.
    const defaultScan = await scanLiquidTestnetUtxos(account, { fetchFn: fetchFor(routes), baseUrl: BASE });
    expect(defaultScan.map((u) => u.index)).toEqual([0]);
  });

  it('signs a rotated-index input with that index key and returns change to the receive index', async () => {
    const rotatedUtxo = explicitUtxo(rotated, 100_000);
    const res = await sendLiquidTestnet(account, {
      to: deriveLiquidTestnetAccountFromSeed(new Uint8Array(32).fill(0x33)).unconfidentialAddress,
      sats: 50_000,
      receiveIndex: 1,
      utxos: [rotatedUtxo],
      fetchFn: fetchFor({ [`POST ${BASE}/tx`]: () => text('7a'.repeat(32)) }),
      baseUrl: BASE,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changeAddress).toBe(rotated.unconfidentialAddress);
    const parsed = Transaction.fromHex(res.rawTx);
    const input = parsed.ins[0];
    if (!input) return;
    const sigItem = Buffer.from(input.witness[0] ?? []);
    const pubItem = Buffer.from(input.witness[1] ?? []);
    expect(pubItem.equals(Buffer.from(rotated.spendPublicKey))).toBe(true);
    expect(pubItem.equals(Buffer.from(account.spendPublicKey))).toBe(false);
    const prevScript = liquidAddress.toOutputScript(rotated.unconfidentialAddress, networks.testnet);
    const legacyScript = payments.p2pkh({ hash: prevScript.subarray(2) }).output;
    if (!legacyScript) return;
    const sighash = parsed.hashForWitnessV0(0, legacyScript, valueBuf(100_000), 0x01);
    expect(secp256k1.verify(liquidScript.signature.decode(sigItem).signature, new Uint8Array(sighash), pubItem, { prehash: false })).toBe(true);
  });

  it('refuses an invalid receive index with a typed failure', async () => {
    for (const receiveIndex of [-1, 1.5, Number.NaN]) {
      const res = await sendLiquidTestnet(account, {
        to: deriveLiquidTestnetAccountFromSeed(new Uint8Array(32).fill(0x33)).unconfidentialAddress,
        sats: 50_000,
        receiveIndex,
        utxos: [explicitUtxo(account, 100_000)],
        fetchFn: fetchFor({}),
        baseUrl: BASE,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('invalid_index');
    }
    await expect(
      scanLiquidTestnetUtxos(account, { fetchFn: fetchFor({}), baseUrl: BASE, receiveIndex: -1 }),
    ).rejects.toThrow(/bad receive index/);
  });
});
