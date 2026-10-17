/**
 * voice broker — blind LiveKit token broker (ADR-voice-invisible-rooms
 * v10.2 §3).
 *
 * CORD-07-shaped contract:
 *   GET /.well-known/concord/av                → 204 capability probe
 *   GET /.well-known/concord/av/<voice_room>   → {token, url, identity}
 *
 * Auth is a kind-27235 event signed by the room's derived voice signer
 * (pubkey == voice_room), binding the exact request URL (`u`) and method,
 * with ±60 s freshness and a ≥240 s replay set. The broker holds no room
 * registry and no member list: it can deny or delay, never listen. The
 * LiveKit JWT is minted for a random identity under a short TTL.
 *
 * This module is transport-free (no http import) so the route logic is unit
 * testable; `tools/voice-broker/server.mts` is the process entry.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { verifyEvent, type Event } from 'nostr-tools';

export interface VoiceBrokerConfig {
  /** LiveKit websocket URL handed to clients. */
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  /** Exact public origin used to bind the grant `u` tag (never Host). */
  origin: string;
  /** Allowed browser origins; empty = no CORS headers (same-origin only). */
  allowedOrigins?: string[];
  tokenTtlSec?: number;
  freshnessSec?: number;
  replayWindowSec?: number;
  /** Per-IP token-mint cap per minute (IPv6 aggregated to /64). */
  maxMintsPerMinutePerIp?: number;
  /** Per-ROOM mint cap per minute: a room must not mint unbounded identities. */
  maxMintsPerMinutePerRoom?: number;
  /** Global mint cap per minute across every room and IP (blast-radius bound). */
  maxMintsPerMinuteGlobal?: number;
  /** Trust X-Real-IP / X-Forwarded-For when the socket peer is loopback
   *  (our nginx). Default true; set false when the broker is directly exposed. */
  trustForwardedFor?: boolean;
  now?: () => number;
  rng?: (bytes: number) => Uint8Array;
}

export interface BrokerRequest {
  method: string;
  /** Path + query, e.g. `/…/av/<voice_room>`; the `u` tag is `${origin}${url}`. */
  url: string;
  headers: Record<string, string | undefined>;
  remoteIp?: string;
}

export interface BrokerResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

export interface BrokerGrantResult {
  ok: boolean;
  reason?: string;
  event?: Event;
}

const KIND_HTTP_AUTH = 27235;
const HEX64 = /^[0-9a-f]{64}$/;
const AV_PREFIX = '/.well-known/concord/av';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Verify a `Authorization: Concord <base64(kind-27235 event)>` grant against
 * the request it claims to authorize. Pure and deterministic for a given
 * `now`; the caller owns replay storage (see `createVoiceBroker`).
 */
export function verifyVoiceGrant(input: {
  authorization: string | undefined;
  voiceRoom: string;
  method: string;
  expectedUrl: string;
  nowSec: number;
  freshnessSec: number;
  verify?: (event: Event) => boolean;
}): BrokerGrantResult {
  const verify = input.verify ?? ((event: Event) => verifyEvent(event));
  if (!input.authorization || !input.authorization.startsWith('Concord ')) return { ok: false, reason: 'missing_grant' };
  const b64 = input.authorization.slice('Concord '.length).trim();
  let event: Event;
  try {
    event = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Event;
  } catch {
    return { ok: false, reason: 'malformed_grant' };
  }
  if (!isRecord(event) || event.kind !== KIND_HTTP_AUTH) return { ok: false, reason: 'wrong_kind' };
  if (typeof event.pubkey !== 'string' || event.pubkey !== input.voiceRoom) return { ok: false, reason: 'wrong_signer' };
  if (typeof event.created_at !== 'number' || Math.abs(input.nowSec - event.created_at) > input.freshnessSec) {
    return { ok: false, reason: 'stale_grant' };
  }
  if (!Array.isArray(event.tags)) return { ok: false, reason: 'malformed_grant' };
  const tag = (name: string): string | undefined => {
    const found = (event.tags as string[][]).find((t) => Array.isArray(t) && t[0] === name);
    return found?.[1];
  };
  if (tag('method') !== input.method) return { ok: false, reason: 'method_mismatch' };
  if (tag('u') !== input.expectedUrl) return { ok: false, reason: 'url_mismatch' };
  try {
    if (!verify(event)) return { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true, event };
}

interface Bucket {
  count: number;
  resetAt: number;
}

const LOOPBACK_RE =
  /^(?:::1|::ffff:127(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3})$/;

/** Expand an IPv6 address to its eight lowercase hextets ('' when malformed). */
function expandIpv6(ip: string): string[] | null {
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 && head.length !== 8) return null;
  if (parts.length === 2 && missing < 1) return null;
  const filled = [...head, ...Array(Math.max(0, missing)).fill('0'), ...tail];
  if (filled.length !== 8) return null;
  return filled.map((h) => h.toLowerCase().padStart(4, '0'));
}

