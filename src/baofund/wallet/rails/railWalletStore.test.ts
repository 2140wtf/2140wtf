/**
 * railWalletStore — per-identity browser storage for user-created testnet
 * rail wallets. Round-trip, identity isolation, invalid-pubkey refusal (no
 * global fallback), BIP-39 validation and corrupt-slot tolerance.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRailWallet,
  loadRailWallet,
  loadRailWallets,
  normalizeRailWalletMnemonic,
  normalizeRailWalletPubkey,
  railWalletStorageKey,
  readLiquidReceiveIndex,
  readTestnet4Cursors,
  saveLiquidReceiveIndex,
  saveRailWallet,
  saveTestnet4Cursors,
  LIQUID_RECEIVE_CURSOR_PREFIX,
  RAIL_WALLETS_STORAGE_PREFIX,
  TESTNET4_CURSOR_PREFIX,
  type RailWalletRecord,
} from './railWalletStore';

const PK = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
// Standard BIP-39 test vectors (testnet-only material, never real funds).
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_2 = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

const record = (mnemonic = MNEMONIC, overrides: Partial<RailWalletRecord> = {}): RailWalletRecord => ({
  version: 1,
  mnemonic,
  createdAt: 1_700_000_000,
  source: 'created',
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('railWalletStore', () => {
  it('round-trips created and imported records under the per-identity key', () => {
    expect(railWalletStorageKey(PK)).toBe(`${RAIL_WALLETS_STORAGE_PREFIX}${PK}`);
    expect(saveRailWallet(PK, 'testnet4', record(MNEMONIC))).toBe(true);
    expect(saveRailWallet(PK, 'liquid', record(MNEMONIC_2, { source: 'imported', createdAt: 2 }))).toBe(true);

    expect(loadRailWallet(PK, 'testnet4')).toEqual(record(MNEMONIC));
    expect(loadRailWallet(PK, 'liquid')).toEqual(record(MNEMONIC_2, { source: 'imported', createdAt: 2 }));
    expect(loadRailWallets(PK)).toEqual({
      testnet4: record(MNEMONIC),
      liquid: record(MNEMONIC_2, { source: 'imported', createdAt: 2 }),
    });
  });

  it('normalizes the mnemonic (case/whitespace) and the pubkey on write', () => {
    expect(saveRailWallet(PK.toUpperCase(), 'testnet4', record(`  ${MNEMONIC.toUpperCase().replace(/ /g, '   ')}  `))).toBe(true);
    // Exactly one slot, under the canonical lowercase key.
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(railWalletStorageKey(PK)!)).toBeTruthy();
    expect(loadRailWallet(PK, 'testnet4')?.mnemonic).toBe(MNEMONIC);
    expect(normalizeRailWalletPubkey(PK.toUpperCase())).toBe(PK);
  });

  it('isolates identities — one identity never reads another slot', () => {
    expect(saveRailWallet(PK, 'testnet4', record())).toBe(true);
    expect(loadRailWallet(OTHER, 'testnet4')).toBeNull();
    expect(loadRailWallets(OTHER)).toEqual({});
    // A slot for OTHER never appears as a fallback for PK or vice versa.
    expect(saveRailWallet(OTHER, 'liquid', record(MNEMONIC_2))).toBe(true);
    expect(loadRailWallet(PK, 'liquid')).toBeNull();
    expect(Object.keys(loadRailWallets(PK))).toEqual(['testnet4']);
  });

  it('rejects invalid pubkeys on read, write and clear — no global fallback', () => {
    for (const bad of [null, undefined, '', 'pk-test', 'ab'.repeat(31), `${PK}00`, 'zz'.repeat(32), 'AB'.repeat(32).toLowerCase() + '!']) {
      expect(railWalletStorageKey(bad)).toBeNull();
      expect(loadRailWallets(bad)).toEqual({});
      expect(loadRailWallet(bad, 'testnet4')).toBeNull();
      expect(saveRailWallet(bad, 'testnet4', record())).toBe(false);
      expect(clearRailWallet(bad, 'testnet4')).toBe(false);
    }
    expect(window.localStorage.length).toBe(0);
  });

  it('rejects invalid mnemonics and malformed records without writing', () => {
    const badMnemonics = [
      'not a mnemonic',
      'abandon abandon abandon', // 3 words
      Array(11).fill('abandon').join(' '), // 11 words
      Array(13).fill('abandon').join(' '), // 13 words (not a BIP-39 length)
      `${Array(24).fill('abandon').join(' ')} abandon`, // 25 words
      'x'.repeat(600),
      '',
    ];
    for (const mnemonic of badMnemonics) {
      expect(normalizeRailWalletMnemonic(mnemonic)).toBeNull();
      expect(saveRailWallet(PK, 'testnet4', record(mnemonic))).toBe(false);
    }
    expect(saveRailWallet(PK, 'testnet4', record(MNEMONIC, { version: 2 as unknown as 1 }))).toBe(false);
    expect(saveRailWallet(PK, 'testnet4', record(MNEMONIC, { createdAt: -1 }))).toBe(false);
    expect(saveRailWallet(PK, 'testnet4', record(MNEMONIC, { createdAt: 1.5 }))).toBe(false);
    expect(saveRailWallet(PK, 'testnet4', record(MNEMONIC, { source: 'stolen' as unknown as 'created' }))).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  it('accepts 24-word mnemonics and rejects unknown rails', () => {
    const m24 = Array(23).fill('abandon').join(' ') + ' art';
    expect(normalizeRailWalletMnemonic(m24)).toBe(m24);
    expect(saveRailWallet(PK, 'testnet4', record(m24))).toBe(true);
    expect(saveRailWallet(PK, 'signet' as unknown as 'testnet4', record())).toBe(false);
  });

  it('tolerates corrupt storage: bad JSON and invalid entries degrade to absent', () => {
    const key = railWalletStorageKey(PK)!;
    window.localStorage.setItem(key, 'not json');
    expect(loadRailWallets(PK)).toEqual({});

    window.localStorage.setItem(key, JSON.stringify([1, 2, 3]));
    expect(loadRailWallets(PK)).toEqual({});

    // A valid rail survives next to a corrupt one; unknown keys are ignored.
    window.localStorage.setItem(key, JSON.stringify({
      testnet4: record(),
      liquid: { version: 1, mnemonic: 'broken words', createdAt: 1, source: 'created' },
      signet: record(),
    }));
    expect(loadRailWallets(PK)).toEqual({ testnet4: record() });
  });

  it('clears one rail and drops the identity slot when the last wallet goes', () => {
    saveRailWallet(PK, 'testnet4', record());
    saveRailWallet(PK, 'liquid', record(MNEMONIC_2));
    expect(clearRailWallet(PK, 'testnet4')).toBe(true);
    expect(loadRailWallets(PK)).toEqual({ liquid: record(MNEMONIC_2) });
    expect(clearRailWallet(PK, 'liquid')).toBe(true);
    expect(window.localStorage.getItem(railWalletStorageKey(PK)!)).toBeNull();
    // Clearing an absent rail is a no-op success, not a failure.
    expect(clearRailWallet(PK, 'liquid')).toBe(true);
  });

  it('round-trips the per-identity Liquid receive cursor and refuses bad input', () => {
    expect(readLiquidReceiveIndex(PK)).toBe(0);
    expect(saveLiquidReceiveIndex(PK, 3)).toBe(true);
    expect(readLiquidReceiveIndex(PK)).toBe(3);
    expect(readLiquidReceiveIndex(PK.toUpperCase())).toBe(3);
    expect(window.localStorage.getItem(`${LIQUID_RECEIVE_CURSOR_PREFIX}${PK}`)).toBe('{"receiveIndex":3}');
    // Invalid values and pubkeys never write (no global fallback slot).
    expect(saveLiquidReceiveIndex(PK, -1)).toBe(false);
    expect(saveLiquidReceiveIndex(PK, 1.5)).toBe(false);
    expect(saveLiquidReceiveIndex('not-a-pubkey', 2)).toBe(false);
    expect(readLiquidReceiveIndex(null)).toBe(0);
    expect(window.localStorage.getItem(`${LIQUID_RECEIVE_CURSOR_PREFIX}${PK}`)).toBe('{"receiveIndex":3}');
    // Corrupt storage degrades to 0, never a throw.
    window.localStorage.setItem(`${LIQUID_RECEIVE_CURSOR_PREFIX}${PK}`, '{oops');
    expect(readLiquidReceiveIndex(PK)).toBe(0);
  });

  it('round-trips the per-identity testnet4 cursors and refuses bad input', () => {
    expect(readTestnet4Cursors(PK)).toEqual({ receiveIndex: 0, changeIndex: 0 });
    expect(saveTestnet4Cursors(PK, { receiveIndex: 2, changeIndex: 5 })).toBe(true);
    expect(readTestnet4Cursors(PK)).toEqual({ receiveIndex: 2, changeIndex: 5 });
    expect(readTestnet4Cursors(PK.toUpperCase())).toEqual({ receiveIndex: 2, changeIndex: 5 });
    expect(window.localStorage.getItem(`${TESTNET4_CURSOR_PREFIX}${PK}`)).toBe('{"receiveIndex":2,"changeIndex":5}');
    // Invalid values and pubkeys never write (no global fallback slot).
    expect(saveTestnet4Cursors(PK, { receiveIndex: -1, changeIndex: 0 })).toBe(false);
    expect(saveTestnet4Cursors(PK, { receiveIndex: 1.5, changeIndex: 0 })).toBe(false);
    expect(saveTestnet4Cursors('not-a-pubkey', { receiveIndex: 1, changeIndex: 1 })).toBe(false);
    expect(readTestnet4Cursors(null)).toEqual({ receiveIndex: 0, changeIndex: 0 });
    expect(window.localStorage.getItem(`${TESTNET4_CURSOR_PREFIX}${PK}`)).toBe('{"receiveIndex":2,"changeIndex":5}');
    // Corrupt/partial storage degrades to 0 per field, never a throw.
    window.localStorage.setItem(`${TESTNET4_CURSOR_PREFIX}${PK}`, '{oops');
    expect(readTestnet4Cursors(PK)).toEqual({ receiveIndex: 0, changeIndex: 0 });
    window.localStorage.setItem(`${TESTNET4_CURSOR_PREFIX}${PK}`, JSON.stringify({ receiveIndex: 3, changeIndex: 'x' }));
    expect(readTestnet4Cursors(PK)).toEqual({ receiveIndex: 3, changeIndex: 0 });
  });

  it('replaces a previous record for the same rail', () => {
    saveRailWallet(PK, 'testnet4', record(MNEMONIC));
    saveRailWallet(PK, 'testnet4', record(MNEMONIC_2, { source: 'imported', createdAt: 5 }));
    expect(loadRailWallet(PK, 'testnet4')).toEqual(record(MNEMONIC_2, { source: 'imported', createdAt: 5 }));
  });
});
