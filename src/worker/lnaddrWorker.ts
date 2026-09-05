/**
 * bao-lnaddr — the 2140.wtf Lightning address directory (Cloudflare Worker).
 *
 * Responsibilities:
 *   1. GET  /.well-known/lnurlp/:name → LUD-06 pay params for a claimed
 *      name, with the callback pointing back at THIS worker so we can proxy
 *      invoice requests to the wallet the user registered.
 *   2. GET  /.well-known/lnurlp/:name/callback?amount=…&nostr=… → proxy to
 *      the registered wallet callback verbatim (plus the nostr param when
 *      present, so NIP-57 public zap receipts keep working).
 *   3. POST /.well-known/lnurlp       → claim a name. Signature over
 *      `claimDigest` (mirrored in src/lib/lnAddress.ts) proves ownership by
 *      the Nostr key; the claim is rejected unless the digest verifies.
 *   4. DELETE /.well-known/lnurlp/:name → release (same signature scheme).
 *
 * Trust model: the worker is a DUMB DIRECTORY + PROXY. It never holds
 * keys, never touches funds, and cannot mint invoices — it forwards to the
 * wallet the user themselves registered. A malicious worker could at worst
 * deny service (drop entries), never steal payments.
 *
 * Verification note: claim signatures are secp256k1 schnorr (Nostr
 * standard). Verification uses @noble/curves inside the worker — imports
 * resolve at bundle time via wrangler's esbuild.
 */

export interface Env {
  /** Workers KV binding — create with: wrangler kv namespace create LNADDR_KV */
  LNADDR_KV: { get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>; delete: (key: string) => Promise<void> };
  LNADDR_DOMAIN: string;
}

interface RegistryEntry {
  callback: string; // wallet LNURLp callback (https)
  nostrPubkey?: string; // wallet's NIP-57 receipt key, when advertised
  pubkey: string; // owner's nostr pubkey (claim signer)
  claimedAt: number;
}

const NAME_RE = /^[a-z0-9._-]{1,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SIG128 = /^[0-9a-f]{128}$/;
const MAX_REQUEST_BODY_BYTES = 8 * 1024;
const MAX_CALLBACK_URL_LENGTH = 2 * 1024;
const MAX_CALLBACK_RESPONSE_BYTES = 64 * 1024;
const MAX_NOSTR_PARAM_LENGTH = 16 * 1024;
const MAX_COMMENT_LENGTH = 280;
const MAX_AMOUNT_MSATS = 1_000_000_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateLimitBucket {
  startedAt: number;
  count: number;
}

// Workers can run many isolates, so this is deliberately only a local abuse
// shield. Durable, account-wide limits should be added with a Durable Object
// or Cloudflare Rate Limiting rule before exposing this endpoint at scale.
const rateLimitBuckets = new Map<string, RateLimitBucket>();

function clientAddress(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'anonymous';
}

function rateLimit(request: Request, scope: string, limit: number): Response | null {
  const now = Date.now();
  if (rateLimitBuckets.size >= 10_000) {
    for (const [key, bucket] of rateLimitBuckets) {
      if (now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(key);
    }
    if (rateLimitBuckets.size >= 10_000) return json({ error: 'rate limit service busy' }, 503, { 'Retry-After': '60' });
  }
  const key = `${scope}:${clientAddress(request)}`;
  const current = rateLimitBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { startedAt: now, count: 1 });
    return null;
  }
  if (current.count >= limit) {
    return json({ error: 'rate limit exceeded' }, 429, { 'Retry-After': '60' });
  }
  current.count += 1;
  return null;
}

