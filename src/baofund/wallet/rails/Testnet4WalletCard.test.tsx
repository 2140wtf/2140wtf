/**
 * Testnet4WalletCard render tests — the card is the /wallet surface for the
 * markets-parity testnet4 account. Network is injected (fetchFn prop); no
 * test touches the real explorer.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Testnet4WalletCard } from './Testnet4WalletCard';
import {
  importTestnet4AccountFromMnemonic,
  testnet4AddressAt,
  deriveTestnet4Account,
} from './testnet4Account';
import { loadRailWallet, saveRailWallet } from './railWalletStore';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SESSION_SECRET = '11'.repeat(32);
const ACCOUNT = deriveTestnet4Account(SESSION_SECRET);
const PK = 'a1'.repeat(32);
const IMPORTED_ADDRESS = testnet4AddressAt(importTestnet4AccountFromMnemonic(MNEMONIC), 0, 0).address;

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

function fetchFor(account = ACCOUNT): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/v1/fees/recommended')) {
      return json({ fastestFee: 2, halfHourFee: 2, hourFee: 1, economyFee: 1, minimumFee: 1 });
    }
    for (let i = 0; i < 6; i++) {
      const recv = testnet4AddressAt(account, 0, i);
      if (url.endsWith(`/address/${recv.address}/utxo`)) {
        return json(
          i === 0
            ? [{ txid: 'aa'.repeat(32), vout: 0, value: 5000, status: { confirmed: true, block_height: 10 } }]
            : [],
        );
      }
      const chg = testnet4AddressAt(account, 1, i);
      if (url.endsWith(`/address/${chg.address}/utxo`)) return json([]);
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

async function render(props: React.ComponentProps<typeof Testnet4WalletCard>): Promise<void> {
  await act(async () => root.render(<Testnet4WalletCard {...props} />));
}

it('renders the derived receive address, no-value badge and honest balance', async () => {
  await render({ identityHex: SESSION_SECRET, identityPubkey: 'pk-test', fetchFn: fetchFor() });
  await vi.waitFor(() => {
    expect(container.textContent).toContain('tb1q3ejchc0s0st9rnzlry0m3fgc9j6vgwat3tq5ts');
  }, { timeout: 5000 });
  expect(container.textContent).toContain('TESTNET4 · NO VALUE');
  await vi.waitFor(() => {
    const balance = container.querySelector('[data-testid=testnet4-balance]');
    expect(balance?.textContent).toContain('5,000');
  }, { timeout: 5000 });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=testnet4-receive-qr]')).toBeTruthy();
  }, { timeout: 5000 });
  expect(container.textContent).toContain('mempool.space/testnet4/faucet');
});

it('persists the receive cursor per identity without storing keys', async () => {
  await render({ identityHex: SESSION_SECRET, identityPubkey: PK, fetchFn: fetchFor() });
  await vi.waitFor(() => {
    expect(container.textContent).toContain('tb1q3ejchc0s0st9rnzlry0m3fgc9j6vgwat3tq5ts');
  }, { timeout: 5000 });
  const newAddress = await vi.waitFor(() => {
    const buttons = [...container.querySelectorAll('button')];
    const btn = buttons.find((b) => b.textContent?.includes('New address'));
    expect(btn).toBeTruthy();
    return btn as HTMLButtonElement;
  });
  await act(async () => newAddress.click());
  await vi.waitFor(() => {
    expect(container.textContent).toContain('tb1q8fg9f2w2ygt3pkn5xqfpcheurpkkrmaycum64a');
  }, { timeout: 5000 });
  const stored = JSON.parse(window.localStorage.getItem(`baofund:l1:${PK}`) ?? '{}') as Record<string, unknown>;
  expect(stored).toEqual({ receiveIndex: 1, changeIndex: 0 });
});

it('imports a mnemonic wallet session-only when no seed identity is available', async () => {
  await render({ identityHex: null, identityPubkey: null, fetchFn: fetchFor() });
  expect(container.textContent).toContain('import a mnemonic');
  const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Import / generate')) as HTMLButtonElement;
  await act(async () => toggle.click());
  const textarea = container.querySelector('[data-testid=testnet4-mnemonic-input]') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, MNEMONIC);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const importBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Import wallet') as HTMLButtonElement;
  await act(async () => importBtn.click());
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED_ADDRESS);
  }, { timeout: 5000 });
  expect(container.textContent).toContain('imported browser wallet');
  expect(container.textContent).toContain('this tab only - sign in to save');
  expect(window.localStorage.getItem('baofund:l1:null')).toBeNull();
  expect(window.localStorage.length).toBe(0);
});

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
  const textarea = container.querySelector('[data-testid=testnet4-mnemonic-input]') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, mnemonic);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const importBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Import wallet') as HTMLButtonElement;
  await act(async () => importBtn.click());
}

/** Remount the card in a fresh container (simulates a page reload). */
async function remount(props: React.ComponentProps<typeof Testnet4WalletCard>): Promise<void> {
  await act(async () => root.unmount());
  container.remove();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await render(props);
}

it('creates a fresh mnemonic wallet, persists it per identity and re-activates it on remount', async () => {
  await render({ identityHex: null, identityPubkey: PK, fetchFn: fetchFor() });
  await generateWallet();

  const stored = loadRailWallet(PK, 'testnet4');
  expect(stored).toBeTruthy();
  expect(stored?.version).toBe(1);
  expect(stored?.source).toBe('created');
  expect(stored?.createdAt).toBeGreaterThan(0);
  const created = importTestnet4AccountFromMnemonic(stored!.mnemonic);
  const address = testnet4AddressAt(created, 0, 0).address;

  await remount({ identityHex: null, identityPubkey: PK, fetchFn: fetchFor(created) });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(address);
  }, { timeout: 5000 });
  expect(container.textContent).toContain('created browser wallet');
  expect(container.textContent).toContain('Active wallet: created browser wallet (saved for this identity)');
});

