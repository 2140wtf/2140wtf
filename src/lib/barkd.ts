import {
  Configuration,
  FetchError,
  ResponseError,
  WalletApi,
  OnchainApi,
  LightningApi,
  HistoryApi,
  BoardsApi,
  FeesApi,
} from '@secondts/barkd';

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
  history: HistoryApi;
  boards: BoardsApi;
  fees: FeesApi;
}

function isLoopback(hostname: string): boolean {
  // The whole 127.0.0.0/8 range is potentially trustworthy per the spec.
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.startsWith('127.') || hostname === '[::1]';
}

/**
 * Normalize a user-entered server URL: trim, require http(s), strip trailing
 * slashes. Plain http is only allowed for loopback — browsers (and the native
 * WebViews) refuse every other cleartext URL from a secure context, so
 * accepting them would just produce confusing connection failures.
 */
export function normalizeBarkdUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Enter the URL of your bark-web server.');

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('That doesn’t look like a valid URL.');
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new Error(
      'Plain http only works for localhost. Put the server behind TLS (Tailscale Serve, Caddy) and use its https URL.',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) URLs are supported.');
  }
  return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
}

async function apiFetch<T>(
  baseUrl: string,
  path: string,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<T> {
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
    if (response.status === 401) throw new Error(INVALID_PASSWORD_MESSAGE);
    if (response.status === 429) throw new Error('Too many attempts — the server rate-limited you. Wait a bit and retry.');
    throw new Error(body?.error ? `Server error: ${body.error}` : `Server returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

/** Message used for 401s from barkd calls — matched by hooks to trigger re-auth. */
export const SESSION_EXPIRED_MESSAGE = 'Session expired — reconnect to the server.';

/** Message thrown by apiFetch on a 401 from /api/login. */
export const INVALID_PASSWORD_MESSAGE = 'Invalid password.';

/**
 * Map an error thrown by the generated `@secondts/barkd` client to a
 * human-readable message. The generated client's own messages are gibberish
 * ("Response returned an error code"), so hooks should wrap their calls with
 * {@link withFriendlyBarkdErrors} instead of letting them reach the UI raw.
 */
export async function friendlyBarkdError(error: unknown): Promise<Error> {
  if (error instanceof ResponseError) {
    const { status } = error.response;
    // clone() throws synchronously if the body was already consumed — keep the
    // whole read inside the catch so a consumed body degrades to no detail.
    const body = (await Promise.resolve()
      .then(() => error.response.clone().json())
      .catch(() => null)) as { error?: string; message?: string } | null;
    const detail = body?.error ?? body?.message;
    if (status === 401) return new Error(SESSION_EXPIRED_MESSAGE);
    if (status === 429) return new Error('Too many attempts — the server rate-limited you. Wait a bit and retry.');
    if (status === 400) return new Error(detail ? `The server rejected it: ${detail}` : 'The server rejected the request.');
    return new Error(detail ? `Server error: ${detail}` : `Server returned ${status}.`);
  }
  if (error instanceof FetchError) {
    return new Error('Could not reach your barkd server. Check that bark-web is still running.');
  }
  return error instanceof Error ? error : new Error('Something went wrong.');
}

/** Await `promise`, converting generated-client errors into readable ones. */
export async function withFriendlyBarkdErrors<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    throw await friendlyBarkdError(error);
  }
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
    history: new HistoryApi(configuration),
    boards: new BoardsApi(configuration),
    fees: new FeesApi(configuration),
  };
  apisCache.set(baseUrl, apis);
  return apis;
}

export function dropBarkdApis(baseUrl: string): void {
  apisCache.delete(baseUrl);
}