function isPrivateIpv4Host(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return false;
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function callbackUrl(raw: string): URL | null {
  if (raw.length === 0 || raw.length > MAX_CALLBACK_URL_LENGTH) return null;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !parsed.hostname ||
      parsed.hash
    ) return null;
    const hostname = parsed.hostname.toLowerCase();
    const privateIpv4 = isPrivateIpv4Host(hostname);
    const privateIpv6 = hostname === '::1' || hostname === '[::1]' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:');
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0' ||
      privateIpv4 ||
      privateIpv6
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readBoundedBytes(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('payload too large');
        throw new RangeError('payload too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new RangeError('request body too large');
  }
  const bytes = await readBoundedBytes(request.body, MAX_REQUEST_BODY_BYTES);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

function nameKey(name: string): string {
  return `name:${name}`;
}

function ownerKey(pubkey: string): string {
  return `owner:${pubkey}`;
}

/** Reconstruct the claim digest (MUST mirror src/lib/lnAddress.ts). */
async function claimDigest(name: string, callback: string, pubkey: string, ts: number): Promise<string> {
  const data = new TextEncoder().encode(`bao-lnaddr-claim-v1:${name}:${callback}:${pubkey}:${ts}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hex string → bytes (BIP-340 messages are raw 32-byte digests). */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Verify a Nostr schnorr signature (BIP-340) over the 32-byte digest. */
async function verifyNostrSig(sigHex: string, msgHex: string, pubkeyHex: string): Promise<boolean> {
  try {
    const { schnorr } = await import('@noble/curves/secp256k1.js');
    return schnorr.verify(hexToBytes(sigHex), hexToBytes(msgHex), hexToBytes(pubkeyHex));
  } catch {
    return false;
  }
}

async function getEntry(env: Env, name: string): Promise<RegistryEntry | null> {
  const raw = await env.LNADDR_KV.get(nameKey(name));
  if (!raw || raw.length > MAX_REQUEST_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Record<string, unknown>;
    const callback = typeof value.callback === 'string' ? callbackUrl(value.callback) : null;
    if (
      !callback ||
      typeof value.pubkey !== 'string' ||
      !HEX64.test(value.pubkey) ||
      typeof value.claimedAt !== 'number' ||
      !Number.isSafeInteger(value.claimedAt) ||
      (value.nostrPubkey !== undefined && (typeof value.nostrPubkey !== 'string' || !HEX64.test(value.nostrPubkey)))
    ) return null;
    return {
      callback: callback.toString(),
      pubkey: value.pubkey,
      claimedAt: value.claimedAt,
      ...(typeof value.nostrPubkey === 'string' ? { nostrPubkey: value.nostrPubkey } : {}),
    };
  } catch {
    return null;
  }
}

/** LUD-06 payload served for a claimed name. */
function payParams(env: Env, name: string, entry: RegistryEntry): ReturnType<typeof JSON.parse> {
  const address = `${name}@${env.LNADDR_DOMAIN}`;
  return {
    callback: `https://${env.LNADDR_DOMAIN}/.well-known/lnurlp/${encodeURIComponent(name)}/callback`,
    minSendable: 1_000, // 1 sat, in msats
    maxSendable: 1_000_000_000_000, // 10 BTC cap; the wallet may lower it
    metadata: JSON.stringify([
      ['text/plain', `Pay ${address} (2140.wtf)`],
      ['text/identifier', address],
    ]),
    commentAllowed: 280,
    allowsNostr: true,
    // Advertise the WALLET's receipt key when it has one; otherwise the
    // owner's key (client code falls back to tag-published keys when this
    // key cannot produce valid receipts — NIP-57 wallets always can).
    ...(entry.nostrPubkey ? { nostrPubkey: entry.nostrPubkey } : {}),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight (wallet web-apps resolve these endpoints too).
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const path = url.pathname;
    const rateLimitResponse = path === '/.well-known/lnurlp' && request.method === 'POST'
      ? rateLimit(request, 'claim', 10)
      : path.startsWith('/.well-known/lnurlp/') && request.method === 'DELETE'
        ? rateLimit(request, 'release', 10)
        : path.endsWith('/callback') && request.method === 'GET'
          ? rateLimit(request, 'callback', 30)
          : (request.method === 'GET' || request.method === 'HEAD')
            ? rateLimit(request, 'lookup', 120)
            : null;
    if (rateLimitResponse) return rateLimitResponse;

    // ── Claim (POST /.well-known/lnurlp) ────────────────────────────────
    if (request.method === 'POST' && path === '/.well-known/lnurlp') {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request) ?? (() => { throw new Error('invalid JSON'); })();
      } catch (error) {
        return json({ error: error instanceof RangeError ? error.message : 'invalid JSON' }, error instanceof RangeError ? 413 : 400);
      }
      const name = typeof body.name === 'string' ? body.name.toLowerCase() : '';
      const callback = typeof body.callback === 'string' ? body.callback : '';
      const pubkey = typeof body.pubkey === 'string' ? body.pubkey : '';
      const ts = typeof body.ts === 'number' ? body.ts : 0;
      const sig = typeof body.sig === 'string' ? body.sig : '';
      const nostrPubkey = typeof body.nostrPubkey === 'string' ? body.nostrPubkey : undefined;

      if (!NAME_RE.test(name)) return json({ error: 'invalid name' }, 400);
      if (!callbackUrl(callback)) return json({ error: 'callback must be a public https URL' }, 400);
      if (!HEX64.test(pubkey) || !SIG128.test(sig)) return json({ error: 'bad pubkey or sig' }, 400);
      if (nostrPubkey !== undefined && !HEX64.test(nostrPubkey)) return json({ error: 'bad nostr pubkey' }, 400);
      if (!Number.isSafeInteger(ts)) return json({ error: 'bad timestamp' }, 400);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > 600) return json({ error: 'timestamp outside ±10min' }, 400);

      // Ownership proof: schnorr sig over the canonical digest.
      const digest = await claimDigest(name, callback, pubkey, ts);
      const ok = await verifyNostrSig(sig, digest, pubkey);
      if (!ok) return json({ error: 'signature does not verify' }, 401);

      const existing = await getEntry(env, name);
      if (existing && existing.pubkey !== pubkey) {
        return json({ error: 'name already claimed' }, 409);
      }

      // One address per owner: release the previous mapping first.
      const previousName = await env.LNADDR_KV.get(ownerKey(pubkey));
      if (previousName && previousName !== name) {
        await env.LNADDR_KV.delete(nameKey(previousName));
      }

      const entry: RegistryEntry = { callback, nostrPubkey, pubkey, claimedAt: now };
      await env.LNADDR_KV.put(nameKey(name), JSON.stringify(entry));
      await env.LNADDR_KV.put(ownerKey(pubkey), name);

      return json({ ok: true, name, address: `${name}@${env.LNADDR_DOMAIN}` });
    }

    // ── Release (DELETE /.well-known/lnurlp/:name) ──────────────────────
    if (request.method === 'DELETE' && path.startsWith('/.well-known/lnurlp/')) {
      const rest = path.slice('/.well-known/lnurlp/'.length);
      if (rest.includes('/')) return json({ error: 'not found' }, 404); // callback path is GET-only
      let name: string;
      try {
        name = decodeURIComponent(rest).toLowerCase();
      } catch {
        return json({ error: 'not found' }, 404);
      }
      if (!NAME_RE.test(name)) return json({ error: 'not found' }, 404);
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request) ?? (() => { throw new Error('invalid JSON'); })();
      } catch (error) {
        return json({ error: error instanceof RangeError ? error.message : 'invalid JSON' }, error instanceof RangeError ? 413 : 400);
      }
      const entry = await getEntry(env, name);
      if (!entry) return json({ error: 'not found' }, 404);

      const pubkey = typeof body.pubkey === 'string' ? body.pubkey : '';
      const ts = typeof body.ts === 'number' ? body.ts : 0;
      const sig = typeof body.sig === 'string' ? body.sig : '';
      const now = Math.floor(Date.now() / 1000);
      if (!HEX64.test(pubkey) || !SIG128.test(sig) || !Number.isSafeInteger(ts)) return json({ error: 'bad signature payload' }, 400);
      if (Math.abs(now - ts) > 600) return json({ error: 'timestamp outside ±10min' }, 400);

      const digest = await claimDigest(`release:${name}`, entry.callback, pubkey, ts);
      const ok = pubkey === entry.pubkey && (await verifyNostrSig(sig, digest, pubkey));
      if (!ok) return json({ error: 'signature does not verify' }, 401);

      await env.LNADDR_KV.delete(nameKey(name));
      await env.LNADDR_KV.delete(ownerKey(pubkey));
      return json({ ok: true });
    }

    // ── Callback proxy (GET …/:name/callback) ───────────────────────────
    if (request.method === 'GET' && path.endsWith('/callback') && path.startsWith('/.well-known/lnurlp/')) {
      let name: string;
      try {
        name = decodeURIComponent(path.slice('/.well-known/lnurlp/'.length, -'/callback'.length)).toLowerCase();
      } catch {
        return json({ status: 'ERROR', reason: 'invalid address' }, 400);
      }
      if (!NAME_RE.test(name)) return json({ status: 'ERROR', reason: 'invalid address' }, 400);
      const entry = await getEntry(env, name);
      if (!entry) return json({ status: 'ERROR', reason: 'unknown address' }, 404);

      const amount = url.searchParams.get('amount');
      if (!amount || !/^[0-9]+$/.test(amount)) return json({ status: 'ERROR', reason: 'invalid amount' }, 400);
      const amountMsats = Number(amount);
      if (!Number.isSafeInteger(amountMsats) || amountMsats < 1_000 || amountMsats > MAX_AMOUNT_MSATS) {
        return json({ status: 'ERROR', reason: 'amount outside allowed range' }, 400);
      }
      const nostr = url.searchParams.get('nostr');
      const comment = url.searchParams.get('comment');
      if (nostr !== null && nostr.length > MAX_NOSTR_PARAM_LENGTH) return json({ status: 'ERROR', reason: 'nostr parameter too large' }, 400);
      if (comment !== null && comment.length > MAX_COMMENT_LENGTH) return json({ status: 'ERROR', reason: 'comment too long' }, 400);

      // Forward only the bounded LUD-06 fields. The wallet callback is
      // validated at claim time and redirects are disabled to prevent a
      // registered callback from turning this proxy into an open fetcher.
      const target = new URL(entry.callback);
      target.searchParams.set('amount', amount);
      if (nostr !== null) target.searchParams.set('nostr', nostr);
      if (comment !== null) target.searchParams.set('comment', comment);
      let res: Response;
      try {
        res = await fetch(target.toString(), {
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        return json({ status: 'ERROR', reason: 'wallet callback unavailable' }, 502);
      }
      try {
        const body = new TextDecoder().decode(await readBoundedBytes(res.body, MAX_CALLBACK_RESPONSE_BYTES));
        return new Response(body, {
          status: res.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          },
        });
      } catch {
        return json({ status: 'ERROR', reason: 'wallet response too large' }, 502);
      }
    }

    // ── Pay params / availability (GET /.well-known/lnurlp[/:name]) ────
    if ((request.method === 'GET' || request.method === 'HEAD') && path.startsWith('/.well-known/lnurlp')) {
      const rest = path.slice('/.well-known/lnurlp'.length);
      if (!rest || rest === '/') {
        return json({ error: 'name required' }, 400);
      }
      if (rest.slice(1).includes('/')) return json({ error: 'not found' }, 404);
      let name: string;
      try {
        name = decodeURIComponent(rest.slice(1)).toLowerCase();
      } catch {
        return json({ status: 'ERROR', reason: 'invalid name' }, 400);
      }
      if (!NAME_RE.test(name)) return json({ status: 'ERROR', reason: 'invalid name' }, 400);

      const entry = await getEntry(env, name);
      if (!entry) {
        // LUD-16 says unclaimed = error payload for wallets; clients use the
        // 404 status for availability checks.
        return json({ status: 'ERROR', reason: 'address not claimed' }, 404);
      }
      if (request.method === 'HEAD') return new Response(null, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60',
        },
      });
      return json(payParams(env, name, entry), 200, { 'Cache-Control': 'public, max-age=60' });
    }

    return json({ error: 'not found' }, 404);
  },
};
