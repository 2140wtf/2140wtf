import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  secureStorage: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
  },
}));

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: mocks.secureStorage,
}));

import { secureStorage } from './secureStorage';

describe('secureStorage web plaintext warnings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(false);
  });

  it('warns when storing sensitive keys in plaintext localStorage', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await secureStorage.setItem('nsec1abcdef', 'secret');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('storing sensitive key "nsec1abcdef" in plaintext localStorage'),
    );
    warnSpy.mockRestore();
  });

  it('warns for NWC, wallet, seed, cashu, and proof keys', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const key of ['nwcUri', 'walletSeed', 'seedPhrase', 'cashuProofs', 'testProof']) {
      await secureStorage.setItem(key, 'secret');
    }
    expect(warnSpy).toHaveBeenCalledTimes(5);
    warnSpy.mockRestore();
  });

  it('does not warn for non-sensitive keys', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await secureStorage.setItem('theme', 'dark');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
