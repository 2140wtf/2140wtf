import { describe, expect, it, vi } from 'vitest';
import { generateSecretKey, nip19 } from 'nostr-tools';

import { createEncryptedLoginStorage } from './encryptedLoginStorage';

function makeBackend() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function makeLogin() {
  const sk = generateSecretKey();
  const nsec = nip19.nsecEncode(sk);
  return {
    id: `nsec:${nsec}`,
    type: 'nsec' as const,
    pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
    createdAt: new Date().toISOString(),
    data: { nsec },
  };
}

describe('createEncryptedLoginStorage', () => {
  it('encrypts on write and decrypts on read', async () => {
    const backend = makeBackend();
    const storage = createEncryptedLoginStorage(backend);
    const login = makeLogin();
    const plaintext = JSON.stringify([login]);

    await storage.setItem('nostr:login', plaintext);
    const stored = backend.getItem('nostr:login');
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(login.data.nsec);
    expect(stored).toContain('"v":1');

    const decrypted = await storage.getItem('nostr:login');
    expect(decrypted).toBe(plaintext);
  });

  it('migrates plaintext logins on first read', async () => {
    const backend = makeBackend();
    const storage = createEncryptedLoginStorage(backend);
    const login = makeLogin();
    const plaintext = JSON.stringify([login]);

    backend.setItem('nostr:login', plaintext);

    const firstRead = await storage.getItem('nostr:login');
    expect(firstRead).toBe(plaintext);

    const migrated = backend.getItem('nostr:login');
    expect(migrated).not.toContain(login.data.nsec);
    expect(migrated).toContain('"v":1');

    const secondRead = await storage.getItem('nostr:login');
    expect(secondRead).toBe(plaintext);
  });

  it('returns empty array when encrypted blob cannot be decrypted', async () => {
    const backend = makeBackend();
    const storage = createEncryptedLoginStorage(backend);

    const login = makeLogin();
    const plaintext = JSON.stringify([login]);
    await storage.setItem('nostr:login', plaintext);

    // Simulate a fresh tab with no session cache.
    const emptySession = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      key: vi.fn(),
      length: 0,
    };
    vi.stubGlobal('sessionStorage', emptySession);

    const storage2 = createEncryptedLoginStorage(backend);
    const result = await storage2.getItem('nostr:login');
    expect(result).toBe('[]');

    vi.unstubAllGlobals();
  });
});