it('persists an imported mnemonic for the signed-in identity', async () => {
  const imported = importTestnet4AccountFromMnemonic(MNEMONIC);
  await render({ identityHex: null, identityPubkey: PK, fetchFn: fetchFor(imported) });
  const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Import / generate')) as HTMLButtonElement;
  await act(async () => toggle.click());
  const textarea = container.querySelector('[data-testid=testnet4-mnemonic-input]') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, MNEMONIC);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const importBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Import wallet') as HTMLButtonElement;
  await act(async () => importBtn.click());
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED_ADDRESS);
  }, { timeout: 5000 });

  expect(loadRailWallet(PK, 'testnet4')).toEqual({
    version: 1,
    mnemonic: MNEMONIC,
    createdAt: expect.any(Number),
    source: 'imported',
  });

  await remount({ identityHex: null, identityPubkey: PK, fetchFn: fetchFor(imported) });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED_ADDRESS);
  }, { timeout: 5000 });
  expect(container.textContent).toContain('imported browser wallet');
});

it('reveals stored words only on explicit click and forgets the wallet behind a confirmation', async () => {
  saveRailWallet(PK, 'testnet4', { version: 1, mnemonic: MNEMONIC, createdAt: 1, source: 'imported' });
  const imported = importTestnet4AccountFromMnemonic(MNEMONIC);
  await render({ identityHex: SESSION_SECRET, identityPubkey: PK, fetchFn: fetchFor(imported) });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED_ADDRESS);
  }, { timeout: 5000 });
  // The stored wallet takes precedence over the identity-derived session account.
  expect(container.textContent).not.toContain('tb1q3ejchc0s0st9rnzlry0m3fgc9j6vgwat3tq5ts');
  expect(container.querySelector('[data-testid=testnet4-recovery-words]')).toBeNull();

  await act(async () => (container.querySelector('[data-testid=testnet4-reveal-words]') as HTMLButtonElement).click());
  expect(container.querySelector('[data-testid=testnet4-recovery-words]')?.textContent).toContain('abandon');

  await act(async () => (container.querySelector('[data-testid=testnet4-forget-wallet]') as HTMLButtonElement).click());
  expect(container.querySelector('[data-testid=testnet4-forget-confirm]')).toBeTruthy();
  // Confirmation is required — the wallet is still stored and active.
  expect(loadRailWallet(PK, 'testnet4')).toBeTruthy();
  expect(container.textContent).toContain(IMPORTED_ADDRESS);

  await act(async () => (container.querySelector('[data-testid=testnet4-forget-confirmed]') as HTMLButtonElement).click());
  await vi.waitFor(() => {
    expect(container.textContent).toContain('tb1q3ejchc0s0st9rnzlry0m3fgc9j6vgwat3tq5ts');
  }, { timeout: 5000 });
  expect(loadRailWallet(PK, 'testnet4')).toBeNull();
  expect(container.textContent).toContain('Active wallet: identity-derived session wallet');
});

it('adopts a wallet created while signed out when the user signs in', async () => {
  const imported = importTestnet4AccountFromMnemonic(MNEMONIC);
  await render({ identityHex: null, identityPubkey: null, fetchFn: fetchFor(imported) });
  await importWallet(MNEMONIC);
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED_ADDRESS);
  }, { timeout: 5000 });
  expect(loadRailWallet(PK, 'testnet4')).toBeNull();

  // Sign-in without a remount: the tab-only wallet is adopted, not dropped.
  await render({ identityHex: SESSION_SECRET, identityPubkey: PK, fetchFn: fetchFor(imported) });
  await vi.waitFor(() => {
    expect(loadRailWallet(PK, 'testnet4')?.mnemonic).toBe(MNEMONIC);
  }, { timeout: 5000 });
  expect(container.textContent).toContain(IMPORTED_ADDRESS);
  expect(container.textContent).toContain('saved for this identity');
});

it('keeps the stored wallet for the identity that owns it across an account switch', async () => {
  saveRailWallet(PK, 'testnet4', { version: 1, mnemonic: MNEMONIC, createdAt: 1, source: 'created' });
  await render({ identityHex: SESSION_SECRET, identityPubkey: PK, fetchFn: fetchFor(importTestnet4AccountFromMnemonic(MNEMONIC)) });
  await vi.waitFor(() => {
    expect(container.textContent).toContain(IMPORTED_ADDRESS);
  }, { timeout: 5000 });

  // Switch to another identity with no stored rail wallet: the session
  // account takes over and the first identity's words are not on screen.
  await remount({ identityHex: SESSION_SECRET, identityPubkey: 'b2'.repeat(32), fetchFn: fetchFor(ACCOUNT) });
  await vi.waitFor(() => {
    expect(container.textContent).toContain('tb1q3ejchc0s0st9rnzlry0m3fgc9j6vgwat3tq5ts');
  }, { timeout: 5000 });
  expect(container.textContent).not.toContain(IMPORTED_ADDRESS);
  expect(container.textContent).not.toContain('abandon');
  expect(container.querySelector('[data-testid=testnet4-browser-wallet]')).toBeNull();
});
