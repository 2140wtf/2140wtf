/**
 * 2140.wtf Lightning address client (LUD-16 + LUD-06).
 *
 * `name@2140.wtf` addresses are served by the `bao-lnaddr` Cloudflare
 * Worker on this domain:
 *
 *   GET https://2140.wtf/.well-known/lnurlp/:name  → LUD-06 pay params
 *   GET https://<callback>?amount=<msats>…         → invoice (proxied by
 *                                                    the Worker to the
 *                                                    wallet the user
 *                                                    registered)
 *
 * Claiming/registration rides the same Worker:
 *   POST /.well-known/lnurlp            → claim {name, callback, nostrPubkey}
 *   DELETE /.well-known/lnurlp/:name    → release (ownership proof required)
 *
 * Design notes:
 *  - 2140.wtf is a DIRECTORY, never a custodian: the user registers the
 *    LNURLp callback of ANY wallet they control (Alby Hub, LNbits, Blink,
 *    Phoenixd, Rizful…). Funds always move wallet → payer, never through us.
 *  - Ownership is proven Nostr-style: the claim request is signed with the
 *    user's kind-0 key; the Worker verifies the signature before storing.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const LNADDR_DOMAIN = '2140.wtf';

/** Worker base URL — same-origin path in prod, overridable for wrangler dev. */
export const LNADDR_API_BASE =
  (import.meta.env.VITE_LNADDR_API_URL as string | undefined)?.replace(/\/+$/, '') ||
  `https://${LNADDR_DOMAIN}`;

/** Valid username: lowercase alnum + dots/dashes/underscores, 1–64 chars. */
export function isValidLud16Name(name: string): boolean {
  return /^[a-z0-9._-]{1,64}$/.test(name);
}

/** The full Lightning address for a claimed name. */
export function lightningAddressFor(name: string): string {
  return `${name}@${LNADDR_DOMAIN}`;
}

/** Split `name@domain` into parts; null when malformed. */
export function parseLightningAddress(address: string): { name: string; domain: string } | null {
  const m = address.trim().match(/^([\w.-]+)@([\w.-]+)$/);
  if (!m) return null;
  return { name: m[1], domain: m[2] };
}

/** The metadata JSON array LUD-06 requires (also used by the Worker). */
export function lnurlpMetadata(address: string): string {
  return JSON.stringify([
    ['text/plain', `Pay ${address} (2140.wtf)`],
    ['text/identifier', address],
  ]);
}

/** sha256 hex of an arbitrary string — the Worker's challenge hash input. */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

export interface ClaimResponse {
  ok: boolean;
  /** Set when the name is taken (409). */
  error?: string;
  /** Echo of the claimed name on success. */
  name?: string;
  /** Lightning address on success. */
  address?: string;
}

export interface ClaimInput {
  name: string;
  /** The wallet's LNURLp callback URL (receives ?amount=…). */
  callback: string;
  /** NIP-57 receipt pubkey advertised by the wallet, when it has one. */
  nostrPubkey?: string;
  /** Claimant's nostr pubkey (must own the signed claim). */
  pubkey: string;
  /** Unix seconds when the signed claim expires. */
  ts: number;
  /** Hex schnorr/ECDSA signature over the claim digest (produced by signer). */
  sig: string;
}

/**
 * The exact bytes a claim signature must cover. Mirrored by the Worker —
 * keep in sync.
 */
export function claimDigest(input: Pick<ClaimInput, 'name' | 'callback' | 'pubkey' | 'ts'>): string {
  return sha256Hex(`bao-lnaddr-claim-v1:${input.name}:${input.callback}:${input.pubkey}:${input.ts}`);
}

/** Register (claim) a name. The signature must come from the user's key. */
export async function claimLightningAddress(input: ClaimInput): Promise<ClaimResponse> {
  const res = await fetch(`${LNADDR_API_BASE}/.well-known/lnurlp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 409) {
    return { ok: false, error: 'That name is already taken.' };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => 'Claim failed');
    return { ok: false, error: text.slice(0, 200) };
  }
  return { ok: true, name: input.name, address: lightningAddressFor(input.name) };
}

/** Release a claimed name (same signature scheme as claim). */
export async function releaseLightningAddress(args: {
  name: string;
  pubkey: string;
  ts: number;
  sig: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${LNADDR_API_BASE}/.well-known/lnurlp/${encodeURIComponent(args.name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey: args.pubkey, ts: args.ts, sig: args.sig }),
  });
  if (!res.ok) return { ok: false, error: (await res.text().catch(() => 'Release failed')).slice(0, 200) };
  return { ok: true };
}

/** Check whether a name is claimable right now (public, no signature). */
export async function checkNameAvailable(name: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${LNADDR_API_BASE}/.well-known/lnurlp/${encodeURIComponent(name)}`, {
      method: 'HEAD',
    });
    if (res.status === 404) return true;
    if (res.ok) return false;
    return null; // unknown — worker offline etc.
  } catch {
    return null;
  }
}

/**
 * Extract {callback, nostrPubkey} from a wallet's LNURLp JSON — the user
 * pastes either the JSON itself or the URL of their wallet's
 * `/.well-known/lnurlp/<name>` endpoint.
 */
export function extractWalletLnurlp(json: unknown): { callback: string; nostrPubkey?: string; minSendable?: number; maxSendable?: number } | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.callback !== 'string' || !/^https:\/\//.test(obj.callback)) return null;
  return {
    callback: obj.callback,
    nostrPubkey: typeof obj.nostrPubkey === 'string' ? obj.nostrPubkey : undefined,
    minSendable: typeof obj.minSendable === 'number' ? obj.minSendable : undefined,
    maxSendable: typeof obj.maxSendable === 'number' ? obj.maxSendable : undefined,
  };
}

/** Fetch + parse a wallet's LNURLp endpoint (user pastes the URL). */
export async function fetchWalletLnurlp(url: string): Promise<ReturnType<typeof extractWalletLnurlp>> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Wallet responded ${res.status}`);
  return extractWalletLnurlp(await res.json());
}
