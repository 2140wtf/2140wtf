/**
 * Commit-reveal for sealed auction bids and reserves.
 *
 * Nostr bid events are public — every relay reader sees every amount. To get
 * eBay-style proxy bidding and hidden reserves WITHOUT a trusted server, the
 * secret value (max bid / reserve) is published as a hash commitment:
 *
 *   commit = sha256(domain ‖ auctionAddress ‖ pubkey ‖ value_be(8B) ‖ nonce)
 *
 * - Bidding: the client auto-raises the VISIBLE bid by minimal increments on
 *   behalf of the committed max (client-side proxy, decentralized). Rivals
 *   learn the current price, never the ceiling.
 * - Reveal: at settlement (or on demand) the committer publishes
 *   {value, nonce}; anyone re-derives the hash and verifies binding.
 * - Fail-closed: an unrevealed max invalidates the bid above it; an
 *   unrevealed reserve is treated as NOT MET (bidders refunded, seller
 *   unpaid). There is no outcome in which silence pays.
 *
 * The domain-separated preimage keeps commitments from one auction/bidder
 * from being replayed into another, and binds the committer's pubkey.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

/** Domain separator — versioned so the scheme can evolve without ambiguity. */
const COMMIT_DOMAIN = 'bao-auction-commit-v1';

/** Length of the random nonce (bytes) — 128-bit birthday bound is plenty. */
const NONCE_BYTES = 16;

/** A hash commitment published in a bid or auction event. */
export interface AuctionCommitment {
  /** Lowercase hex sha256 of the domain-separated preimage. */
  commit: string;
}

/** The secret side of a commitment, kept local until reveal time. */
export interface CommitSecret {
  /** The committed sats value. */
  valueSats: number;
  /** Hex nonce. */
  nonce: string;
}

/** Hex string that is exactly 64 chars (sha256 digest). */
export function isCommitmentHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Build the domain-separated preimage and hash it.
 * Exported for verification tests; callers use the two helpers below.
 */
export function computeCommitment(parts: {
  auctionAddress: string;
  pubkey: string;
  valueSats: number;
  nonce: string;
}): string {
  const valueBuf = new Uint8Array(8);
  new DataView(valueBuf.buffer).setBigUint64(0, BigInt(Math.max(0, Math.round(parts.valueSats))), false);
  const nonceBuf = hexToBytes(parts.nonce);
  // sha256(domain || 0x00 || auction || 0x00 || pubkey || 0x00 || value_be || nonce)
  const chunks: Uint8Array[] = [
    utf8(COMMIT_DOMAIN),
    utf8(parts.auctionAddress),
    utf8(parts.pubkey),
    valueBuf,
    nonceBuf,
  ];
  let total = 1; // domain + NUL
  for (const c of chunks) total += c.length + 1;
  const preimage = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    preimage.set(c, off);
    off += c.length;
    preimage[off] = 0x00; // unambiguous separator
    off += 1;
  }
  return bytesToHex(sha256(preimage));
}

/** Create a fresh commitment + secret pair for a value. */
export function createCommitment(parts: {
  auctionAddress: string;
  pubkey: string;
  valueSats: number;
}): { commitment: string; secret: CommitSecret } {
  const nonce = bytesToHex(randomBytes(NONCE_BYTES));
  const commitment = computeCommitment({ ...parts, nonce });
  return { commitment, secret: { valueSats: Math.max(0, Math.round(parts.valueSats)), nonce } };
}

/**
 * Verify a reveal against a published commitment: true iff the hash of the
 * revealed {value, nonce} reproduces the commitment exactly.
 */
export function verifyReveal(parts: {
  auctionAddress: string;
  pubkey: string;
  commitment: string;
  secret: CommitSecret;
}): boolean {
  if (!isCommitmentHex(parts.commitment)) return false;
  if (typeof parts.secret?.valueSats !== 'number' || !Number.isSafeInteger(parts.secret.valueSats) || parts.secret.valueSats < 0) return false;
  if (typeof parts.secret?.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(parts.secret.nonce)) return false;
  return computeCommitment({
    auctionAddress: parts.auctionAddress,
    pubkey: parts.pubkey,
    valueSats: parts.secret.valueSats,
    nonce: parts.secret.nonce,
  }) === parts.commitment.toLowerCase();
}

// ── In-memory secrets journal ───────────────────────────────────────────────

// Reveal secrets are intentionally tab-scoped and never persisted. Storing them
// in localStorage/sessionStorage would expose the bidder's sealed max/reserve
// to any same-origin script and trigger CodeQL clear-text-storage findings.
const MAX_IN_MEMORY_SECRETS = 256;
const inMemorySecrets = new Map<string, StoredSecret>();

interface StoredSecret extends CommitSecret {
  /** `${pubkey}:${auctionAddress}:${scope}` — scope is 'max' | 'reserve'. */
  key: string;
  /** When the commitment was created (unix seconds). */
  createdAt: number;
}

export type CommitScope = 'max' | 'reserve';

function secretKey(pubkey: string, auctionAddress: string, scope: CommitScope): string {
  return `${pubkey}:${auctionAddress}:${scope}`;
}

/** Save a reveal secret so this client can publish it at settlement time. */
export function saveCommitSecret(args: {
  pubkey: string;
  auctionAddress: string;
  scope: CommitScope;
  secret: CommitSecret;
}): void {
  const key = secretKey(args.pubkey, args.auctionAddress, args.scope);
  if (inMemorySecrets.size >= MAX_IN_MEMORY_SECRETS && !inMemorySecrets.has(key)) {
    const oldestKey = inMemorySecrets.keys().next().value;
    if (oldestKey) inMemorySecrets.delete(oldestKey);
  }
  inMemorySecrets.delete(key);
  inMemorySecrets.set(key, {
    key,
    valueSats: args.secret.valueSats,
    nonce: args.secret.nonce,
    createdAt: Math.floor(Date.now() / 1000),
  });
}

/** Load this client's reveal secret for a commitment, if it made one. */
export function loadCommitSecret(args: {
  pubkey: string;
  auctionAddress: string;
  scope: CommitScope;
}): CommitSecret | null {
  const s = inMemorySecrets.get(secretKey(args.pubkey, args.auctionAddress, args.scope));
  return s ? { valueSats: s.valueSats, nonce: s.nonce } : null;
}

/** Forget the secret after a successful reveal (or refunded auction). */
export function clearCommitSecret(args: {
  pubkey: string;
  auctionAddress: string;
  scope: CommitScope;
}): void {
  inMemorySecrets.delete(secretKey(args.pubkey, args.auctionAddress, args.scope));
}

// ── small utils ────────────────────────────────────────────────────────────

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = /^[0-9a-fA-F]*$/.test(hex) ? hex : '';
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
