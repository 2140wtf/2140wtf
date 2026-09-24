// src/lib/cashu/tokenUtils.ts
//
// BAO Fund - Cashu token utilities (BAO-authored).
//
// Protocol mechanics implemented on top of MIT-licensed deps:
//   @cashu/cashu-ts (token decode/encode, proof states, wallet ops)
//   @noble/hashes  (sha256)
//
// Scope: defensive decode of Cashu tokens for the escrow/wallet flows,
// mint-URL normalization + allow-list checks, fee ppm caps, proof-shape
// validation, and the "are these proofs already spent" check used to
// distinguish a lost response from a redeemed token.
//
// No code is derived from AGPL-licensed clients (Ditto / 2140wtf /
// satoshi-pay-wallet). Namespaces and app-key strings are BAO's own.

import { Wallet, getDecodedToken, hashToCurve } from 'cashu-ts3';
import { sha256 } from '@noble/hashes/sha2.js';
import { isBlockedMintUrl } from '../../wallet/mintConfig';
import { bytesToBase64 } from './base64';
import { devLog } from './devLog';

/** Maximum length of an encoded Cashu token string we will decode (bytes). */
export const MAX_TOKEN_LENGTH = 100_000;

/** Maximum length of individual proof fields (id, C, secret, witness). */
export const MAX_PROOF_FIELD_LENGTH = 4096;

/** Reject mint fees above this ppm (parts per million) to prevent runaway fees.
 *  Default 5% - override only after explicit user acknowledgement.
 */
export const MAX_MINT_FEE_PPM = 50_000;

/** Reject negative fees and fees that exceed a ppm cap relative to the amount. */
export function isFeeWithinMaxPpm(fee: number, amount: number, ppm = MAX_MINT_FEE_PPM): boolean {
  if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(amount) || amount < 0) return false;
  return fee <= Math.floor((amount * ppm) / 1_000_000);
}

export interface DecodedTokenEntry {
  mintUrl: string;
  proofs: unknown[];
  amount: number;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) return NaN;
  // Strict numeric check: parseInt('other', 10) & 0xff collapses to 0, so a
  // 4-LABEL HOSTNAME ('other.mint.example.com') would parse as 0.0.0.0 and be
  // misclassified as a private IP - rejecting every token from any mint whose
  // host happens to have exactly four dot-separated labels.
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return NaN;
  return parts.reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (Number.isNaN(n)) return false;
  // 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
  if ((n >>> 24) === 127) return true;
  if ((n >>> 24) === 10) return true;
  if ((n >>> 20) === 0xac1) return true;
  if ((n >>> 16) === 0xc0a8) return true;
  if ((n >>> 16) === 0xa9fe) return true;
  if (n === 0) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Unspecified, loopback; fc00::/7 unique local; fe80::/10 link-local
  if (lower === '::' || lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  return false;
}

