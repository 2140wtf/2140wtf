import { describe, expect, it, vi } from 'vitest';

import {
  buildBlossomBackupTag,
  computeBackupHash,
  createBackupFile,
  fetchEncryptedBackup,
  parseBlossomBackupTag,
} from '@/lib/encryptedBackup';

describe('computeBackupHash', () => {
  it('returns a 64-character hex sha256', () => {
    const hash = computeBackupHash('hello world');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });
});

describe('createBackupFile', () => {
  it('creates a text/plain File containing the plaintext', () => {
    const file = createBackupFile('encrypted payload');
    expect(file.name).toBe('2140-settings-backup.txt');
    expect(file.type).toBe('text/plain');
  });
});

describe('buildBlossomBackupTag', () => {
  it('produces a tag with url and matching sha256', () => {
    const plaintext = 'encrypted payload';
    const url = 'https://blossom.example.com/abc123';
    const tag = buildBlossomBackupTag(url, plaintext);

    expect(tag).toEqual(['blossom', url, computeBackupHash(plaintext)]);
  });
});

describe('parseBlossomBackupTag', () => {
  it('extracts url and hash from a valid tag', () => {
    const tags = [['blossom', 'https://blossom.example.com/abc123', 'deadbeef']];
    expect(parseBlossomBackupTag(tags)).toEqual({ url: 'https://blossom.example.com/abc123', hash: 'deadbeef' });
  });

  it('rejects non-https URLs', () => {
    const tags = [['blossom', 'http://insecure.example.com/abc', 'deadbeef']];
    expect(parseBlossomBackupTag(tags)).toBeUndefined();
  });

  it('returns undefined when no blossom tag exists', () => {
    expect(parseBlossomBackupTag([])).toBeUndefined();
    expect(parseBlossomBackupTag([['d', 'foo']])).toBeUndefined();
  });
});

describe('fetchEncryptedBackup', () => {
  it('returns ciphertext when the hash matches', async () => {
    const plaintext = 'encrypted payload';
    const hash = computeBackupHash(plaintext);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(plaintext),
    });

    const result = await fetchEncryptedBackup('https://blossom.example.com/abc123', hash);
    expect(result).toBe(plaintext);
  });

  it('returns null when the hash mismatches', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('tampered payload'),
    });

    const result = await fetchEncryptedBackup('https://blossom.example.com/abc123', 'deadbeef');
    expect(result).toBeNull();
  });

  it('returns null on fetch error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await fetchEncryptedBackup('https://blossom.example.com/abc123', 'deadbeef');
    expect(result).toBeNull();
  });
});
