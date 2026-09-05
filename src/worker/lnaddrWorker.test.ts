import { describe, expect, it, vi, beforeEach } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';

import worker from './lnaddrWorker';

const privateKey = hexToBytes('1'.padStart(64, '0'));
const pubkey = bytesToHex(schnorr.getPublicKey(privateKey));

async function makeClaim(name: string, callback: string, ip: string, sigLength = 128): Promise<Request> {
  const ts = Math.floor(Date.now() / 1000);
  const digestBytes = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`bao-lnaddr-claim-v1:${name}:${callback}:${pubkey}:${ts}`),
  ));
  const sig = bytesToHex(await schnorr.sign(digestBytes, privateKey));
  return new Request('https://2140.wtf/.well-known/lnurlp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ name, callback, pubkey, ts, sig: sig.slice(0, sigLength) }),
  });
}

function kvStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    delete: vi.fn(async (key: string) => { values.delete(key); }),
  };
}

const env = (kv: ReturnType<typeof kvStore>) => ({ LNADDR_KV: kv, LNADDR_DOMAIN: '2140.wtf' });

describe('lnaddr worker abuse limits', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects non-Schnorr-length signatures before verification', async () => {
    const kv = kvStore();
    const response = await worker.fetch(await makeClaim('alice', 'https://wallet.example/pay', '198.51.100.10', 64), env(kv));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'bad pubkey or sig' });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('rejects oversized claim bodies', async () => {
    const kv = kvStore();
    const body = 'x'.repeat(9_000);
    const response = await worker.fetch(new Request('https://2140.wtf/.well-known/lnurlp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length), 'CF-Connecting-IP': '198.51.100.11' },
      body,
    }), env(kv));
    expect(response.status).toBe(413);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('supports HEAD availability checks without returning a body', async () => {
    const kv = kvStore({
      'name:alice': JSON.stringify({ callback: 'https://wallet.example/pay', pubkey, claimedAt: Date.now() }),
    });
    const response = await worker.fetch(new Request('https://2140.wtf/.well-known/lnurlp/alice', { method: 'HEAD', headers: { 'CF-Connecting-IP': '198.51.100.12' } }), env(kv));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('rejects callback amounts outside the LUD-06 bounds', async () => {
    const kv = kvStore({
      'name:alice': JSON.stringify({ callback: 'https://wallet.example/pay', pubkey, claimedAt: Date.now() }),
    });
    const response = await worker.fetch(new Request('https://2140.wtf/.well-known/lnurlp/alice/callback?amount=0', { headers: { 'CF-Connecting-IP': '198.51.100.13' } }), env(kv));
    expect(response.status).toBe(400);
  });

  it('limits repeated claims from one client address', async () => {
    const kv = kvStore();
    const ip = '198.51.100.20';
    const responses = await Promise.all(
      Array.from({ length: 11 }, async (_, index) =>
        worker.fetch(await makeClaim(`rate-${index}`, 'https://wallet.example/pay', ip), env(kv)),
      ),
    );
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });
});
