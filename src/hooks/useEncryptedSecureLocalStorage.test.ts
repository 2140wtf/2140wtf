import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useEncryptedSecureLocalStorage } from './useEncryptedSecureLocalStorage';
import { makeNip44 } from '@/test/helpers';

describe('useEncryptedSecureLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('encrypts plaintext values before persistence', async () => {
    const nip44 = makeNip44();

    const { result } = renderHook(() =>
      useEncryptedSecureLocalStorage('key', { count: 0 }, nip44, 'pubkey'),
    );

    act(() => {
      result.current[1]({ count: 1 });
    });

    await waitFor(() => {
      expect(nip44.encrypt).toHaveBeenCalledWith('pubkey', JSON.stringify({ count: 1 }));
    });

    const stored = localStorage.getItem('key');
    expect(JSON.parse(stored!)).toBe('enc:{"count":1}');
  });

  it('decrypts stored ciphertext and migrates plaintext JSON', async () => {
    const nip44 = makeNip44();
    localStorage.setItem('key', JSON.stringify({ count: 5 }));

    const { result } = renderHook(() =>
      useEncryptedSecureLocalStorage('key', { count: 0 }, nip44, 'pubkey'),
    );

    await waitFor(() => {
      expect(result.current[0]).toEqual({ count: 5 });
      expect(result.current[2]).toBe(true);
    });

    // Plaintext should be encrypted and rewritten.
    expect(nip44.encrypt).toHaveBeenCalledWith('pubkey', JSON.stringify({ count: 5 }));
    expect(JSON.parse(localStorage.getItem('key')!)).toBe('enc:{"count":5}');
  });

  it('returns default value when ciphertext cannot be decrypted', async () => {
    const nip44 = makeNip44();
    localStorage.setItem('key', 'garbage');

    const { result } = renderHook(() =>
      useEncryptedSecureLocalStorage('key', { count: 0 }, nip44, 'pubkey'),
    );

    await waitFor(() => {
      expect(result.current[0]).toEqual({ count: 0 });
      expect(result.current[2]).toBe(true);
    });
  });
});
