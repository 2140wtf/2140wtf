// Wallet backup panel: export builds an encrypted file; restore decrypts,
// refuses foreign identities/wrong passwords, and hands the key to the hook.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { WalletBackupPanel } from './WalletBackupPanel';
import { buildWalletBackupPayload, decryptWalletBackup, encryptWalletBackup } from './walletBackupFile';
import { loadRailWallet, saveRailWallet } from './rails/railWalletStore';

const mocks = vi.hoisted(() => ({
  auth: {
    pubkey: null as string | null,
    identitySecrets: () => ({ nsec: null as string | null, seedPhrase: null as string | null }),
  },
  portable: {
    status: 'ready' as string,
    mints: [] as string[],
    getWalletKeyHex: () => null as string | null,
    applyImportedWalletKey: vi.fn(async () => true),
    setActiveMint: vi.fn(async () => {}),
  },
}));

vi.mock('../auth/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('./useNip60Wallet', () => ({ useNip60Wallet: () => mocks.portable }));

const xonly = (seed: number) => bytesToHex(schnorr.getPublicKey(Uint8Array.from({ length: 32 }, () => seed)));
const PUB = xonly(7);
const OTHER = xonly(8);
const WALLET_KEY = 'cd'.repeat(32);
const PASSWORD = 'backup password 123';
const RAIL_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

let container: HTMLDivElement;
let root: Root;
const blobs: Blob[] = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  vi.clearAllMocks();
  blobs.length = 0;
  mocks.auth.pubkey = PUB;
  mocks.auth.identitySecrets = () => ({ nsec: null, seedPhrase: null });
  mocks.portable.status = 'ready';
  mocks.portable.mints = [];
  mocks.portable.getWalletKeyHex = () => WALLET_KEY;
  mocks.portable.applyImportedWalletKey = vi.fn(async () => true);
  mocks.portable.setActiveMint = vi.fn(async () => {});
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn((b: Blob) => { blobs.push(b); return 'blob:test'; }), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function render() {
  await act(async () => root.render(<WalletBackupPanel />));
}

function byTestId(id: string) {
  return container.querySelector<HTMLElement>(`[data-testid=${id}]`)!;
}

/**
 * Click and POLL for the async handler's visible effect (PBKDF2 runs on the
 * threadpool, so a microtask flush is not enough and a fixed sleep flakes
 * under full-suite load - see deep-test round notes). Pass the observable the
 * handler must produce; the helper waits up to 8s for it.
 */
async function click(testId: string, settled: () => void | Promise<void>) {
  await act(async () => {
    (byTestId(testId) as HTMLButtonElement).click();
  });
  await vi.waitFor(settled, { timeout: 8000 });
}

it('exports an encrypted file that decrypts back to the wallet key', async () => {
  await render();
  await act(async () => {
    setValue(byTestId('wallet-backup-password') as HTMLInputElement, PASSWORD);
    setValue(byTestId('wallet-backup-password-confirm') as HTMLInputElement, PASSWORD);
  });
  await click('wallet-backup-export', () => expect(blobs).toHaveLength(1));

  const file = await blobs[0].text();
  expect(file).not.toContain(WALLET_KEY);
  const payload = await decryptWalletBackup(file, PASSWORD, PUB);
  expect(payload.walletKey).toBe(WALLET_KEY);
  expect(container.textContent).toContain('Encrypted backup downloaded');
});

it('restores a backup for the signed-in identity and re-syncs', async () => {
  const file = await encryptWalletBackup(
    buildWalletBackupPayload({ identityPubkey: PUB, walletKeyHex: WALLET_KEY, mints: ['https://mint.example'], nowSeconds: 1 }),
    PASSWORD,
  );
  await render();
  await act(async () => {
    setValue(byTestId('wallet-backup-text') as HTMLTextAreaElement, file);
    setValue(byTestId('wallet-backup-restore-password') as HTMLInputElement, PASSWORD);
  });
  await click('wallet-backup-restore', () => expect(mocks.portable.applyImportedWalletKey).toHaveBeenCalled());
  expect(mocks.portable.applyImportedWalletKey).toHaveBeenCalledWith(WALLET_KEY);
  expect(mocks.portable.setActiveMint).toHaveBeenCalledWith('https://mint.example');
  expect(container.textContent).toContain('Wallet key restored');
});

it('refuses a wrong password and a file for another identity', async () => {
  const file = await encryptWalletBackup(
    buildWalletBackupPayload({ identityPubkey: PUB, walletKeyHex: WALLET_KEY, mints: [], nowSeconds: 1 }),
    PASSWORD,
  );
  await render();
  await act(async () => {
    setValue(byTestId('wallet-backup-text') as HTMLTextAreaElement, file);
    setValue(byTestId('wallet-backup-restore-password') as HTMLInputElement, 'not the password');
  });
  await click('wallet-backup-restore', () => expect(container.textContent).toContain('Wrong password'));
  expect(mocks.portable.applyImportedWalletKey).not.toHaveBeenCalled();

  const foreign = await encryptWalletBackup(
    buildWalletBackupPayload({ identityPubkey: OTHER, walletKeyHex: WALLET_KEY, mints: [], nowSeconds: 1 }),
    PASSWORD,
  );
  await act(async () => {
    setValue(byTestId('wallet-backup-text') as HTMLTextAreaElement, foreign);
    setValue(byTestId('wallet-backup-restore-password') as HTMLInputElement, PASSWORD);
  });
  await click('wallet-backup-restore', () => expect(container.textContent).toContain('different identity'));
  expect(mocks.portable.applyImportedWalletKey).not.toHaveBeenCalled();
});

it('exports the browser-created rail wallets (encrypted) with the backup', async () => {
  saveRailWallet(PUB, 'testnet4', { version: 1, mnemonic: RAIL_MNEMONIC, createdAt: 123, source: 'created' });
  await render();
  expect(container.textContent).toContain('Includes browser wallets: Bitcoin testnet4');
  await act(async () => {
    setValue(byTestId('wallet-backup-password') as HTMLInputElement, PASSWORD);
    setValue(byTestId('wallet-backup-password-confirm') as HTMLInputElement, PASSWORD);
  });
  await click('wallet-backup-export', () => expect(blobs).toHaveLength(1));

  const file = await blobs[0].text();
  expect(file).not.toContain(RAIL_MNEMONIC);
  const payload = await decryptWalletBackup(file, PASSWORD, PUB);
  expect(payload.railWallets).toEqual({
    testnet4: { mnemonic: RAIL_MNEMONIC, createdAt: 123, source: 'created' },
  });
});

it('restores rail wallets into the per-identity store when the identity matches', async () => {
  const file = await encryptWalletBackup(
    buildWalletBackupPayload({
      identityPubkey: PUB,
      walletKeyHex: WALLET_KEY,
      mints: [],
      railWallets: { testnet4: { version: 1, mnemonic: RAIL_MNEMONIC, createdAt: 9, source: 'imported' } },
      nowSeconds: 1,
    }),
    PASSWORD,
  );
  await render();
  await act(async () => {
    setValue(byTestId('wallet-backup-text') as HTMLTextAreaElement, file);
    setValue(byTestId('wallet-backup-restore-password') as HTMLInputElement, PASSWORD);
  });
  await click('wallet-backup-restore', () => expect(mocks.portable.applyImportedWalletKey).toHaveBeenCalled());
  expect(loadRailWallet(PUB, 'testnet4')).toEqual({
    version: 1,
    mnemonic: RAIL_MNEMONIC,
    createdAt: 9,
    source: 'imported',
  });
  expect(container.textContent).toContain('Browser wallets restored: Bitcoin testnet4');
});

it('offers no controls while signed out', async () => {
  mocks.auth.pubkey = null;
  await render();
  expect(container.textContent).toContain('Sign in to back up or restore');
  expect(container.querySelector('[data-testid=wallet-backup-export]')).toBeNull();
});
