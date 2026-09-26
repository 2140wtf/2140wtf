/**
 * LiquidTestnetWalletCard render tests — network is injected; the explicit
 * UTXO path needs no zkp wasm, so the suite stays fast and offline.
 *
 * The card mirrors the Testnet4 created-wallet flow on the `liquid` rail of
 * `railWalletStore`: stored created/imported wallet → identity-derived session
 * account, words shown once / re-revealable / forget behind a confirmation.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { address as liquidAddress, networks, Transaction } from 'liquidjs-lib';
import {
  LiquidTestnetWalletCard,
  liquidTestnetFaucetUrl,
  LIQUID_TESTNET_FAUCET_BASE,
} from './LiquidTestnetWalletCard';
import {
  deriveLiquidTestnetAccount,
  importLiquidTestnetAccountFromMnemonic,
  type LiquidTestnetAccount,
} from './liquidTestnetAccount';
import { LIQUID_TESTNET_NATIVE_ASSET_ID } from '../../lib/liquidTestnetRail';
import { loadRailWallet, readLiquidReceiveIndex, saveRailWallet } from './railWalletStore';

const BASE = 'https://blockstream.info/liquidtestnet/api';
const SECRET = '22'.repeat(32);
const ACCOUNT = deriveLiquidTestnetAccount(SECRET);
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PK = 'a1'.repeat(32);
const IMPORTED = importLiquidTestnetAccountFromMnemonic(MNEMONIC);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const json = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const text = (body: string): Response =>
  ({ ok: true, status: 200, json: async () => ({}), text: async () => body }) as unknown as Response;

/** Chain stub for one account: an optional explicit LBTC UTXO on tex1. */
function fetchFor(account: LiquidTestnetAccount = ACCOUNT, valueSats = 100_000): typeof fetch {
  const assetBuf = Buffer.concat([Buffer.from([1]), Buffer.from(LIQUID_TESTNET_NATIVE_ASSET_ID, 'hex').reverse()]);
  const valueBuf = Buffer.concat([Buffer.from([1]), Buffer.from(valueSats.toString(16).padStart(16, '0'), 'hex')]);
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, 7), 0, 0xffffffff, Buffer.alloc(0));
  tx.addOutput(liquidAddress.toOutputScript(account.unconfidentialAddress, networks.testnet), valueBuf, assetBuf, Buffer.from([0]));
  const txid = tx.getId();
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === `${BASE}/address/${account.unconfidentialAddress}/utxo`) {
      return json(valueSats > 0 ? [{ txid, vout: 0, status: { confirmed: true, block_height: 10 } }] : []);
    }
    // Any other wallet's addresses (created/imported in the test) are empty.
    if (url.endsWith('/utxo')) return json([]);
    if (url === `${BASE}/tx/${txid}/hex`) return text(tx.toHex());
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

async function render(props: React.ComponentProps<typeof LiquidTestnetWalletCard>): Promise<void> {
  await act(async () => root.render(<LiquidTestnetWalletCard {...props} />));
}

/** Toggle the import panel and click "New mnemonic". */
async function generateWallet(): Promise<void> {
  const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Import / generate')) as HTMLButtonElement;
  await act(async () => toggle.click());
  const genBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'New mnemonic') as HTMLButtonElement;
  await act(async () => genBtn.click());
}

/** Toggle the import panel, fill the phrase and click "Import wallet". */
async function importWallet(mnemonic: string): Promise<void> {
  const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Import / generate')) as HTMLButtonElement;
  await act(async () => toggle.click());
  const textarea = container.querySelector('[data-testid=liquid-mnemonic-input]') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, mnemonic);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const importBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Import wallet') as HTMLButtonElement;
  await act(async () => importBtn.click());
}

/** Remount the card in a fresh container (simulates a page reload). */
async function remount(props: React.ComponentProps<typeof LiquidTestnetWalletCard>): Promise<void> {
  await act(async () => root.unmount());
  container.remove();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await render(props);
}

it('renders the derived confidential address with the no-value badge', async () => {
  await render({ identityHex: SECRET, identityPubkey: null, fetchFn: fetchFor() });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(ACCOUNT.confidentialAddress);
  }, { timeout: 5000 });
  expect(container.textContent).toContain('LIQUID TESTNET · NO VALUE');
  expect(container.textContent).toContain('Active wallet: identity-derived session wallet');
  await vi.waitFor(() => {
    const balance = container.querySelector('[data-testid=liquid-balance]');
    expect(balance?.textContent).toContain('100,000');
  }, { timeout: 5000 });
});

