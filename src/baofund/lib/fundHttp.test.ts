// src/lib/fundHttp.test.ts
//
// Tests for the shared HTTP engine's OWN contracts: NIP-98 header shape
// (incl. the payload hash tag a previous copy of this protocol dropped),
// base-URL resolution, the GET-only proxy→public fallback chain, and the
// mutations-never-auto-retry rule.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fundApiOrigin, fundFetch, nip98Header, FundHttpError } from './fundHttp';

const signer = {
  signEvent: vi.fn(async (e: unknown) => e),
};

const PROXY = 'https://proxy.test';

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } });
}

/** Headerless double like the older client tests use. */
function bareJson(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  vi.stubEnv('VITE_BAO_FUND_API_URL', PROXY);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fundApiOrigin / base resolution', () => {
  it('env override wins and loses trailing slashes', () => {
    expect(fundApiOrigin()).toBe(PROXY);
  });
  it('falls back to the public origin without an override', () => {
    vi.stubEnv('VITE_BAO_FUND_API_URL', '');
    vi.stubEnv('VITE_BAO_FUND_API_URL', undefined as unknown as string);
    delete (import.meta.env as Record<string, unknown>).VITE_BAO_FUND_API_URL;
    expect(fundApiOrigin()).toBe(`${location.origin}/fund-api`);
  });
});

describe('nip98Header', () => {
  it('signs kind 27235 with u/method/nonce and NO payload tag for bodyless calls', async () => {
    const header = await nip98Header(signer, 'https://x/v1/y', 'get');
    const ev = JSON.parse(atob(header.slice('Nostr '.length)));
    expect(ev.kind).toBe(27235);
    expect(ev.tags).toContainEqual(['u', 'https://x/v1/y']);
    expect(ev.tags).toContainEqual(['method', 'GET']);
    expect(ev.tags.some(([k]: string[]) => k === 'nonce')).toBe(true);
    expect(ev.tags.some(([k]: string[]) => k === 'payload')).toBe(false);
  });

  it('adds the sha256 payload tag for body requests', async () => {
    const header = await nip98Header(signer, 'https://x/v1/y', 'POST', '{"a":1}');
    const ev = JSON.parse(atob(header.slice('Nostr '.length)));
    const payload = ev.tags.find(([k]: string[]) => k === 'payload')?.[1] as string;
    expect(payload).toMatch(/^[0-9a-f]{64}$/);
    // Independent digest of the exact body string.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('{"a":1}'));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(payload).toBe(hex);
  });
});

describe('NIP-98 header transport follows the CORS allowlist', () => {
  function authHeaders(call: [string | URL, RequestInit | undefined]): Record<string, string> {
    return (call[1]?.headers ?? {}) as Record<string, string>;
  }

  it('cross-origin Fund API bases use standard Authorization: Nostr', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await fundFetch('/v1/chat/public-rooms', { signer });
    const headers = authHeaders(fetchMock.mock.calls[0] as [string | URL, RequestInit | undefined]);
    // The API's CORS allowlist exposes Authorization, not X-Nostr-Auth.
    expect(headers.Authorization).toMatch(/^Nostr /);
    expect(headers['X-Nostr-Auth']).toBeUndefined();
  });

  it('same-origin Fund API bases keep X-Nostr-Auth for the access gate', async () => {
    delete (import.meta.env as Record<string, unknown>).VITE_BAO_FUND_API_URL;
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await fundFetch('/v1/chat/public-rooms', { signer });
    const headers = authHeaders(fetchMock.mock.calls[0] as [string | URL, RequestInit | undefined]);
    expect(headers['X-Nostr-Auth']).toMatch(/^Nostr /);
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('mutations never auto-retry', () => {
  it('a failing POST is single-shot even with a public host available', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(502, { error: { code: 'DOWN', message: 'upstream exploded' } }));
    vi.stubGlobal('fetch', fetchMock);
    const err = await fundFetch('/v1/things', { method: 'POST' }).catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1); // one leg, no retry
    expect(err).toBeInstanceOf(FundHttpError);
    expect((err as FundHttpError).status).toBe(502);
    expect((err as FundHttpError).code).toBe('DOWN');
  });

  it('network failure on a POST propagates raw instead of falling back', async () => {
    const boom = new TypeError('offline');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(boom)));
    await expect(fundFetch('/v1/things', { method: 'POST' })).rejects.toBe(boom);
  });
});

