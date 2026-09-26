// @vitest-environment node
/**
 * Opt-in LIVE harness for the testnet4 wallet — real coins, real campaign.
 *
 * Flow (owner priority 2026-09-22: prove the funding logic, not just
 * wallet-to-wallet):
 *   1. sweep the pre-funded throwaway wallet (`.run-tmp/wallet-t4-e2e.json`)
 *      into a fresh BIP-39 MNEMONIC wallet (the form the /wallet card imports);
 *   2. open a Pledge intent on a testnet4-rail (`l1`) campaign through the
 *      production pledge API (investor tester identity, NIP-98);
 *   3. pay the escrow deposit address from the mnemonic wallet with the
 *      production wallet core (`sendTestnet4`), re-submit with the txid;
 *   4. poll the contributions endpoint until the API confirms the on-chain
 *      contribution (lazy verification);
 *   5. return the remainder to the tester taproot address.
 *
 * Run:
 *   VITE_BAO_FUND_API_URL=https://app.bao.network/fund-api BAO_WALLET_T4_LIVE=1 \
 *     npx vitest run src/wallet/rails/testnet4Account.live.test.ts --testTimeout=1800000
 *
 * State: `.run-tmp/wallet-t4-live.json` (0600, gitignored; mnemonic and
 * txids only — never printed). Tester keys stay in
 * `.run-tmp/tester-identities.json` (0600) and are referenced by field.
 */
import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import {
  deriveTestnet4Account,
  generateTestnet4Mnemonic,
  importTestnet4AccountFromMnemonic,
  scanTestnet4Utxos,
  sendTestnet4,
  testnet4AddressAt,
  type Testnet4Account,
} from './testnet4Account';
import { contributeToFundraiser, fetchContributions, fetchFundraisers, type SignerLike } from '../../lib/baoFundraising';

const LIVE = process.env.BAO_WALLET_T4_LIVE === '1';
const ROOT = process.cwd();
const STATE_PATH = process.env.BAO_WALLET_T4_STATE ?? join(ROOT, '.run-tmp/wallet-t4-live.json');
const FUNDING_PATH = join(ROOT, '.run-tmp/wallet-t4-e2e.json');
const IDENTITIES_PATH = join(ROOT, '.run-tmp/tester-identities.json');
const PLEDGE_SATS = 21_000;

interface T4LiveState {
  mnemonic: string;
  sweepTxid?: string;
  campaignId?: string;
  escrowAddress?: string;
  pledgeTxid?: string;
  returnTxid?: string;
}

function log(line: string): void {
  console.log(`[t4-live] ${line}`);
}

