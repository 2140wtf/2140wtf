import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getGuestKeyHex, getGuestPubkeyHex, createGuestSigner } from './guestIdentity';

const STORAGE_KEY = 'bao-fund-guest-key';

describe('guestIdentity', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
  });

  it('generates a 64-char hex key on first access', () => {
    const key = getGuestKeyHex();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('persists the key in localStorage', () => {
    getGuestKeyHex();
    expect(store[STORAGE_KEY]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same key on subsequent calls (stable identity)', () => {
    const a = getGuestKeyHex();
    const b = getGuestKeyHex();
    expect(a).toBe(b);
  });

  it('reuses an existing valid key from localStorage', () => {
    const existing = 'ab'.repeat(32);
    store[STORAGE_KEY] = existing;
    expect(getGuestKeyHex()).toBe(existing);
  });

  it('regenerates when the stored key is invalid hex', () => {
    store[STORAGE_KEY] = 'not-valid-hex';
    const key = getGuestKeyHex();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toBe('not-valid-hex');
  });

  it('getGuestPubkeyHex returns a valid compressed pubkey derived from the guest key', () => {
    const key = getGuestKeyHex();
    const pub = getGuestPubkeyHex();
    // nostr-tools getPublicKey returns x-only (64 hex chars)
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
    expect(pub).not.toBe(key); // pubkey ≠ privkey
  });

  it('createGuestSigner returns a signer that produces NIP-98-compatible events', async () => {
    const signer = createGuestSigner();
    const event = await signer.signEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', 'https://api.example.com/test'], ['method', 'GET']],
      content: '',
    });
    expect(event.kind).toBe(27235);
    expect(event.tags.length).toBeGreaterThan(0);
    expect(event.sig).toMatch(/^[0-9a-f]+$/);
  });
});
