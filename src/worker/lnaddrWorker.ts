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
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RegistryEntry;
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

    // ── Claim (POST /.well-known/lnurlp) ────────────────────────────────
    if (request.method === 'POST' && path === '/.well-known/lnurlp') {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ error: 'invalid JSON' }, 400);
      }
      const name = typeof body.name === 'string' ? body.name.toLowerCase() : '';
      const callback = typeof body.callback === 'string' ? body.callback : '';
      const pubkey = typeof body.pubkey === 'string' ? body.pubkey : '';
      const ts = typeof body.ts === 'number' ? body.ts : 0;
      const sig = typeof body.sig === 'string' ? body.sig : '';
      const nostrPubkey = typeof body.nostrPubkey === 'string' ? body.nostrPubkey : undefined;

      if (!NAME_RE.test(name)) return json({ error: 'invalid name' }, 400);
      if (!/^https:\/\//.test(callback)) return json({ error: 'callback must be https' }, 400);
      if (!HEX64.test(pubkey) || !HEX64.test(sig)) return json({ error: 'bad pubkey or sig' }, 400);
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
      const name = decodeURIComponent(rest).toLowerCase();
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ error: 'invalid JSON' }, 400);
      }
      const entry = await getEntry(env, name);
      if (!entry) return json({ error: 'not found' }, 404);

      const pubkey = typeof body.pubkey === 'string' ? body.pubkey : '';
      const ts = typeof body.ts === 'number' ? body.ts : 0;
      const sig = typeof body.sig === 'string' ? body.sig : '';
      const now = Math.floor(Date.now() / 1000);
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
      const name = decodeURIComponent(path.slice('/.well-known/lnurlp/'.length, -'/callback'.length)).toLowerCase();
      const entry = await getEntry(env, name);
      if (!entry) return json({ status: 'ERROR', reason: 'unknown address' }, 404);

      // Forward amount/comment/nostr verbatim. The wallet's callback is
      // https (enforced at claim time); pass through its own query params.
      const target = new URL(entry.callback);
      for (const key of ['amount', 'nostr', 'comment']) {
        const value = url.searchParams.get(key);
        if (value !== null) target.searchParams.set(key, value);
      }
      const res = await fetch(target.toString(), {
        headers: { Accept: 'application/json' },
        // 10s ceiling: wallets answer fast; don't hold the caller.
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      });
    }

    // ── Pay params / availability (GET /.well-known/lnurlp[/:name]) ────
    if (request.method === 'GET' && path.startsWith('/.well-known/lnurlp')) {
      const rest = path.slice('/.well-known/lnurlp'.length);
      if (!rest || rest === '/') {
        return json({ error: 'name required' }, 400);
      }
      if (rest.includes('/')) return json({ error: 'not found' }, 404);
      const name = decodeURIComponent(rest.slice(1)).toLowerCase();
      if (!NAME_RE.test(name)) return json({ status: 'ERROR', reason: 'invalid name' }, 400);

      const entry = await getEntry(env, name);
      if (!entry) {
        // LUD-16 says unclaimed = error payload for wallets; clients use the
        // 404 status for availability checks.
        return json({ status: 'ERROR', reason: 'address not claimed' }, 404);
      }
      return json(payParams(env, name, entry), 200, { 'Cache-Control': 'public, max-age=60' });
    }

    return json({ error: 'not found' }, 404);
  },
};
