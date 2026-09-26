/**
 * Opt-in LIVE conformance for NUT-02 v2 keyset handling after the cashu-ts
 * 3.7.2 bump, against the app's default mainnet fallback mint
 * (`https://mint.minibits.cash/Bitcoin`, a cdk mint advertising v2 keyset IDs
 * `01…`).
 *
 * History: the 2.9.0 line derived v2 IDs with an early draft preimage and
 * rejected every cdk v2 keyset; `src/wallet/keysetCompat.ts` worked around
 * that. 3.x derives the FINAL spec natively, so the shim was deleted with the
 * bump (docs/KEYSET-ID-V2-COMPAT.md exit plan) and this test now proves the
 * native path instead of the repro.
 *
 * Run:
 *   BAO_WALLET_LIVE=1 npx vitest run src/wallet/keysetCompat.live.test.ts --testTimeout=90000
 *
 * No sats move: the test creates a Lightning top-up quote and polls it. A
 * NUT-04 quote that is never paid mints nothing (and the quote expires).
 */
import { describe, expect, it, afterAll } from 'vitest';
import { Wallet, deriveKeysetId } from 'cashu-ts3';
import {
  clearPendingTopUp,
  completeLightningTopUp,
  createLightningTopUp,
  loadPendingTopUp,
} from './cashuWallet';

const LIVE = process.env.BAO_WALLET_LIVE === '1';
const MINT = 'https://mint.minibits.cash/Bitcoin';
const AMOUNT_SATS = 21;

describe.skipIf(!LIVE)('LIVE: cdk v2 keyset mint (Minibits)', () => {
  afterAll(() => clearPendingTopUp());

  it('cashu-ts 3.x loadMint() verifies the live v2 keyset natively', async () => {
    const wallet = new Wallet(MINT);
    // Fetches /v1/info + /v1/keysets + /v1/keys and verifies every keyset ID
    // with the current NUT-02 derivation - the exact call that threw
    // "Couldn't verify keyset ID 01…" on 2.9.0.
    await wallet.loadMint();
    const keyset = wallet.getKeyset();
    expect(/^01[0-9a-f]{64}$/i.test(keyset.id)).toBe(true);
    expect(keyset.hasKeys).toBe(true);
    expect(keyset.verify()).toBe(true);
    expect(wallet.keysetId).toBe(keyset.id);
    // Independent cross-check through the public typed derivation API.
    expect(deriveKeysetId(keyset.keys, {
      unit: keyset.unit,
      versionByte: 1,
      input_fee_ppk: keyset.fee,
      expiry: keyset.expiry,
    })).toBe(keyset.id);
  });

  it('top-up quote + NUT-04 poll succeed against the live mint', async () => {
    const topUp = await createLightningTopUp(AMOUNT_SATS, MINT);
    expect(topUp.invoice.startsWith('lnbc')).toBe(true);
    expect(topUp.amountSats).toBe(AMOUNT_SATS);
    expect(loadPendingTopUp()?.quoteId).toBe(topUp.quoteId);

    // Exactly what TopUpPanel's 4-second poll calls: loadMint (v2 previously
    // threw here) + checkMintQuote. An unpaid quote must report `pending`.
    const poll = await completeLightningTopUp(topUp.quoteId, MINT);
    expect(poll.state).toBe('pending');
    expect(poll.minted).toBe(0);
  });
});