/** Decode an IPv6 literal into 8 hextets; null when it is not valid IPv6. */
function ipv6Hextets(ip: string): number[] | null {
  if (!ip.includes(':')) return null;
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const parse = (text: string): number[] | null => {
    if (text === '') return [];
    const out: number[] = [];
    for (const h of text.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const head = parse(parts[0]!);
  if (head === null) return null;
  if (parts.length === 1) return head.length === 8 ? head : null;
  const tail = parse(parts[1]!);
  if (tail === null) return null;
  const zeros = 8 - head.length - tail.length;
  if (zeros < 1) return null;
  return [...head, ...new Array(zeros).fill(0), ...tail];
}

/**
 * Expand an IPv6 address with an embedded IPv4 (`::ffff:a.b.c.d` /
 * `::ffff:aabb:ccdd` mapped, `::ffff:0:a:b` translated, or the deprecated
 * IPv4-compatible `::a:b` / `::a.b.c.d`) to its dotted-quad, or null when the
 * address carries no embedded IPv4 (or is plain loopback/unspecified).
 * Browsers resolve these onto the IPv4 stack, so an embedded loopback/private
 * address IS a loopback/private host. WHATWG URL serializes them to HEX
 * hextets (`https://[::ffff:127.0.0.1]` -> `[::ffff:7f00:1]`,
 * `https://[::127.0.0.1]` -> `[::7f00:1]`), so a dotted-decimal guard alone
 * never matches real URL input (round-8 hunt: the compatible form bypassed
 * the gate the round-6 hextet fix closed in the execution egress policy).
 */
function embeddedIpv4Of(ip: string): string | null {
  const low = ip.toLowerCase();
  if (low === '::' || low === '::1' || low === '0:0:0:0:0:0:0:0' || low === '0:0:0:0:0:0:0:1') return null;
  const hextets = ipv6Hextets(low);
  if (hextets) {
    const first4Zero = hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0;
    const mapped = first4Zero && hextets[4] === 0 && hextets[5] === 0xffff;
    const translated = first4Zero && hextets[4] === 0xffff && hextets[5] === 0;
    const compatible = first4Zero && hextets[4] === 0 && hextets[5] === 0;
    if (!mapped && !translated && !compatible) return null;
    const hi = hextets[6]!;
    const lo = hextets[7]!;
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  const dottedMapped = low.match(/^::ffff:(?:0:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedMapped) return dottedMapped[1]!;
  const dottedCompatible = low.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedCompatible) return dottedCompatible[1]!;
  return null;
}

/** Reject localhost, loopback, and private-network mint hosts.
 *  Require HTTPS for production mint URLs; HTTP is not auto-allowed.
 *  Optionally compare against an allow-list of normalized mint URLs.
 */
export function isAllowedMintUrl(url: string, allowList?: string[]): boolean {
  try {
    const u = new URL(url);
    // Require HTTPS for mint URLs; HTTP is not auto-allowed.
    if (u.protocol !== 'https:') return false;
    // Reject URL credentials: `https://trusted.mint@evil.com` displays as the
    // trusted host but fetches evil.com (spoofing in the discovery list).
    if (u.username || u.password) return false;
    // The URL constructor normalizes IDN hosts to punycode automatically.
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    // A trailing dot is the same host for DNS purposes.
    if (host.replace(/\.$/, '') === 'localhost') return false;
    // Classify by host KIND: IPv6 rules apply ONLY to IPv6 literals, or
    // domain names like `february.mint.example` are wrongly rejected.
    if (host.includes(':')) {
      const embedded = embeddedIpv4Of(host);
      if (embedded ? isPrivateIPv4(embedded) : isPrivateIPv6(host)) return false;
    } else if (isPrivateIPv4(host)) {
      return false;
    }
    if (allowList && allowList.length > 0) {
      const normalized = u.href.replace(/\/+$/, '');
      const normalizedList = allowList
        .map((item) => {
          try {
            return new URL(item).href.replace(/\/+$/, '');
          } catch {
            return '';
          }
        })
        .filter(Boolean);
      if (!normalizedList.includes(normalized)) {
        devLog.warn('Mint URL not in allow-list:', url);
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function normalizeMintUrl(url: string): string | null {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // Strip default ports so equivalent URLs share storage keys.
    if (parsed.protocol === 'https:' && parsed.port === '443') parsed.port = '';
    if (parsed.protocol === 'http:' && parsed.port === '80') parsed.port = '';
    // Strip trailing slashes from pathname only (URL serialization re-adds a
    // root slash, so remove it from the final string).
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    // Only lowercase the origin (scheme + host + port), not path or query
    parsed.host = parsed.host.toLowerCase();
    return parsed.toString().replace(/\/$/, '');
  } catch {
    // Fallback for invalid URLs - only lowercase host-like portion before first /
    const withoutTrailing = trimmed.replace(/\/+$/, '');
    const schemeHostMatch = withoutTrailing.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+)(.*)$/);
    if (schemeHostMatch) {
      const scheme = schemeHostMatch[1].split('://')[0].toLowerCase();
      if (scheme !== 'http' && scheme !== 'https') return null;
      let hostPort = schemeHostMatch[1].toLowerCase();
      // Strip default ports in fallback path as well.
      hostPort = hostPort.replace(/:443(?=\/|$)/, '').replace(/:80(?=\/|$)/, '');
      return hostPort + schemeHostMatch[2];
    }
    return null;
  }
}

export function safeNormalizeMintUrl(url: string): string {
  return normalizeMintUrl(url) ?? url.trim();
}

/**
 * Prepare a decoded proof for RE-encoding with cashu-ts getEncodedToken.
 *
 * getDecodedToken yields a proof's witness as a JSON STRING, but the token
 * serializer only handles the OBJECT form correctly - given a string it
 * JSON-encodes it again, producing a double-encoded witness the mint cannot
 * parse (every P2PK signature check then fails). This burned the multisig
 * escrow release flow: the operator returns deposit proofs carrying its
 * witness signature, and receiveToken re-encodes entries per mint before
 * calling wallet.receive. Parse string witnesses back to objects; anything
 * unparseable is left untouched.
 */
export function normalizeProofWitnessForEncode<T extends object>(proof: T): T {
  const witness = (proof as { witness?: unknown }).witness;
  if (typeof witness !== 'string') return proof;
  try {
    const parsed: unknown = JSON.parse(witness);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...proof, witness: parsed };
    }
  } catch {
    // keep the original - an unparseable witness fails at the mint either way
  }
  return proof;
}

function isValidProof(p: unknown): p is { id: string; amount: number; secret: string; C: string } {
  if (!p || typeof p !== 'object') return false;
  const proof = p as Record<string, unknown>;
  if (typeof proof.id !== 'string' || proof.id.length === 0 || proof.id.length > MAX_PROOF_FIELD_LENGTH) return false;
  if (typeof proof.C !== 'string' || proof.C.length === 0 || proof.C.length > MAX_PROOF_FIELD_LENGTH) return false;
  if (typeof proof.secret !== 'string' || proof.secret.length === 0 || proof.secret.length > MAX_PROOF_FIELD_LENGTH) return false;
  if (proof.witness !== undefined && (typeof proof.witness !== 'string' || proof.witness.length > MAX_PROOF_FIELD_LENGTH)) return false;
  if (typeof proof.amount !== 'number') return false;
  const amount = proof.amount;
  return Number.isInteger(amount) && amount > 0 && amount <= Number.MAX_SAFE_INTEGER;
}

/**
 * Defensive decode of a Cashu token into per-mint entries.
 *
 * Upstream limitation (cashu-ts 2.x and 3.x): multi-entry v3 ("cashuA") tokens are
 * rejected by `getDecodedToken` ("Multi entry token are not supported"), so
 * this returns null for them - fail closed rather than hand-rolling the
 * legacy container parse. Single-entry v3 tokens are folded to the flat shape
 * by the library and decode normally. Pinned by tokenUtils.test.ts.
 */
export function decodeCashuToken(tokenStr: string): DecodedTokenEntry[] | null {
  if (typeof tokenStr !== 'string' || tokenStr.length > MAX_TOKEN_LENGTH) return null;
  let toDecode = tokenStr.trim();
  if (toDecode.toLowerCase().startsWith('cashu://')) {
    toDecode = toDecode.slice('cashu://'.length);
  } else if (toDecode.toLowerCase().startsWith('cashu:')) {
    toDecode = toDecode.slice('cashu:'.length);
  } else if (toDecode.toLowerCase().startsWith('cashu')) {
    toDecode = toDecode.slice('cashu'.length);
  }
  if (!toDecode) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let decoded: any;
  try {
    decoded = getDecodedToken(toDecode);
  } catch {
    return null;
  }

  const entries: DecodedTokenEntry[] = [];
  // The wallet only handles sat ecash; a usd/eur-unit token would be shown
  // and delivered as sats (value misrepresentation). An omitted unit is the
  // legacy sat default.
  const unitIsSat = (unit: unknown): boolean => unit === undefined || unit === null || unit === 'sat';

  if ('token' in decoded && Array.isArray(decoded.token)) {
    for (const entry of decoded.token) {
      const mintUrl = entry?.mint;
      const proofs = entry?.proofs;
      if (!unitIsSat(entry?.unit)) continue;
      // The blocked host (BAO signet test mint) is never a wallet mint: a
      // pasted/nutzap token from it must not be adopted, shown as balance, or
      // delivered as a real-money pledge (owner rule 2026-09-21).
      if (typeof mintUrl !== 'string' || mintUrl.length === 0 || !isAllowedMintUrl(mintUrl) || isBlockedMintUrl(mintUrl) || !Array.isArray(proofs) || proofs.length === 0) continue;
      const validProofs = proofs.filter(isValidProof);
      if (validProofs.length === 0) continue;
      const amount = validProofs.reduce((sum: number, p) => sum + p.amount, 0);
      entries.push({ mintUrl, proofs: validProofs, amount });
    }
  } else if ('mint' in decoded && 'proofs' in decoded) {
    const mintUrl = decoded.mint;
    const proofs = decoded.proofs;
    if (!unitIsSat(decoded.unit)) return null;
    if (typeof mintUrl !== 'string' || mintUrl.length === 0 || !isAllowedMintUrl(mintUrl) || isBlockedMintUrl(mintUrl) || !Array.isArray(proofs) || proofs.length === 0) return null;
    const validProofs = proofs.filter(isValidProof);
    if (validProofs.length === 0) return null;
    const amount = validProofs.reduce((sum: number, p) => sum + p.amount, 0);
    entries.push({ mintUrl, proofs: validProofs, amount });
  }

  return entries.length > 0 ? entries : null;
}

/** Deterministic hash of decoded token entries. Used to deduplicate receive attempts. */
export function hashDecodedToken(entries: DecodedTokenEntry[]): string {
  const sorted = [...entries]
    .map((e) => ({
      mintUrl: normalizeMintUrl(e.mintUrl) ?? e.mintUrl,
      proofs: [...e.proofs]
        .map((p) => {
          const proof = p as Record<string, unknown>;
          return {
            id: String(proof.id),
            amount: Number(proof.amount),
            secret: String(proof.secret),
            C: String(proof.C),
          };
        })
        .sort((a, b) => a.secret.localeCompare(b.secret)),
    }))
    .sort((a, b) => a.mintUrl.localeCompare(b.mintUrl));
  const hash = sha256(new TextEncoder().encode(JSON.stringify(sorted)));
  return bytesToBase64(hash);
}

/**
 * Check whether every proof in a token is already SPENT at its mint.
 *
 * Returns `true` (all proofs spent - the token was definitely redeemed by
 * someone), `false` (at least one proof is not spent - the token is still
 * redeemable), or `null` when the check could not be completed (undecodable
 * token, mint unreachable, malformed response).
 *
 * Used to distinguish "the recipient never saw this token" from "the
 * recipient redeemed it but the response was lost" - e.g. Routstr creates the
 * balance server-side before responding, so a lost HTTP response leaves the
 * proofs spent with no API key delivered.
 */
export async function checkTokenProofsSpent(tokenStr: string): Promise<boolean | null> {
  const entries = decodeCashuToken(tokenStr);
  if (!entries || entries.length === 0) return null;
  const encoder = new TextEncoder();
  for (const entry of entries) {
    const normalized = normalizeMintUrl(entry.mintUrl);
    if (!normalized) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let states: any[];
    try {
      const w = new Wallet(normalized);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      states = await w.checkProofsStates(entry.proofs as any);
    } catch {
      return null;
    }
    if (!Array.isArray(states) || states.length !== entry.proofs.length) return null;
    const stateByY = new Map<string, string>();
    for (const s of states) {
      if (!s || typeof s !== 'object' || typeof s.Y !== 'string' || typeof s.state !== 'string') return null;
      stateByY.set(s.Y, s.state);
    }
    for (const p of entry.proofs) {
      let Y: string;
      try {
        Y = hashToCurve(encoder.encode(String((p as { secret: unknown }).secret))).toHex(true);
      } catch {
        return null;
      }
      if (stateByY.get(Y) !== 'SPENT') return false;
    }
  }
  return true;
}