it('switches to the unconfidential address and renders its QR', async () => {
  await render({ identityHex: SECRET, identityPubkey: null, fetchFn: fetchFor() });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(ACCOUNT.confidentialAddress);
  }, { timeout: 5000 });
  const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('unconfidential tex1')) as HTMLButtonElement;
  await act(async () => toggle.click());
  await vi.waitFor(() => {
    expect(container.textContent).toContain(ACCOUNT.unconfidentialAddress);
  }, { timeout: 5000 });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=liquid-receive-qr]')).toBeTruthy();
  }, { timeout: 5000 });
});

it('asks for a seed identity when signed out and points at the mnemonic import', async () => {
  await render({ identityHex: null, identityPubkey: null, fetchFn: fetchFor() });
  expect(container.textContent).toContain('Sign in with a seed identity');
  expect(container.textContent).toContain('import a mnemonic');
});

it('offers a prefilled captcha-free faucet link that opens in a new tab', async () => {
  await render({ identityHex: SECRET, identityPubkey: null, fetchFn: fetchFor() });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(ACCOUNT.confidentialAddress);
  }, { timeout: 5000 });
  const link = container.querySelector('[data-testid=liquid-faucet-link]') as HTMLAnchorElement;
  expect(link).toBeTruthy();
  expect(link.target).toBe('_blank');
  expect(link.rel).toContain('noreferrer');
  expect(link.href).toBe(liquidTestnetFaucetUrl(ACCOUNT.confidentialAddress));
  expect(link.href.startsWith(LIQUID_TESTNET_FAUCET_BASE)).toBe(true);
  expect(link.href).toContain('action=lbtc');

  // The link follows the displayed address form.
  const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('unconfidential tex1')) as HTMLButtonElement;
  await act(async () => toggle.click());
  await vi.waitFor(() => {
    expect((container.querySelector('[data-testid=liquid-faucet-link]') as HTMLAnchorElement).href).toBe(
      liquidTestnetFaucetUrl(ACCOUNT.unconfidentialAddress),
    );
  }, { timeout: 5000 });
});

it('creates a fresh mnemonic wallet, persists it per identity and re-activates it on remount', async () => {
  await render({ identityHex: null, identityPubkey: PK, fetchFn: fetchFor(ACCOUNT, 0) });
  await generateWallet();

  const stored = loadRailWallet(PK, 'liquid');
  expect(stored).toBeTruthy();
  expect(stored?.version).toBe(1);
  expect(stored?.source).toBe('created');
  expect(stored?.createdAt).toBeGreaterThan(0);
  const created = importLiquidTestnetAccountFromMnemonic(stored!.mnemonic);
  // Words are shown once on creation.
  expect(container.textContent).toContain(stored!.mnemonic);
  expect(container.textContent).toContain('created browser wallet');

  await remount({ identityHex: null, identityPubkey: PK, fetchFn: fetchFor(created, 0) });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(created.confidentialAddress);
  }, { timeout: 5000 });
  expect(container.textContent).toContain('Active wallet: created browser wallet (saved for this identity)');
  // Re-reveal is behind an explicit click after a reload.
  expect(container.querySelector('[data-testid=liquid-recovery-words]')).toBeNull();
  await act(async () => (container.querySelector('[data-testid=liquid-reveal-words]') as HTMLButtonElement).click());
  expect(container.querySelector('[data-testid=liquid-recovery-words]')?.textContent).toContain(stored!.mnemonic);
});

it('persists an imported mnemonic for the signed-in identity', async () => {
  await render({ identityHex: null, identityPubkey: PK, fetchFn: fetchFor(IMPORTED, 0) });
  await importWallet(MNEMONIC);
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED.confidentialAddress);
  }, { timeout: 5000 });

  expect(loadRailWallet(PK, 'liquid')).toEqual({
    version: 1,
    mnemonic: MNEMONIC,
    createdAt: expect.any(Number),
    source: 'imported',
  });

  await remount({ identityHex: null, identityPubkey: PK, fetchFn: fetchFor(IMPORTED, 0) });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED.confidentialAddress);
  }, { timeout: 5000 });
  expect(container.textContent).toContain('imported browser wallet');
});

it('rejects an invalid mnemonic without touching storage', async () => {
  await render({ identityHex: null, identityPubkey: PK, fetchFn: fetchFor(ACCOUNT, 0) });
  await importWallet('abandon abandon abandon');
  expect(container.textContent).toContain('Invalid mnemonic');
  expect(loadRailWallet(PK, 'liquid')).toBeNull();
});

