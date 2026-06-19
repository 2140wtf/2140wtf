import { describe, expect, it } from 'vitest';
import { redactSecrets, redactSensitiveData } from './redactSecrets';

describe('redactSecrets', () => {
  it('redacts nsec private keys', () => {
    const nsec = 'nsec1' + 'a'.repeat(58);
    expect(redactSecrets(`key=${nsec}`)).toBe('key=nsec1***');
  });

  it('redacts nostr+walletconnect URIs', () => {
    const uri = 'nostr+walletconnect://pubkey?relay=wss://r&secret=abc123';
    expect(redactSecrets(`failed: ${uri}`)).toBe('failed: [nwc-uri-redacted]');
  });

  it('redacts nostrwalletconnect URIs', () => {
    const uri = 'nostrwalletconnect://pubkey?relay=wss://r&secret=abc123';
    expect(redactSecrets(`failed: ${uri}`)).toBe('failed: [nwc-uri-redacted]');
  });

  it('redacts bunker URIs', () => {
    const uri = 'bunker://pubkey?relay=wss://r&secret=abc123';
    expect(redactSecrets(`failed: ${uri}`)).toBe('failed: [bunker-uri-redacted]');
  });

  it('redacts hex private keys when context suggests a secret', () => {
    const hex = 'a'.repeat(64);
    expect(redactSecrets(`private key: ${hex}`)).toBe('private key: [hex-redacted]');
    expect(redactSecrets(`secret=${hex}`)).toBe('secret=[hex-redacted]');
  });

  it('does not alter unrelated strings', () => {
    expect(redactSecrets('hello world')).toBe('hello world');
  });
});

describe('redactSensitiveData', () => {
  it('redacts values for sensitive keys', () => {
    const input = {
      user: 'alice',
      secret: 'shh',
      nested: { privateKey: 'deadbeef', safe: 'ok' },
    };
    const out = redactSensitiveData(input) as typeof input;
    expect(out.user).toBe('alice');
    expect(out.secret).toBe('[REDACTED]');
    expect(out.nested.privateKey).toBe('[REDACTED]');
    expect(out.nested.safe).toBe('ok');
  });

  it('redacts secrets inside arrays', () => {
    const input = ['nsec1' + 'a'.repeat(58), 'safe'];
    const out = redactSensitiveData(input) as string[];
    expect(out[0]).toBe('nsec1***');
    expect(out[1]).toBe('safe');
  });
});