describe('Fund endpoint isolation', () => {
  it.each([502, 404])('never falls back to markets after HTTP %s', async status => {
    const fetchMock = vi.fn(async () => jsonResponse(status, { error: { message: 'Fund unavailable' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fundFetch('/v1/fundraisers')).rejects.toThrow('Fund unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(expect.arrayContaining([`${PROXY}/v1/fundraisers`]));
  });
  it('fails visibly on a missing proxy that serves SPA HTML', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fundFetch('/v1/fundraisers')).rejects.toMatchObject({ code: 'fund_api_wrong_service' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('never inherits the generic shared API environment variable', () => {
    vi.stubEnv('VITE_BAO_FUND_API_URL', '');
    vi.stubEnv('VITE_BAO_API_URL', 'https://relay.bao.network/bao-api');
    expect(fundApiOrigin()).toBe(`${location.origin}/fund-api`);
  });
  it.each(['https://relay.bao.network/bao-api', 'https://example.com/bao-api', 'https://user:secret@fund.example/api', 'https://fund.example/api/v1'])('rejects shared or malformed configuration %s before signing or I/O', async base => {
    const fetchMock = vi.fn(); const localSigner = { signEvent: vi.fn() };
    vi.stubGlobal('fetch', fetchMock);
    await expect(fundFetch('/v1/wallet/send', { base, method: 'POST', signer: localSigner })).rejects.toMatchObject({ code: 'fund_api_configuration' });
    expect(fetchMock).not.toHaveBeenCalled(); expect(localSigner.signEvent).not.toHaveBeenCalled();
  });
});

describe('explicit base callers own their routing', () => {
  it('no public-host retry is attempted for custom bases', async () => {
    const fetchMock = vi.fn(async (_url: string | URL) => jsonResponse(404, {}));
    vi.stubGlobal('fetch', fetchMock);
    await fundFetch('/v1/wallet/x', { base: 'https://alt.example/api' }).catch(() => null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://alt.example/api/v1/wallet/x');
  });
});

describe('path convention normalization (regression: doubled /v1 broke localhost)', () => {
  function usePublicHost() {
    vi.unstubAllEnvs(); // no override → DEV resolves to the public host
    delete (import.meta.env as Record<string, unknown>).VITE_BAO_FUND_API_URL;
  }
  it('fundraising-style /v1 paths resolve to a SINGLE /v1 on the public host', async () => {
    usePublicHost();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: [] })));
    await fundFetch('/v1/fundraisers?limit=1');
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      `${location.origin}/fund-api/v1/fundraisers?limit=1`,
    );
  });
  it('market-style bare paths still get the /v1 from the base', async () => {
    usePublicHost();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: {} })));
    await fundFetch('/markets/abc');
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      `${location.origin}/fund-api/v1/markets/abc`,
    );
  });
  it('wallet-style POSTs are not double-prefixed either', async () => {
    usePublicHost();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: {} })));
    await fundFetch('/v1/wallet/balance', { signer });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      `${location.origin}/fund-api/v1/wallet/balance`,
    );
  });
});

describe('envelope + signal plumbing', () => {
  it('message precedence: error.message beats top-level message beats HTTP n', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => bareJson(400, { message: 'flat', error: { message: 'nested' } })));
    await expect(fundFetch('/v1/x')).rejects.toThrow('nested');
    vi.stubGlobal('fetch', vi.fn(async () => bareJson(400, { message: 'flat' })));
    await expect(fundFetch('/v1/x')).rejects.toThrow('flat');
    vi.stubGlobal('fetch', vi.fn(async () => bareJson(419, {})));
    await expect(fundFetch('/v1/x')).rejects.toThrow('HTTP 419');
  });

  it('passes the caller\u2019s AbortSignal straight through to every leg', async () => {
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seen.push(init?.signal as AbortSignal);
      return jsonResponse(500, {});
    }));
    await fundFetch('/v1/sig', { signal: controller.signal }).catch(() => null);
    expect(seen[0]).toBe(controller.signal);
  });
});

it('blocks resource traversal before signing and disables HTTP redirects', async () => {
  const fetchMock = vi.fn(async () => jsonResponse(200, {})); const localSigner = { signEvent: vi.fn(async event => event) };
  vi.stubGlobal('fetch', fetchMock);
  for (const path of ['/v1/../bao-api', '/v1/%2e%2e/wallet', '//other.example/api']) {
    await expect(fundFetch(path, { signer: localSigner })).rejects.toMatchObject({ code: 'fund_api_path' });
  }
  expect(localSigner.signEvent).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  await fundFetch('/v1/fundraisers');
  expect(fetchMock.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ redirect: 'error' })]));
});

describe('NIP-98 signing origin (same-origin proxy)', () => {
  it('signs the canonical origin while fetching the proxied URL', async () => {
    // Same-origin proxy: request goes to <origin>/fund-api, but the API only
    // trusts app.bao.network/bao.fund, so the `u` tag must name the canonical
    // origin or the API returns 401.
    vi.stubEnv('VITE_BAO_FUND_API_URL', '');
    vi.stubEnv('VITE_BAO_FUND_API_SIGN_ORIGIN', 'https://app.bao.network');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const s = { signEvent: vi.fn(async (e: unknown) => e) };

    await fundFetch('/v1/chat/public-rooms', { signer: s });

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(`${location.origin}/fund-api/v1/chat/public-rooms`);
    const header = ((call[1] as RequestInit).headers as Record<string, string>)['X-Nostr-Auth'];
    const ev = JSON.parse(atob(header.slice('Nostr '.length)));
    expect(ev.tags).toContainEqual(['u', 'https://app.bao.network/fund-api/v1/chat/public-rooms']);
  });

  it('signs the request URL when no signing origin is configured', async () => {
    vi.stubEnv('VITE_BAO_FUND_API_SIGN_ORIGIN', '');
    vi.stubEnv('VITE_BAO_FUND_API_URL', PROXY);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const s = { signEvent: vi.fn(async (e: unknown) => e) };

    await fundFetch('/v1/x', { signer: s });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const header = (init.headers as Record<string, string>)['Authorization'];
    const ev = JSON.parse(atob(header.slice('Nostr '.length)));
    expect(ev.tags).toContainEqual(['u', 'https://proxy.test/v1/x']);
  });
});
