import { Configuration, WalletApi, OnchainApi, LightningApi } from '@secondts/barkd';

/**
 * Client helpers for talking to a remote bark-web API
 * (https://gitlab.com/ark-bitcoin/labs/bark-web), the Hono proxy that sits in
 * front of a `barkd` Ark wallet daemon.
 *
 * The proxy exposes:
 *   GET  /api/config        → { arkServer, chainSource, network, walletDataPath }
 *   GET  /api/auth/status   → { authRequired, authed }
 *   POST /api/login         → { password } → session cookie
 *   POST /api/logout
 *   ALL  /api/barkd/*       → proxied barkd REST API (bearer injected server-side)
 *
 * The wallet (seed, VTXOs) always stays on the user's daemon — this app only
 * ever holds a session cookie.
 */

export interface BarkdServerConfig {
  arkServer: string;
  chainSource: string;
  network: string;
  walletDataPath: string;
}

export interface BarkdAuthStatus {
  authRequired: boolean;
  authed: boolean;
}

export interface BarkdApis {
  wallet: WalletApi;
  onchain: OnchainApi;
  lightning: LightningApi;
}

/** Normalize a user-entered server URL: trim, require http(s), strip trailing slashes. */
export function normalizeBarkdUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Enter the URL of your bark-web server.');

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('That doesn’t look like a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) URLs are supported.');
  }
  return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
}

/** True for URLs browsers will refuse from an https page (plain http, non-local). */
export function isInsecureRemoteUrl(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  if (url.protocol === 'https:') return false;
  const host = url.hostname;
  return !(
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

async function apiFetch<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'X-Requested-With': 'bark', ...init?.headers },
    });
  } catch {
    throw new Error(
      'Could not reach the server. Check the URL, that bark-web is running, and that its ALLOWED_ORIGINS includes this app.',
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (response.status === 401) throw new Error('Invalid password.');
    if (response.status === 429) throw new Error('Too many attempts — the server rate-limited you. Wait a bit and retry.');
    throw new Error(body?.error ? `Server error: ${body.error}` : `Server returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

export function fetchBarkdConfig(baseUrl: string): Promise<BarkdServerConfig> {
  return apiFetch<BarkdServerConfig>(baseUrl, '/api/config');
}

export function fetchBarkdAuthStatus(baseUrl: string): Promise<BarkdAuthStatus> {
  return apiFetch<BarkdAuthStatus>(baseUrl, '/api/auth/status');
}

export function loginBarkd(baseUrl: string, password: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(baseUrl, '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

export async function logoutBarkd(baseUrl: string): Promise<void> {
  try {
    await apiFetch<{ ok: boolean }>(baseUrl, '/api/logout', { method: 'POST' });
  } catch {
    // Best effort — the cookie expires on the server side anyway.
  }
}

// The generated client is stateless (the browser holds the session cookie), so
// one set of API instances per server URL is enough.
const apisCache = new Map<string, BarkdApis>();

export function getBarkdApis(baseUrl: string): BarkdApis {
  const cached = apisCache.get(baseUrl);
  if (cached) return cached;

  const configuration = new Configuration({
    basePath: `${baseUrl}/api/barkd`,
    credentials: 'include',
    headers: { 'X-Requested-With': 'bark' },
  });
  const apis: BarkdApis = {
    wallet: new WalletApi(configuration),
    onchain: new OnchainApi(configuration),
    lightning: new LightningApi(configuration),
  };
  apisCache.set(baseUrl, apis);
  return apis;
}
