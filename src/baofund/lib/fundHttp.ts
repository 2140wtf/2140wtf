/** BAO Fund's HTTP boundary. No shared markets endpoint or cross-origin
 * fallback. All callers use a Fund-specific base; mutations are single-shot. */
const FUND_PROXY_BASE = '/fund-api';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Signs Nostr events (NIP-98); returns the raw signed event object. */
export interface FundHttpSigner {
  signEvent(event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }): Promise<unknown>;
}

export class FundHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'FundHttpError';
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * NIP-98 (kind 27235) auth for the BAO Fund API: `u` = full
 * request URL, `method` uppercased, a `nonce` tag, and - for body requests -
 * a `payload` tag with the sha256 hex of the exact body string. The API
 * consumes the event id to prevent replays, so every call signs fresh.
 */
export async function nip98Header(
  signer: FundHttpSigner,
  url: string,
  method: string,
  body?: string,
): Promise<string> {
  const payloadHash = body === undefined ? undefined : await sha256Hex(body);
  const tags = [['u', url], ['method', method.toUpperCase()], ['nonce', crypto.randomUUID()]];
  if (payloadHash) tags.push(['payload', payloadHash]);
  const event = await signer.signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  });
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

/**
 * API origin WITHOUT /v1 (env override wins). Callers pass paths starting
 * with `/v1/...`; the request engine appends the suffix exactly once.
 */
export function fundApiOrigin(): string {
  return validateFundApiBase((import.meta.env.VITE_BAO_FUND_API_URL as string | undefined) || FUND_PROXY_BASE);
}

/**
 * Origin used in the NIP-98 `u` tag. Defaults to the request origin, but points
 * at the canonical Fund API origin when the app reaches the API through a
 * same-origin `/fund-api` proxy: the API validates `u` against its own origin
 * allowlist, so a proxied localhost URL would be rejected.
 */
export function fundApiSigningOrigin(): string {
  const explicit = (import.meta.env as Record<string, string | undefined>).VITE_BAO_FUND_API_SIGN_ORIGIN;
  return explicit ? validateFundApiBase(explicit) : fundApiOrigin();
}

/** Reject legacy shared service paths, credentials and accidental /v1 bases.
 * NIP-98 needs the absolute URL, including for same-origin proxy requests. */
function validateFundApiBase(base: string): string {
  let url: URL;
  try { url = new URL(base, typeof location === 'undefined' ? undefined : location.origin); }
  catch { throw new FundHttpError('Configure a BAO Fund API URL', 0, 'fund_api_configuration'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash ||
      /(?:^|\/)bao-api(?:\/|$)/.test(url.pathname) || /\/v1\/?$/.test(url.pathname) ||
      ['bao.markets', 'relay.bao.network'].includes(url.hostname)) {
    throw new FundHttpError('BAO Fund requires its own API base, without credentials or /v1 suffix', 0, 'fund_api_configuration');
  }
  return url.href.replace(/\/+$/, '');
}

export interface FundFetchOptions {
  method?: string;
  body?: unknown;
  /** When present, sends a fresh NIP-98 Authorization header per attempt. */
  signer?: FundHttpSigner;
  /** Per-attempt timeout; ignored when `signal` is provided. Default 30s. */
  timeoutMs?: number;
  /** External abort signal - wins over the timeout. */
  signal?: AbortSignal;
  /** Escape hatch for callers targeting a non-standard deployment. */
  base?: string;
}

interface WireError {
  error?: { code?: unknown; message?: unknown };
  message?: unknown;
}

function wireErrorMessage(json: unknown, status: number): string {
  const w = (json ?? {}) as WireError;
  if (typeof w.error?.message === 'string' && w.error.message) return w.error.message;
  if (typeof w.message === 'string' && w.message) return w.message;
  return `HTTP ${status}`;
}

function wireErrorCode(json: unknown): string | undefined {
  const code = ((json ?? {}) as WireError)?.error?.code;
  return typeof code === 'string' && code ? code : undefined;
}

/**
 * NIP-98 transport header for one request. Same-origin calls ride
 * `X-Nostr-Auth` so the browser's Basic credentials for the access gate keep
 * the `Authorization` header. Cross-origin calls (the GitHub-Pages hub
 * calling `app.bao.network/fund-api`) MUST use the standard
 * `Authorization: Nostr …` form: the API's CORS preflight allowlist exposes
 * `Authorization` but not `X-Nostr-Auth`, so the custom header would be
 * blocked before the request leaves the browser.
 */
function nip98AuthHeaderName(url: string): 'Authorization' | 'X-Nostr-Auth' {
  try {
    return new URL(url).origin === globalThis.location?.origin ? 'X-Nostr-Auth' : 'Authorization';
  } catch {
    return 'Authorization';
  }
}

async function doFetch(url: string, signingUrl: string, opts: FundFetchOptions, method: string, bodyStr: string | undefined): Promise<Response> {
  const headers: Record<string, string> = {};
  if (bodyStr !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.signer) headers[nip98AuthHeaderName(url)] = await nip98Header(opts.signer, signingUrl, method, bodyStr);
  return fetch(url, {
    method,
    redirect: 'error',
    headers,
    body: bodyStr,
    signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}

async function parseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

/** Execute exactly once against the selected Fund endpoint. Invalid proxy
 * responses are errors, never a reason to send Fund data to another project. */
async function runEngine(path: string, opts: FundFetchOptions): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\#]|%(?:2e|2f|5c)/i.test(path) || /(?:^|\/)\.\.?(?:\/|$)/.test(path)) {
    throw new FundHttpError('Invalid Fund API resource path', 0, 'fund_api_path');
  }
  const method = (opts.method ?? 'GET').toUpperCase();
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const base = opts.base === undefined ? fundApiOrigin() : validateFundApiBase(opts.base);
  const resource = opts.base === undefined && path.startsWith('/v1/') ? path.slice(3) : path;
  const url = opts.base === undefined ? `${base}/v1${resource}` : `${base}${resource}`;
  // NIP-98 `u` must match an origin the Fund API trusts; when this app reaches
  // the API through a same-origin proxy, sign the canonical URL while fetching
  // the proxied one.
  const signingBase = opts.base === undefined ? fundApiSigningOrigin() : base;
  const parsed = new URL(url);
  const signingUrl = new URL(parsed.pathname + parsed.search, signingBase).href;
  const res = await doFetch(url, signingUrl, opts, method, bodyStr);
  if (!res.ok) {
    const body = await parseJson(res);
    throw new FundHttpError(wireErrorMessage(body, res.status), res.status, wireErrorCode(body));
  }
  const type = res.headers?.get?.('content-type');
  if (type && !type.includes('application/json')) throw new FundHttpError('Fund API returned a non-JSON response', res.status, 'fund_api_wrong_service');
  return res;
}

/** Parsed JSON response plus HTTP status (for flows like 202-pending claims). */
export interface FundResponse<T> {
  status: number;
  data: T;
}

/** Single-shot authenticated JSON call. Mutations are NEVER auto-retried. */
export async function fundRequest<T>(path: string, opts: FundFetchOptions = {}): Promise<FundResponse<T>> {
  const res = await runEngine(path, opts);
  return { status: res.status, data: (await parseJson(res)) as T };
}

/** fundRequest without the status - the common case. */
export async function fundFetch<T>(path: string, opts: FundFetchOptions = {}): Promise<T> {
  return (await fundRequest<T>(path, opts)).data;
}

/**
 * Raw response from the configured Fund service, with body unread.
 */
export async function fundFetchResponse(path: string, opts: FundFetchOptions = {}): Promise<Response> {
  return runEngine(path, opts);
}