function loadOrCreateState(): T4LiveState {
  if (existsSync(STATE_PATH)) {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as T4LiveState;
    if (parsed.mnemonic) return parsed;
  }
  const fresh: T4LiveState = { mnemonic: generateTestnet4Mnemonic(12) };
  writeFileSync(STATE_PATH, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  chmodSync(STATE_PATH, 0o600);
  return fresh;
}

function saveState(state: T4LiveState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Scanned UTXOs of the account's window; `confirmedOnly` for settlement. */
async function walletUtxos(
  account: Testnet4Account,
  confirmedOnly: boolean,
): Promise<Array<{ value: number; txid: string; vout: number }>> {
  const utxos = await scanTestnet4Utxos(account, { receiveIndex: 0, changeIndex: 2 });
  return utxos
    .filter((u) => !confirmedOnly || u.status.confirmed)
    .map((u) => ({ value: u.value, txid: u.txid, vout: u.vout }));
}

/** Investor tester identity as a NIP-98 signer (keys never leave the file). */
function investorSigner(): SignerLike {
  const ids = JSON.parse(readFileSync(IDENTITIES_PATH, 'utf8')) as {
    identities: Array<{ role: string; nostr: { secretKey: string } }>;
  };
  const investor = ids.identities.find((i) => i.role === 'investor');
  if (!investor) throw new Error('investor identity missing');
  const sk = hexToBytes(investor.nostr.secretKey);
  return {
    signEvent: async (event) => finalizeEvent(event as never, sk) as never,
  };
}

describe.skipIf(!LIVE)('testnet4 live E2E (real coins → campaign pledge)', () => {
  it('sweeps into a mnemonic wallet, donates to an l1 campaign and confirms the contribution', async () => {
    const state = loadOrCreateState();
    const wallet = importTestnet4AccountFromMnemonic(state.mnemonic);
    const walletReceive = testnet4AddressAt(wallet, 0, 0).address;
    log(`mnemonic wallet receive ${walletReceive}`);

    // 1. Sweep the pre-funded throwaway wallet into the mnemonic wallet.
    //    testnet4 blocks can be slow: chain from the mempool (allowUnconfirmed)
    //    and let the final API confirmation poll absorb the waits.
    if (!state.sweepTxid) {
      const funding = JSON.parse(readFileSync(FUNDING_PATH, 'utf8')) as { seedHex: string };
      const source = deriveTestnet4Account(funding.seedHex);
      let funded: Awaited<ReturnType<typeof walletUtxos>> = [];
      for (let attempt = 0; attempt < 60 && funded.length === 0; attempt++) {
        if (attempt > 0) await sleep(30_000);
        funded = await walletUtxos(source, false);
        if (funded.length === 0) log('waiting for the funding tx to reach the mempool…');
      }
      expect(funded.length, 'funding tx never appeared').toBeGreaterThan(0);
      const total = funded.reduce((s, u) => s + u.value, 0);
      const res = await sendTestnet4(source, {
        to: walletReceive,
        sats: total - 500,
        feeTier: 'hour',
        receiveIndex: 0,
        changeIndex: 0,
        allowUnconfirmed: true,
      });
      expect(res.ok, res.ok ? '' : res.message).toBe(true);
      if (!res.ok) return;
      state.sweepTxid = res.txid;
      saveState(state);
      log(`swept ${total - 500} sats -> ${res.txid}`);
    }

    // 2. Wait for the mnemonic wallet to hold the swept UTXO (mempool is fine).
    let held: Awaited<ReturnType<typeof walletUtxos>> = [];
    for (let attempt = 0; attempt < 60 && held.length === 0; attempt++) {
      if (attempt > 0) await sleep(30_000);
      held = await walletUtxos(wallet, false);
      if (held.length === 0) log('waiting for the sweep to appear…');
    }
    expect(held.length, 'mnemonic wallet never funded').toBeGreaterThan(0);
    const balance = held.reduce((s, u) => s + u.value, 0);
    log(`mnemonic wallet balance ${balance} sats (may be unconfirmed)`);

    // 3. Pledge intent: discover an open testnet4-rail campaign and get the
    //    escrow deposit address from the production API.
    const signer = investorSigner();
    if (!state.campaignId || !state.escrowAddress) {
      const campaigns = await fetchFundraisers('open');
      const target = process.env.BAO_T4_CAMPAIGN_ID
        ? campaigns.find((c) => c.id === process.env.BAO_T4_CAMPAIGN_ID)
        : campaigns.find((c) => c.settlement_rail === 'l1' && c.network === 'testnet');
      expect(target, 'no open testnet4 (l1) campaign found').toBeTruthy();
      if (!target) return;
      state.campaignId = target.id;
      log(`campaign ${target.id} "${target.title.slice(0, 40)}" rail=${target.settlement_rail} network=${target.network}`);
      const intentKey = `t4-live:${target.id}:${PLEDGE_SATS}`;
      const first = await contributeToFundraiser(signer, target.id, {
        amount_sats: PLEDGE_SATS,
        rail: 'l1',
        idempotencyKey: intentKey,
      });
      const pi = first.payment_instructions;
      expect(pi?.kind, 'API did not issue a deposit address').toBe('address');
      if (pi?.kind !== 'address' || !pi.address) return;
      state.escrowAddress = pi.address;
      saveState(state);
      log(`escrow deposit address ${pi.address} (amount ${pi.amount_sats ?? PLEDGE_SATS})`);
    }

    // 4. Pay the escrow from the mnemonic wallet with the production core,
    //    then commit the txid to the API.
    expect(state.escrowAddress).toBeTruthy();
    if (!state.pledgeTxid) {
      const pay = await sendTestnet4(wallet, {
        to: state.escrowAddress as string,
        sats: PLEDGE_SATS,
        feeTier: 'hour',
        receiveIndex: 0,
        changeIndex: 1,
        allowUnconfirmed: true,
      });
      expect(pay.ok, pay.ok ? '' : pay.message).toBe(true);
      if (!pay.ok) return;
      state.pledgeTxid = pay.txid;
      saveState(state);
      log(`pledge payment ${PLEDGE_SATS} sats -> ${pay.txid}`);
      await contributeToFundraiser(signer, state.campaignId as string, {
        amount_sats: PLEDGE_SATS,
        rail: 'l1',
        reference: pay.txid,
        idempotencyKey: `t4-live:${state.campaignId}:${PLEDGE_SATS}`,
      });
    }

    // 5. Lazy on-chain verification: poll contributions until confirmed.
    let confirmed = false;
    for (let attempt = 0; attempt < 120 && !confirmed; attempt++) {
      if (attempt > 0) await sleep(30_000);
      try {
        const rows = await fetchContributions(state.campaignId as string);
        const hit = rows.find(
          (c) => c.deposit_address === state.escrowAddress && c.amount_sats === PLEDGE_SATS,
        );
        if (hit) log(`contribution ${hit.id}: status=${hit.status} tx=${hit.reference ?? '—'}`);
        confirmed = Boolean(hit && hit.status === 'confirmed');
      } catch (e) {
        log(`contributions poll failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(confirmed, 'contribution never confirmed by the API').toBe(true);
    log(`pledge CONFIRMED for campaign ${state.campaignId}`);

    // 6. Return the remainder to the tester taproot address.
    if (!state.returnTxid) {
      const ids = JSON.parse(readFileSync(IDENTITIES_PATH, 'utf8')) as {
        identities: Array<{ role: string; taproot: { fundedAddress: string } }>;
      };
      const tester = ids.identities.find((i) => i.role === 'investor')?.taproot.fundedAddress;
      expect(tester, 'tester taproot address missing').toBeTruthy();
      const left = await walletUtxos(wallet, false);
      const remaining = left.reduce((s, u) => s + u.value, 0);
      if (tester && remaining > 2_000) {
        const back = await sendTestnet4(wallet, {
          to: tester,
          sats: remaining - 500,
          feeTier: 'hour',
          receiveIndex: 0,
          changeIndex: 2,
        });
        expect(back.ok, back.ok ? '' : back.message).toBe(true);
        if (back.ok) {
          state.returnTxid = back.txid;
          saveState(state);
          log(`returned ${remaining - 500} sats -> ${back.txid}`);
        }
      }
    }

    log(`SUMMARY sweep=${state.sweepTxid} pledge=${state.pledgeTxid} campaign=${state.campaignId} return=${state.returnTxid ?? '—'}`);
  }, 10_800_000);
});
