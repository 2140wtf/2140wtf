import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import {
  useNWCInternal,
  validateNwcUri,
} from './useNWC';

const { toastMock, LNMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  LNMock: vi.fn(),
}));

vi.mock('@/hooks/useEncryptedSecureLocalStorage', () => ({
  useEncryptedSecureLocalStorage: vi.fn(() => [[], vi.fn(), true]),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(() => ({
    user: {
      pubkey: 'user-pubkey',
      signer: {
        nip44: {
          encrypt: vi.fn(async (_pubkey: string, plaintext: string) => plaintext),
          decrypt: vi.fn(async (_pubkey: string, ciphertext: string) => ciphertext),
        },
      },
    },
  })),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@getalby/sdk', () => ({
  LN: LNMock,
}));

describe('validateNwcUri', () => {
  it('accepts a valid nostr+walletconnect:// URI with pubkey and relay', () => {
    const uri = 'nostr+walletconnect://?pubkey=abcdef&relay=wss://relay.example.com&secret=supersecret';
    const parsed = validateNwcUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed?.connectionString).toBe(uri);
    expect(parsed?.pubkey).toBe('abcdef');
    expect(parsed?.relay).toBe('wss://relay.example.com');
    expect(parsed?.secret).toBe('supersecret');
  });

  it('accepts the alternate nostrwalletconnect:// spelling', () => {
    const uri = 'nostrwalletconnect://?pubkey=pubkey1&relay=wss://r&secret=s';
    expect(validateNwcUri(uri)?.pubkey).toBe('pubkey1');
  });

  it('rejects a URI missing the pubkey query parameter', () => {
    const uri = 'nostr+walletconnect://?relay=wss://relay.example.com&secret=supersecret';
    expect(validateNwcUri(uri)).toBeNull();
  });

  it('rejects a URI missing the relay query parameter', () => {
    const uri = 'nostr+walletconnect://abcdef?secret=supersecret';
    expect(validateNwcUri(uri)).toBeNull();
  });

  it('rejects non-NWC protocols', () => {
    expect(validateNwcUri('https://example.com')).toBeNull();
    expect(validateNwcUri('')).toBeNull();
  });
});

describe('useNWCInternal.addConnection error handling', () => {
  it('redacts the NWC secret from connection-failure toast messages', async () => {
    const secret = 'extremely-sensitive-secret-123';
    const uri = `nostr+walletconnect://?pubkey=pubkey&relay=wss://r&secret=${secret}`;
    LNMock.mockImplementation(function () {
      throw new Error(`Failed to parse ${uri}`);
    });

    const { result } = renderHook(() => useNWCInternal('user-pubkey'));
    const ok = await result.current.addConnection(uri);
    expect(ok).toBe(false);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalled();
    });

    const toastCall = toastMock.mock.calls.find(
      (call) => call[0].title === 'Connection failed',
    );
    expect(toastCall).toBeDefined();
    const description = toastCall![0].description as string;
    expect(description).not.toContain(secret);
    expect(description).toContain('[nwc-uri-redacted]');
  });
});
