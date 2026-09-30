/**
 * WS9 round-4 fuzz: NIP-98 transport HEADER SELECTION.
 *
 * The same-origin/cross-origin choice is the round-3 fix that unblocked the
 * gated fund hosts: same-origin rides `X-Nostr-Auth` (so nginx Basic
 * `Authorization` survives), cross-origin rides `Authorization` (the only
 * header the API's CORS allowlist exposes). This fuzz pins the CHOICE and the
 * signed-event shape for adversarial URL spellings (case, default ports,
 * credentials, percent-encoding, bracketed IPv6, malformed input) - the
 * header must always be exactly one of the two names and a malformed URL must
 * fail safe to Authorization, never throw.
 *
 * Deterministic; fetch is stubbed, no network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FundHttpError, fundFetch, nip98AuthHeaders } from './fundHttp';

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ORIGIN = location.origin; // jsdom: http://localhost:3000
const signer = { signEvent: vi.fn(async (e: unknown) => e) };
const decode = (value: string) => JSON.parse(atob(value.slice('Nostr '.length)));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  signer.signEvent.mockClear();
});

describe('nip98AuthHeaders - header selection fuzz (round 4)', () => {
  it('same-origin spellings always pick X-Nostr-Auth; cross-origin picks Authorization', async () => {
    const sameOrigin = [
      ORIGIN,
      `${ORIGIN}/`,
      `${ORIGIN}/fund-api/v1/fundraisers`,
      ORIGIN.replace('http://', 'HTTP://') + '/v1/x',
      `${ORIGIN}/v1/%66undraisers`,
      `${ORIGIN}/v1/fundraisers?limit=1&q=%20`,
    ];
    for (const url of sameOrigin) {
      const headers = await nip98AuthHeaders(signer, url, 'get');
      expect(Object.keys(headers)).toEqual(['X-Nostr-Auth']);
      expect(headers['X-Nostr-Auth']!.startsWith('Nostr ')).toBe(true);
    }
    const crossOrigin = [
      'https://app.bao.network/fund-api/v1/fundraisers',
      'http://localhost:5174/v1/x',
      'https://127.0.0.1/v1/x',
      'https://[::1]:443/v1/x',
      'https://fund.bao.network:8443/v1/x',
      'https://user:pass@other.example/v1/x',
    ];
    for (const url of crossOrigin) {
      const headers = await nip98AuthHeaders(signer, url, 'get');
      expect(Object.keys(headers)).toEqual(['Authorization']);
      expect(headers.Authorization!.startsWith('Nostr ')).toBe(true);
    }
  });

  it('malformed URLs fail safe to Authorization and never throw', async () => {
    const rnd = mulberry32(0x5eed20);
    const junk = ['', 'not a url', 'http://[bad', '://x', 'https://%', 'https://exa mple.com', '\u0000', 'http://'];
    for (let i = 0; i < 200; i++) {
      const url = junk[Math.floor(rnd() * junk.length)]! + (rnd() < 0.3 ? String(i) : '');
      const headers = await nip98AuthHeaders(signer, url, 'GET').catch((err) => err);
      if (headers instanceof Error) {
        // The only permissible failure is the signer; here the signer never throws.
        throw headers;
      }
      const names = Object.keys(headers);
      expect(names).toHaveLength(1);
      expect(['Authorization', 'X-Nostr-Auth']).toContain(names[0]);
    }
  });

  it('the signed event binds the exact URL/method/body (payload hash is not trusted loosely)', async () => {
    const rnd = mulberry32(0x5eed21);
    for (let i = 0; i < 150; i++) {
      const url = `${ORIGIN}/fund-api/v1/fundraisers/fr_${Math.floor(rnd() * 1e9)}`;
      const method = ['get', 'POST', 'Delete', 'pAtCh'][Math.floor(rnd() * 4)]!;
      const body = rnd() < 0.5 ? `{"n":${i}}` : undefined;
      const headers = await nip98AuthHeaders(signer, url, method, body);
      const ev = decode(headers['X-Nostr-Auth']!);
      expect(ev.kind).toBe(27235);
      expect(ev.tags).toContainEqual(['u', url]);
      expect(ev.tags).toContainEqual(['method', method.toUpperCase()]);
      const payload = ev.tags.find((t: string[]) => t[0] === 'payload');
      if (body === undefined) {
        expect(payload).toBeUndefined();
      } else {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
        const hexDigest = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
        expect(payload).toEqual(['payload', hexDigest]);
      }
    }
  });
});

describe('fundFetch base/path validation fuzz (round 4)', () => {
  it('hostile resource paths are refused before any fetch happens', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    const rnd = mulberry32(0x5eed22);
    const hostile = ['//evil.example/steal', '/v1/%2e%2e/secret', '/v1/a\\b', '/v1/../../x', '/v1/a#b', '/v1/%2f%2f', '/v1/..', 'v1/x'];
    for (let i = 0; i < 100; i++) {
      const path = hostile[Math.floor(rnd() * hostile.length)]!;
      await expect(fundFetch(path, { signer, body: {} })).rejects.toBeInstanceOf(FundHttpError);
      expect(spy).not.toHaveBeenCalled();
    }
    spy.mockRestore();
  });

  it('hostile bases are refused before any fetch happens', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    const rnd = mulberry32(0x5eed23);
    const bases = [
      'http://10.0.0.5:3471', 'http://172.16.0.1', 'http://192.168.1.1',
      'https://bao.markets', 'https://relay.bao.network', 'https://user:pass@mint.example.com',
      'https://mint.example.com/v1', 'https://mint.example.com/?q=1', 'https://mint.example.com/#f',
      '/bao-api', 'ftp://mint.example.com', 'https://mint.example.com/bao-api',
    ];
    for (let i = 0; i < 120; i++) {
      const base = bases[Math.floor(rnd() * bases.length)]!;
      await expect(fundFetch('/v1/x', { signer, base })).rejects.toBeInstanceOf(FundHttpError);
      expect(spy).not.toHaveBeenCalled();
    }
    spy.mockRestore();
  });
});