/**
 * Bucket key for an IP: IPv4-mapped IPv6 is unwrapped to IPv4, and IPv6 is
 * aggregated to its /64 so a rotating /128 cannot dodge the per-IP cap.
 * Pure and exported for tests.
 */
export function rateBucketKey(rawIp: string): string {
  let ip = (rawIp ?? '').trim();
  // strip a :port from IPv4 forms and [..]:port from bracket forms.
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  const bracketed = /^\[([0-9a-fA-F:]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) ip = bracketed[1];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (ip.includes(':')) {
    const hextets = expandIpv6(ip);
    if (hextets) return `${hextets.slice(0, 4).join(':')}::/64`;
  }
  return ip || 'unknown';
}

/**
 * The client IP used for rate limiting. Proxy headers are honoured ONLY when
 * the socket peer is loopback (requests arrive via our nginx, so every
 * connection otherwise looks like 127.0.0.1) — the nginx vhost sets
 * X-Real-IP to the real remote address. Pure and exported for tests.
 */
export function clientIpFor(
  request: { headers: Record<string, string | undefined>; remoteIp?: string },
  trustForwardedFor: boolean,
): string {
  let ip = (request.remoteIp ?? '').trim();
  if (trustForwardedFor && LOOPBACK_RE.test(ip)) {
    const real = (request.headers['x-real-ip'] ?? '').trim();
    const xffFirst = (request.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() ?? '';
    ip = real || xffFirst || ip;
  }
  return rateBucketKey(ip);
}

export interface VoiceBroker {
  handle(request: BrokerRequest): Promise<BrokerResponse>;
  /** Test/ops introspection only. */
  replaySize(): number;
}

export function createVoiceBroker(config: VoiceBrokerConfig, deps: { verify?: (event: Event) => boolean } = {}): VoiceBroker {
  const now = config.now ?? (() => Date.now());
  const rng = config.rng ?? ((bytes: number) => new Uint8Array(randomBytes(bytes)));
  const tokenTtlSec = config.tokenTtlSec ?? 300;
  const freshnessSec = config.freshnessSec ?? 60;
  const replayWindowSec = config.replayWindowSec ?? 240;
  const maxPerIp = config.maxMintsPerMinutePerIp ?? 30;
  const maxPerRoom = config.maxMintsPerMinutePerRoom ?? 15;
  const maxGlobal = config.maxMintsPerMinuteGlobal ?? 150;
  const trustForwarded = config.trustForwardedFor ?? true;
  const allowedOrigins = config.allowedOrigins ?? [];
  const replay = new Map<string, number>();
  const buckets = new Map<string, Bucket>();

  function corsHeaders(origin: string | undefined): BrokerResponse['headers'] | null {
    const base: BrokerResponse['headers'] = {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    };
    if (origin === undefined) return base;
    if (allowedOrigins.length === 0) return base; // same-origin only
    if (!allowedOrigins.includes(origin)) return null;
    return {
      ...base,
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Authorization',
      vary: 'Origin',
    };
  }

  function rateLimited(key: string, max: number, nowMs: number): number | null {
    // Bounded store: prune expired buckets before growing past the cap.
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.resetAt <= nowMs) buckets.delete(k);
    }
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= nowMs) {
      buckets.set(key, { count: 1, resetAt: nowMs + 60_000 });
      return null;
    }
    if (bucket.count >= max) return Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
    bucket.count += 1;
    return null;
  }

  function mintJwt(voiceRoom: string, identity: string, nowSec: number): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      iss: config.apiKey,
      sub: identity,
      iat: nowSec,
      nbf: nowSec,
      exp: nowSec + tokenTtlSec,
      video: { room: voiceRoom, roomJoin: true, canPublish: true, canSubscribe: true },
    };
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const data = `${encode(header)}.${encode(payload)}`;
    const sig = createHmac('sha256', config.apiSecret).update(data).digest('base64url');
    return `${data}.${sig}`;
  }

  async function handle(request: BrokerRequest): Promise<BrokerResponse> {
    const nowMs = now();
    const nowSec = Math.floor(nowMs / 1000);
    const cors = corsHeaders(request.headers.origin);
    if (cors === null) return { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: { error: 'origin_not_allowed' } };
    const withCors = (response: BrokerResponse): BrokerResponse => ({ ...response, headers: { ...cors, ...response.headers } });

    if (request.method === 'OPTIONS') return withCors({ status: 204, headers: {} });
    if (request.url === AV_PREFIX) {
      if (request.method !== 'GET') return withCors({ status: 405, headers: {}, body: { error: 'method_not_allowed' } });
      return withCors({ status: 204, headers: {} });
    }
    if (!request.url.startsWith(`${AV_PREFIX}/`)) return withCors({ status: 404, headers: {}, body: { error: 'not_found' } });
    if (request.method !== 'GET') return withCors({ status: 405, headers: {}, body: { error: 'method_not_allowed' } });

    const voiceRoom = request.url.slice(AV_PREFIX.length + 1);
    if (!HEX64.test(voiceRoom)) return withCors({ status: 404, headers: {}, body: { error: 'not_found' } });

    const expectedUrl = `${config.origin}${request.url}`;
    const grant = verifyVoiceGrant({
      authorization: request.headers.authorization,
      voiceRoom,
      method: request.method,
      expectedUrl,
      nowSec,
      freshnessSec,
      ...(deps.verify ? { verify: deps.verify } : {}),
    });
    if (!grant.ok || !grant.event) {
      return withCors({ status: 401, headers: {}, body: { error: 'unauthorized', reason: grant.reason ?? 'unauthorized' } });
    }

    // Replay: a valid event id may mint exactly once inside the window.
    const expiry = (grant.event.created_at + replayWindowSec) * 1000;
    const seen = replay.get(grant.event.id);
    if (seen !== undefined && seen > nowMs) {
      return withCors({ status: 401, headers: {}, body: { error: 'unauthorized', reason: 'replay' } });
    }
    replay.set(grant.event.id, expiry);
    if (replay.size > 10_000) {
      for (const [id, exp] of replay) if (exp <= nowMs) replay.delete(id);
    }

    // Rate caps apply to MINTS only: unauthorized/replayed grants never
    // consume budget. Three scopes: per client IP (/64 for IPv6, proxy-aware),
    // per room, and global. A rejected check may still have consumed an outer
    // bucket — acceptable for a limiter (fail-closed direction).
    const clientIp = clientIpFor(request, trustForwarded);
    for (const [key, max] of [
      [`ip:${clientIp}`, maxPerIp],
      [`room:${voiceRoom}`, maxPerRoom],
      ['global', maxGlobal],
    ] as ReadonlyArray<readonly [string, number]>) {
      const retryAfter = rateLimited(key, max, nowMs);
      if (retryAfter !== null) {
        return withCors({ status: 429, headers: { 'retry-after': String(retryAfter) }, body: { error: 'rate_limited' } });
      }
    }

    const identity = Array.from(rng(16), (b) => b.toString(16).padStart(2, '0')).join('');
    const token = mintJwt(voiceRoom, identity, nowSec);
    return withCors({ status: 200, headers: {}, body: { token, url: config.livekitUrl, identity } });
  }

  return {
    handle,
    replaySize: () => replay.size,
  };
}
