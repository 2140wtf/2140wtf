import type { NostrEvent } from '@nostrify/nostrify';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import {
  buildNsiteManifest,
  isNsiteHash,
  isSafeNsitePath,
  resolveNsiteServers,
  verifyNsiteContent,
} from './nsiteContent';

function event(tags: string[][]): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: 35128,
    tags,
    content: '',
    sig: 'c'.repeat(128),
  };
}

describe('nsite content trust boundaries', () => {
  it('accepts only canonical paths and SHA-256 hashes in the manifest', () => {
    const manifest = buildNsiteManifest(event([
      ['path', '/index.html', 'a'.repeat(64)],
      ['path', '/assets/app.js', 'b'.repeat(64)],
      ['path', '../secret', 'c'.repeat(64)],
      ['path', '/encoded/%2e%2e/secret', 'd'.repeat(64)],
      ['path', '/bad-hash.js', 'not-a-hash'],
      ['path', 'https://evil.example/owned.js', 'e'.repeat(64)],
    ]));

    expect([...manifest]).toEqual([
      ['/index.html', 'a'.repeat(64)],
      ['/assets/app.js', 'b'.repeat(64)],
    ]);
  });

  it('rejects malformed and encoded traversal paths', () => {
    expect(isSafeNsitePath('/')).toBe(true);
    expect(isSafeNsitePath('/app.js')).toBe(true);
    expect(isSafeNsitePath('../secret')).toBe(false);
    expect(isSafeNsitePath('/../secret')).toBe(false);
    expect(isSafeNsitePath('/%2e%2e/secret')).toBe(false);
    expect(isSafeNsitePath('/app.js?x=1')).toBe(false);
    expect(isSafeNsitePath('//evil.example/file')).toBe(false);
  });

  it('accepts only lowercase SHA-256 hex digests', () => {
    expect(isNsiteHash('a'.repeat(64))).toBe(true);
    expect(isNsiteHash('A'.repeat(64))).toBe(false);
    expect(isNsiteHash('a'.repeat(63))).toBe(false);
  });

  it('filters event and fallback servers to public HTTPS origins', () => {
    const servers = resolveNsiteServers(event([
      ['server', 'https://cdn.example/'],
      ['server', 'http://127.0.0.1:8080/'],
      ['server', 'https://user:pass@cdn.example/'],
      ['server', 'javascript:alert(1)'],
    ]), [
      'https://fallback.example/',
    ]);

    expect(servers).toEqual(['https://cdn.example/']);

    const fallback = resolveNsiteServers(event([]), [
      'https://fallback.example/',
      'https://localhost.example/',
      'https://192.168.1.10/',
    ]);
    expect(fallback).toEqual(['https://fallback.example/', 'https://localhost.example/']);
  });

  it('requires fetched bytes to match the manifest hash', () => {
    const body = new TextEncoder().encode('nsite content');
    const hash = bytesToHex(sha256(body));
    expect(verifyNsiteContent(body, hash)).toBe(true);
    expect(verifyNsiteContent(new TextEncoder().encode('tampered'), hash)).toBe(false);
    expect(verifyNsiteContent(body, 'not-a-hash')).toBe(false);
  });
});
