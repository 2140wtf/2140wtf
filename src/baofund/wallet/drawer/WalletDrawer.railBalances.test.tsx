/**
 * WalletDrawer rail-balance source tests — the drawer must scan the SAME
 * wallet the rail cards spend: a created/imported browser wallet for the
 * signed-in identity wins over the identity-derived session account, and a
 * stored browser wallet is scanned even when the login method has no seed
 * (audit: wallet-drawer-ignores-browser-wallet).
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scanL1: vi.fn(async (_account: unknown, _opts?: unknown): Promise<unknown[]> => []),
  scanLiquid: vi.fn(async (_account: unknown, _opts?: unknown): Promise<unknown[]> => []),
  auth: {
    status: 'ready' as const,
    pubkey: 'a1'.repeat(32),
    seedIdentityHex: (): string | null => '11'.repeat(32),
  },
}));

vi.mock('../../auth/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('../rails/testnet4Account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rails/testnet4Account')>()),
  scanTestnet4Utxos: mocks.scanL1,
}));
vi.mock('../rails/liquidTestnetAccount', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rails/liquidTestnetAccount')>()),
  scanLiquidTestnetUtxos: mocks.scanLiquid,
}));

import { WalletDrawer } from './WalletDrawer';
import { WalletDrawerProvider } from './WalletDrawerContext';
import { deriveTestnet4Account, importTestnet4AccountFromMnemonic, type Testnet4Account } from '../rails/testnet4Account';
import { deriveLiquidTestnetAccount, importLiquidTestnetAccountFromMnemonic, type LiquidTestnetAccount } from '../rails/liquidTestnetAccount';
import { saveRailWallet } from '../rails/railWalletStore';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SESSION_SECRET = '11'.repeat(32);
const PK = 'a1'.repeat(32);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  mocks.scanL1.mockClear();
  mocks.scanL1.mockResolvedValue([]);
  mocks.scanLiquid.mockClear();
  mocks.scanLiquid.mockResolvedValue([]);
  mocks.auth.seedIdentityHex = () => SESSION_SECRET;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderAndOpen(): Promise<void> {
  await act(async () => {
    root.render(
      <WalletDrawerProvider>
        <WalletDrawer />
      </WalletDrawerProvider>,
    );
  });
  await act(async () => {
    window.dispatchEvent(new CustomEvent('bao-open-wallet-drawer', { detail: { tab: 'balances' } }));
  });
}

function storeWallet(rail: 'testnet4' | 'liquid', source: 'created' | 'imported' = 'imported'): void {
  expect(saveRailWallet(PK, rail, { version: 1, mnemonic: MNEMONIC, createdAt: 1_700_000_000, source })).toBe(true);
}

const scannedL1 = (): Testnet4Account => mocks.scanL1.mock.calls[0][0] as Testnet4Account;
const scannedLiquid = (): LiquidTestnetAccount => mocks.scanLiquid.mock.calls[0][0] as LiquidTestnetAccount;

it('scans the identity-derived session account when no browser wallet is stored', async () => {
  await renderAndOpen();
  await vi.waitFor(() => expect(mocks.scanL1).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(mocks.scanLiquid).toHaveBeenCalledTimes(1));
  expect(scannedL1()).toEqual(deriveTestnet4Account(SESSION_SECRET));
  expect(scannedLiquid().unconfidentialAddress)
    .toBe(deriveLiquidTestnetAccount(SESSION_SECRET).unconfidentialAddress);
});

it('scans the stored browser wallet instead of the session account (cards precedence)', async () => {
  storeWallet('testnet4');
  storeWallet('liquid');
  await renderAndOpen();
  await vi.waitFor(() => expect(mocks.scanL1).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(mocks.scanLiquid).toHaveBeenCalledTimes(1));
  const browserL1 = importTestnet4AccountFromMnemonic(MNEMONIC);
  expect(scannedL1()).toEqual(browserL1);
  expect(scannedL1()).not.toEqual(deriveTestnet4Account(SESSION_SECRET));
  const browserLiquid = importLiquidTestnetAccountFromMnemonic(MNEMONIC);
  expect(scannedLiquid().unconfidentialAddress).toBe(browserLiquid.unconfidentialAddress);
  expect(scannedLiquid().unconfidentialAddress)
    .not.toBe(deriveLiquidTestnetAccount(SESSION_SECRET).unconfidentialAddress);
});

it('scans a stored browser wallet even when the login method cannot expose a seed', async () => {
  mocks.auth.seedIdentityHex = () => null;
  storeWallet('testnet4', 'created');
  storeWallet('liquid', 'created');
  await renderAndOpen();
  await vi.waitFor(() => expect(mocks.scanL1).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(mocks.scanLiquid).toHaveBeenCalledTimes(1));
  expect(scannedL1()).toEqual(importTestnet4AccountFromMnemonic(MNEMONIC));
  expect(scannedLiquid().unconfidentialAddress)
    .toBe(importLiquidTestnetAccountFromMnemonic(MNEMONIC).unconfidentialAddress);
  expect(container.textContent).not.toContain('create/import a browser wallet');
});

it('reports an honest error row when neither a browser wallet nor a seed account exists', async () => {
  mocks.auth.seedIdentityHex = () => null;
  mocks.auth.pubkey = PK;
  await renderAndOpen();
  await vi.waitFor(() => {
    expect(container.textContent).toContain('create/import a browser wallet');
  });
  expect(mocks.scanL1).not.toHaveBeenCalled();
  expect(mocks.scanLiquid).not.toHaveBeenCalled();
});
