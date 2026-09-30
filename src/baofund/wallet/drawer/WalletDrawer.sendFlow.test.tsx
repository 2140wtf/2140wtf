/**
 * WalletDrawer send-flow tests — the pledge prefill contract:
 *   event {tab:'send', rail, to, sats} → the drawer opens on the right rail
 *   with destination+amount pre-filled, and a NEW intent while the drawer is
 *   already open re-prefills the form (remount), never leaving a stale escrow
 *   address in the money path. Plus the honest no-seed notice for sign-in
 *   methods that cannot sign (NIP-07/passkey).
 *
 * Rail scans are mocked to empty UTXO lists: this suite locks the WIRING,
 * not the chain.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  status: 'ready' as string,
  pubkey: 'aa'.repeat(32) as string | null,
  seedIdentityHex: (() => null) as (() => string | null) | null,
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../rails/testnet4Account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rails/testnet4Account')>()),
  scanTestnet4Utxos: vi.fn(async () => []),
}));
vi.mock('../rails/liquidTestnetAccount', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rails/liquidTestnetAccount')>()),
  scanLiquidTestnetUtxos: vi.fn(async () => []),
}));

import { WalletDrawer, railSigningNotice } from './WalletDrawer';
import { WalletDrawerProvider } from './WalletDrawerContext';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  authState.status = 'ready';
  authState.pubkey = 'aa'.repeat(32);
  // Default: a seed identity (the send form only exists when the wallet can
  // actually sign); the no-seed notice test overrides this.
  authState.seedIdentityHex = () => '11'.repeat(32);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderDrawer(): Promise<void> {
  await act(async () => {
    root.render(
      <WalletDrawerProvider>
        <WalletDrawer />
      </WalletDrawerProvider>,
    );
  });
}

async function openSend(detail: Record<string, string>): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('bao-open-wallet-drawer', { detail: { tab: 'send', ...detail } }));
  });
}

it('opens the right rail with the escrow destination and amount pre-filled', async () => {
  await renderDrawer();
  await openSend({ rail: 'liquid', to: 'tex1firstescrow', sats: '1000' });
  await vi.waitFor(() => {
    expect(container.querySelector<HTMLInputElement>('[data-testid=liquid-send-to]')?.value).toBe('tex1firstescrow');
  }, { timeout: 5000 });
  expect(container.querySelector<HTMLInputElement>('[data-testid=liquid-send-amount]')?.value).toBe('1000');
  expect(container.querySelector('[data-testid=liquid-wallet-card]')).toBeTruthy();
  expect(container.querySelector('[data-testid=testnet4-wallet-card]')).toBeNull();
});

it('a NEW intent while the drawer is open re-prefills the form (no stale escrow address)', async () => {
  await renderDrawer();
  await openSend({ rail: 'liquid', to: 'tex1firstescrow', sats: '1000' });
  await vi.waitFor(() => {
    expect(container.querySelector<HTMLInputElement>('[data-testid=liquid-send-to]')?.value).toBe('tex1firstescrow');
  }, { timeout: 5000 });

  // Second pledge output clicked while the drawer stayed open.
  await openSend({ rail: 'liquid', to: 'tex1secondescrow', sats: '2000' });
  await vi.waitFor(() => {
    expect(container.querySelector<HTMLInputElement>('[data-testid=liquid-send-to]')?.value).toBe('tex1secondescrow');
  }, { timeout: 5000 });
  expect(container.querySelector<HTMLInputElement>('[data-testid=liquid-send-amount]')?.value).toBe('2000');
});

it('switches rails when the new intent names the other rail', async () => {
  await renderDrawer();
  await openSend({ rail: 'liquid', to: 'tex1firstescrow', sats: '1000' });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=liquid-wallet-card]')).toBeTruthy();
  }, { timeout: 5000 });

  await openSend({ rail: 'l1', to: 'tb1psecondescrow', sats: '2000' });
  await vi.waitFor(() => {
    expect(container.querySelector<HTMLInputElement>('[data-testid=testnet4-send-to]')?.value).toBe('tb1psecondescrow');
  }, { timeout: 5000 });
  expect(container.querySelector<HTMLInputElement>('[data-testid=testnet4-send-amount]')?.value).toBe('2000');
  expect(container.querySelector('[data-testid=liquid-wallet-card]')).toBeNull();
});

it('tells a no-seed sign-in method exactly why it cannot sign and offers the path', async () => {
  authState.seedIdentityHex = () => null;
  await renderDrawer();
  await openSend({ rail: 'liquid', to: 'tex1firstescrow', sats: '1000' });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=rail-no-seed-notice]')).toBeTruthy();
  }, { timeout: 5000 });
  const notice = container.querySelector('[data-testid=rail-no-seed-notice]')!.textContent ?? '';
  expect(notice).toContain('cannot sign on-chain testnet payments');
  expect(notice).toContain('seed words');
  expect(notice).toContain('import/create a wallet mnemonic');
});

it('railSigningNotice is null when a seed identity can sign', () => {
  expect(railSigningNotice('11'.repeat(32), 'aa'.repeat(32))).toBeNull();
  expect(railSigningNotice(null, 'aa'.repeat(32))).toContain('cannot sign on-chain testnet payments');
  expect(railSigningNotice(null, null)).toContain('Sign in with a seed identity');
});
