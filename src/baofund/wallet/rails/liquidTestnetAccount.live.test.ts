// @vitest-environment node
/**
 * Opt-in LIVE harness for the Liquid-testnet wallet — real coins, real chain.
 *
 * It claims LBTC from the public captcha-free faucet
 * (https://liquidtestnet.com/faucet, GET form endpoint), waits for a
 * confirmed confidential UTXO, unblinds it with the production unblinder,
 * then sends a SHIELDED transfer to a second wallet's tlq1 address and
 * verifies the recipient can unblind it.
 *
 * Run:
 *   BAO_WALLET_LIVE=1 npx vitest run \
 *     src/wallet/rails/liquidTestnetAccount.live.test.ts --testTimeout=900000
 *
 * State (seeds, claims, sends) lives in `.run-tmp/wallet-live-e2e.json`
 * (0600, gitignored). Seeds are generated once and never printed. Without
 * BAO_WALLET_LIVE=1 every test here is skipped — CI stays offline.
 */
import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  deriveLiquidTestnetAccountFromSeed,
  scanLiquidTestnetUtxos,
  sendLiquidTestnet,
  type LiquidTestnetAccount,
  type LiquidUtxo,
} from './liquidTestnetAccount';

const LIVE = process.env.BAO_WALLET_LIVE === '1';
const STATE_PATH = process.env.BAO_WALLET_LIVE_STATE ?? join(process.cwd(), '.run-tmp/wallet-live-e2e.json');
const FAUCET = 'https://liquidtestnet.com/faucet';
const MIN_SEND_SATS = 5_000;

interface LiveState {
  w1Seed: string;
  w2Seed: string;
  claims: Array<{ at: string; address: string; ok: boolean; note: string }>;
  sends: Array<{ at: string; txid: string; sats: number; to: string }>;
}

function loadOrCreateState(): LiveState {
  if (existsSync(STATE_PATH)) {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as LiveState;
    if (parsed.w1Seed && parsed.w2Seed) return parsed;
  }
  const fresh: LiveState = {
    w1Seed: randomBytes(32).toString('hex'),
    w2Seed: randomBytes(32).toString('hex'),
    claims: [],
    sends: [],
  };
  writeFileSync(STATE_PATH, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  chmodSync(STATE_PATH, 0o600);
  return fresh;
}

function saveState(state: LiveState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function log(line: string): void {
  console.log(`[wallet-live] ${line}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Claim LBTC to the wallet's confidential address (fallback: unconfidential). */
async function claimFromFaucet(account: LiquidTestnetAccount): Promise<{ ok: boolean; address: string; note: string }> {
  for (const [label, address] of [['tlq1', account.confidentialAddress], ['tex1', account.unconfidentialAddress]] as const) {
    const res = await fetch(`${FAUCET}?address=${encodeURIComponent(address)}&action=lbtc`);
    const html = await res.text();
    const txid = html.match(/[0-9a-f]{64}/i)?.[0] ?? '';
    // The faucet renders "Error" on refusal; a success carries a txid link.
    const ok = res.ok && !/>\s*Error\s*</i.test(html) && Boolean(txid);
    const note = `${label} http=${res.status} txid=${txid || 'none'}`;
    log(`faucet ${note}`);
    if (ok) return { ok: true, address, note };
  }
  return { ok: false, address: account.confidentialAddress, note: 'both address forms refused' };
}

async function scanConfirmed(account: LiquidTestnetAccount): Promise<LiquidUtxo[]> {
  const utxos = await scanLiquidTestnetUtxos(account);
  return utxos.filter((u) => u.status.confirmed);
}

describe.skipIf(!LIVE)('Liquid testnet live E2E (real coins)', () => {
  it('claims, unblinds, shielded-sends and lets the recipient unblind', async () => {
    const state = loadOrCreateState();
    const w1 = deriveLiquidTestnetAccountFromSeed(Buffer.from(state.w1Seed, 'hex'));
    const w2 = deriveLiquidTestnetAccountFromSeed(Buffer.from(state.w2Seed, 'hex'));
    log(`W1 confidential ${w1.confidentialAddress}`);
    log(`W2 confidential ${w2.confidentialAddress}`);

    // 1. Claim once (state-persisted; re-runs reuse the balance instead).
    // Esplora can list a UTXO a few seconds before /tx/:id/hex serves it
    // (observed live 2026-09-22), so transient scan errors retry instead of
    // failing the harness outright.
    let utxos: LiquidUtxo[] = [];
    try {
      utxos = await scanConfirmed(w1);
    } catch (e) {
      log(`initial scan hit a transient explorer error: ${e instanceof Error ? e.message : e}`);
    }
    if (utxos.length === 0 && !state.claims.some((c) => c.ok)) {
      const claim = await claimFromFaucet(w1);
      state.claims.push({ at: new Date().toISOString(), ...claim });
      saveState(state);
      expect(claim.ok, `faucet claim failed: ${claim.note}`).toBe(true);
    }

    // 2. Wait for a confirmed UTXO and unblind it with the real wasm.
    let confirmed: LiquidUtxo[] = [];
    for (let attempt = 0; attempt < 24 && confirmed.length === 0; attempt++) {
      if (attempt > 0) await sleep(30_000);
      try {
        confirmed = await scanConfirmed(w1);
        if (confirmed.length > 0) break;
        const pending = await scanLiquidTestnetUtxos(w1);
        log(`waiting: ${pending.length} utxo(s), ${pending.filter((u) => u.status.confirmed).length} confirmed`);
      } catch (e) {
        log(`scan attempt ${attempt + 1} hit a transient explorer error: ${e instanceof Error ? e.message : e}`);
      }
    }
    expect(confirmed.length, 'no confirmed UTXO after ~12 minutes').toBeGreaterThan(0);
    const funding = confirmed[0]!;
    log(`received+unblinded ${funding.value} sats ${funding.txid}:${funding.vout} (confidential=${funding.confidential})`);
    expect(funding.value).toBeGreaterThan(MIN_SEND_SATS);

    // 3. Shielded send: W1 -> W2's confidential address (blinded output).
    const sendSats = Math.min(20_000, funding.value - 2_000);
    const sent = await sendLiquidTestnet(w1, {
      to: w2.confidentialAddress,
      sats: sendSats,
      utxos: [funding],
    });
    expect(sent.ok, sent.ok ? '' : sent.message).toBe(true);
    if (!sent.ok) return;
    state.sends.push({ at: new Date().toISOString(), txid: sent.txid, sats: sendSats, to: w2.confidentialAddress });
    saveState(state);
    log(`shielded send ${sendSats} sats -> ${sent.txid} (fee ${sent.feeSats})`);

    // 4. Recipient unblinds the incoming output (see the explorer listing too).
    let w2Utxos: LiquidUtxo[] = [];
    for (let attempt = 0; attempt < 20 && w2Utxos.length === 0; attempt++) {
      if (attempt > 0) await sleep(15_000);
      try {
        w2Utxos = await scanLiquidTestnetUtxos(w2);
      } catch (e) {
        log(`recipient scan attempt ${attempt + 1} hit a transient explorer error: ${e instanceof Error ? e.message : e}`);
      }
    }
    expect(w2Utxos.length, 'recipient never saw the shielded output').toBeGreaterThan(0);
    const received = w2Utxos[0]!;
    log(`W2 unblinded ${received.value} sats from ${received.txid}:${received.vout}`);
    expect(received.value).toBe(sendSats);
    expect(received.confidential).toBe(true);
  }, 900_000);
});