it('reveals stored words only on explicit click and forgets the wallet behind a confirmation', async () => {
  saveRailWallet(PK, 'liquid', { version: 1, mnemonic: MNEMONIC, createdAt: 1, source: 'imported' });
  await render({ identityHex: SECRET, identityPubkey: PK, fetchFn: fetchFor(IMPORTED, 0) });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED.confidentialAddress);
  }, { timeout: 5000 });
  // The stored wallet takes precedence over the identity-derived session account.
  expect(container.textContent).not.toContain(ACCOUNT.confidentialAddress);
  expect(container.querySelector('[data-testid=liquid-recovery-words]')).toBeNull();

  await act(async () => (container.querySelector('[data-testid=liquid-reveal-words]') as HTMLButtonElement).click());
  expect(container.querySelector('[data-testid=liquid-recovery-words]')?.textContent).toContain('abandon');

  await act(async () => (container.querySelector('[data-testid=liquid-forget-wallet]') as HTMLButtonElement).click());
  expect(container.querySelector('[data-testid=liquid-forget-confirm]')).toBeTruthy();
  // Confirmation is required — the wallet is still stored and active.
  expect(loadRailWallet(PK, 'liquid')).toBeTruthy();
  expect(container.textContent).toContain(IMPORTED.confidentialAddress);

  await act(async () => (container.querySelector('[data-testid=liquid-forget-confirmed]') as HTMLButtonElement).click());
  await vi.waitFor(() => {
    expect(container.textContent).toContain(ACCOUNT.confidentialAddress);
  }, { timeout: 5000 });
  expect(loadRailWallet(PK, 'liquid')).toBeNull();
  expect(container.textContent).toContain('Active wallet: identity-derived session wallet');
});

it('adopts a wallet created while signed out when the user signs in', async () => {
  await render({ identityHex: null, identityPubkey: null, fetchFn: fetchFor(IMPORTED, 0) });
  await importWallet(MNEMONIC);
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED.confidentialAddress);
  }, { timeout: 5000 });
  expect(container.textContent).toContain('this tab only - sign in to save');
  expect(loadRailWallet(PK, 'liquid')).toBeNull();

  // Sign-in without a remount: the tab-only wallet is adopted, not dropped.
  await render({ identityHex: SECRET, identityPubkey: PK, fetchFn: fetchFor(IMPORTED, 0) });
  await vi.waitFor(() => {
    expect(loadRailWallet(PK, 'liquid')?.mnemonic).toBe(MNEMONIC);
  }, { timeout: 5000 });
  expect(container.textContent).toContain(IMPORTED.confidentialAddress);
  expect(container.textContent).toContain('saved for this identity');
});

it('keeps the stored wallet for the identity that owns it across an account switch', async () => {
  saveRailWallet(PK, 'liquid', { version: 1, mnemonic: MNEMONIC, createdAt: 1, source: 'created' });
  await render({ identityHex: SECRET, identityPubkey: PK, fetchFn: fetchFor(IMPORTED, 0) });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED.confidentialAddress);
  }, { timeout: 5000 });

  // Switch to another identity with no stored rail wallet: the session
  // account takes over and the first identity's words are not on screen.
  await remount({ identityHex: SECRET, identityPubkey: 'b2'.repeat(32), fetchFn: fetchFor(ACCOUNT, 0) });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(ACCOUNT.confidentialAddress);
  }, { timeout: 5000 });
  expect(container.textContent).not.toContain(IMPORTED.confidentialAddress);
  expect(container.textContent).not.toContain('abandon');
  expect(container.querySelector('[data-testid=liquid-browser-wallet]')).toBeNull();
});

it('rotates the receive address with New address, rescans every used index and persists the cursor', async () => {
  const rotated = deriveLiquidTestnetAccount(SECRET, 1);
  await render({ identityHex: SECRET, identityPubkey: PK, fetchFn: fetchFor() });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(ACCOUNT.confidentialAddress);
  }, { timeout: 5000 });
  expect(container.textContent).toContain('index 0');

  const newAddress = [...container.querySelectorAll('button')].find((b) => b.textContent === 'New address') as HTMLButtonElement;
  await act(async () => newAddress.click());
  await vi.waitFor(() => {
    expect(container.textContent).toContain(rotated.confidentialAddress);
  }, { timeout: 5000 });
  expect(container.textContent).toContain('index 1');
  expect(readLiquidReceiveIndex(PK)).toBe(1);

  // The rotated scan still sees the index-0 UTXO (all indexes 0..cursor).
  await vi.waitFor(() => {
    const balance = container.querySelector('[data-testid=liquid-balance]');
    expect(balance?.textContent).toContain('100,000');
  }, { timeout: 5000 });

  // A reload restores the cursor and the displayed address.
  await remount({ identityHex: SECRET, identityPubkey: PK, fetchFn: fetchFor() });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(rotated.confidentialAddress);
  }, { timeout: 5000 });
  expect(container.textContent).toContain('index 1');
});
