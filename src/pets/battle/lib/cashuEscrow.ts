// src/pets/battle/lib/cashuEscrow.ts
//
// Helpers for real-sats pet battle escrow using Cashu P2PK tokens.
//
// Both players lock their stake to a configured operator escrow pubkey before
// the battle starts. The operator (a trusted service) observes the signed
// battle-finished event and releases the combined stakes to the winner as a
// new Cashu token.

import { CashuMint, CashuWallet } from '@cashu/cashu-ts';
import { hashToCurve } from '@cashu/cashu-ts/crypto/common';

import { deriveNutzapKey, decodeCashuToken } from '@/lib/cashu/cashu';
import { bytesToHex } from '@noble/curves/utils.js';

export interface EscrowKeyPair {
  privkey: string;
  pubkey: string;
}

/**
 * Derive the user's battle-escrow P2PK keypair from their Cashu seed phrase.
 *
 * We reuse the Nutzap key derivation so the keypair is deterministic and the
 * same key material used elsewhere for Cashu receipts can be used here. The
 * private key never leaves the client.
 */
export function deriveBattleEscrowKeypair(seedPhrase: string): EscrowKeyPair {
  const key = deriveNutzapKey(seedPhrase);
  return {
    privkey: bytesToHex(key.privkey),
    pubkey: key.pubkey,
  };
}

interface P2PKSecret {
  pubkey?: string;
  /** Unix seconds from a NUT-11 `locktime` tag, when present. */
  locktime?: number;
}

/**
 * Normalize a P2PK/escrow pubkey to the lowercase x-only (64-hex) form.
 * Accepts x-only 64-hex and compressed 66-hex ('02'/'03' + 64 hex, as produced
 * by `deriveBattleEscrowKeypair`). Returns null for anything else.
 */
export function normalizeEscrowPubkey(pubkey: string | null | undefined): string | null {
  if (typeof pubkey !== 'string') return null;
  const lower = pubkey.toLowerCase();
  if (/^[0-9a-f]{64}$/.test(lower)) return lower;
  if (/^0[23][0-9a-f]{64}$/.test(lower)) return lower.slice(2);
  return null;
}

/** Lowercase + strip trailing slashes so mint URLs compare equal across forms. */
function normalizeMintUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

interface ParseP2PKOptions {
  /**
   * Extra NUT-11 tags (e.g. "refund", "locktime") that are allowed beyond the
   * required P2PK lock. Defaults to none — only the bare P2PK secret is
   * accepted.
   */
  allowedTags?: string[];
}

/**
 * Extract the allowed-tag names and locktime from a list of NUT-11 tags.
 * Returns null when any tag is malformed or not in `allowedTags`.
 */
function parseP2PKTags(
  tags: unknown[],
  allowedTags: string[],
): { locktime?: number } | null {
  let locktime: number | undefined;
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length === 0 || typeof tag[0] !== 'string') return null;
    if (!allowedTags.includes(tag[0])) return null;
    if (tag[0] === 'locktime') {
      const value = Number(tag[1]);
      if (!Number.isFinite(value)) return null;
      locktime = value;
    }
  }
  return { locktime };
}

function parseP2PKSecret(secret: unknown, options?: ParseP2PKOptions): P2PKSecret | null {
  const allowedTags = options?.allowedTags ?? [];
  if (typeof secret !== 'string') return null;
  try {
    const parsed = JSON.parse(secret);
    if (Array.isArray(parsed)) {
      if (parsed.length < 2) return null;
      if (parsed[0] !== 'P2PK') return null;
      const second: unknown = parsed[1];
      if (typeof second === 'string') {
        // Legacy form: ["P2PK", <pubkey>, ...tags]
        const parsedTags = parseP2PKTags(parsed.slice(2), allowedTags);
        if (!parsedTags) return null;
        return { pubkey: second, locktime: parsedTags.locktime };
      }
      if (second && typeof second === 'object' && !Array.isArray(second)) {
        // The real NUT-11 form cashu-ts emits for every locked proof:
        // ["P2PK", { nonce, data: <pubkey>, tags: [[name, ...], ...] }]
        const obj = second as Record<string, unknown>;
        if (typeof obj.data !== 'string') return null;
        const rawTags: unknown = obj.tags ?? [];
        if (!Array.isArray(rawTags)) return null;
        const parsedTags = parseP2PKTags(rawTags, allowedTags);
        if (!parsedTags) return null;
        return { pubkey: obj.data, locktime: parsedTags.locktime };
      }
      return null;
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.pubkey !== 'string') return null;
      // Reject object secrets carrying unexpected keys.
      const allowedKeys = new Set(['pubkey']);
      for (const tag of allowedTags) allowedKeys.add(tag);
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) return null;
      }
      return { pubkey: obj.pubkey };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Return true if every proof in the token is P2PK-locked to the given pubkey.
 * Both the token locks and the expected pubkey are normalized to x-only form
 * before comparison, so 64-hex and 66-hex compressed keys compare equal.
 */
export function isTokenLockedToPubkey(
  tokenStr: string,
  pubkey: string,
  options?: ParseP2PKOptions,
): boolean {
  const expected = normalizeEscrowPubkey(pubkey);
  if (!expected) return false;
  const entries = decodeCashuToken(tokenStr);
  if (!entries || entries.length === 0) return false;
  for (const entry of entries) {
    for (const proof of entry.proofs) {
      const p = proof as { secret?: unknown } | undefined;
      const lock = parseP2PKSecret(p?.secret, options);
      if (normalizeEscrowPubkey(lock?.pubkey) !== expected) return false;
    }
  }
  return true;
}

/**
 * Extract the distinct P2PK lock pubkeys found across all proofs in a token.
 * Returns an empty array for fully-unlocked (bearer) tokens. Handles both the
 * real NUT-11 form cashu-ts emits (["P2PK", { nonce, data, tags }]) and the
 * legacy string form. Proofs whose secrets don't parse as strict P2PK (e.g.
 * locked secrets carrying tags that were not explicitly allowed) are skipped,
 * so callers deciding between "locked vs bearer" should compare against the
 * proof count when it matters.
 * Lock pubkeys are normalized: a 33-byte compressed key ('02'/'03' + 64 hex)
 * is lowercased and returned as-is; the x-only 64-hex form is returned as-is.
 */
export function extractTokenLockPubkeys(tokenStr: string, options?: ParseP2PKOptions): string[] {
  const entries = decodeCashuToken(tokenStr);
  if (!entries || entries.length === 0) return [];
  const locks = new Set<string>();
  for (const entry of entries) {
    for (const proof of entry.proofs) {
      const p = proof as { secret?: unknown } | undefined;
      const lock = parseP2PKSecret(p?.secret, options);
      if (lock?.pubkey) locks.add(lock.pubkey.toLowerCase());
    }
  }
  return [...locks];
}

/**
 * Sum the amount of all token entries.
 */
export function getTokenAmount(tokenStr: string): number {
  const entries = decodeCashuToken(tokenStr);
  if (!entries) return 0;
  return entries.reduce((sum, e) => sum + (e.amount ?? 0), 0);
}

export interface EscrowDepositValidation {
  valid: boolean;
  reason?: string;
  amount: number;
}

/**
 * NUT-11 tags a battle-escrow deposit may carry beyond the bare P2PK lock:
 * `locktime` + `refund` are the canonical recoverable-escrow mechanism (the
 * depositor can self-recover after expiry if the battle never finishes).
 */
const ESCROW_ALLOWED_LOCK_TAGS = ['locktime', 'refund'];

/**
 * A deposit whose refund locktime expires before the battle can finish lets
 * the loser reclaim their own stake before the operator releases it to the
 * winner. Require any locktime to be at least this far in the future.
 */
const MIN_LOCKTIME_HEADROOM_SECONDS = 600;

/**
 * Returns a rejection reason when any proof's refund locktime expires too
 * soon, null otherwise. Assumes the token already passed
 * `isTokenLockedToPubkey` (unparseable proofs are skipped here).
 */
function depositLocktimeReason(tokenStr: string): string | null {
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const entry of decodeCashuToken(tokenStr) ?? []) {
    for (const proof of entry.proofs) {
      const lock = parseP2PKSecret(
        (proof as { secret?: unknown }).secret,
        { allowedTags: ESCROW_ALLOWED_LOCK_TAGS },
      );
      if (lock?.locktime !== undefined && lock.locktime < nowSeconds + MIN_LOCKTIME_HEADROOM_SECONDS) {
        return 'Deposit refund locktime expires too soon — the stake could be reclaimed before the battle finishes';
      }
    }
  }
  return null;
}

/**
 * Validate that a deposit token locks the expected amount to the operator
 * escrow pubkey and uses an allowed mint.
 *
 * Deposits may carry NUT-11 `locktime`/`refund` tags (the self-recovery path
 * for abandoned battles); when a locktime is present it must be far enough in
 * the future that the loser cannot reclaim their stake mid-battle.
 *
 * @param allowedMints When provided (and non-empty), every token entry must
 *  come from one of these mints — the escrow operator can only release
 *  deposits whose mints match, and it rejects mixed-mint releases outright.
 */
export function validateEscrowDeposit(
  tokenStr: string,
  expectedAmount: number,
  escrowPubkey: string,
  allowedMints?: string[],
): EscrowDepositValidation {
  const amount = getTokenAmount(tokenStr);
  if (amount <= 0) {
    return { valid: false, reason: 'Token is empty or invalid', amount: 0 };
  }
  if (amount !== expectedAmount) {
    return { valid: false, reason: `Token amount ${amount} does not match expected ${expectedAmount}`, amount };
  }
  if (!isTokenLockedToPubkey(tokenStr, escrowPubkey, { allowedTags: ESCROW_ALLOWED_LOCK_TAGS })) {
    return { valid: false, reason: 'Token is not locked to the escrow pubkey', amount };
  }
  const locktimeReason = depositLocktimeReason(tokenStr);
  if (locktimeReason) {
    return { valid: false, reason: locktimeReason, amount };
  }
  if (allowedMints && allowedMints.length > 0) {
    const allowed = new Set(allowedMints.map(normalizeMintUrl));
    for (const entry of decodeCashuToken(tokenStr) ?? []) {
      if (!allowed.has(normalizeMintUrl(entry.mintUrl))) {
        return { valid: false, reason: `Token mint ${entry.mintUrl} is not one of your wallet's mints — the escrow operator can only release matching-mint deposits`, amount };
      }
    }
  }
  return { valid: true, amount };
}

/**
 * Ask each proof's mint for its NUT-07 state and return a rejection reason
 * when the deposit cannot be proven unspent, null when every proof is
 * UNSPENT.
 *
 * The static checks in `validateEscrowDeposit` (amount, lock, mint) are all
 * satisfiable by a token whose proofs were already redeemed — e.g. a deposit
 * re-sent from a previous battle. A cheater's spent stake strands the honest
 * player's real deposit (the operator's release fails on the spent leg), so
 * an unverifiable deposit is rejected too: accepting it is strictly worse
 * than refusing to play.
 */
export async function checkEscrowDepositSpentState(tokenStr: string): Promise<string | null> {
  const entries = decodeCashuToken(tokenStr);
  if (!entries || entries.length === 0) return 'Token is empty or invalid';
  const encoder = new TextEncoder();
  for (const entry of entries) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let states: any[];
    try {
      const wallet = new CashuWallet(new CashuMint(normalizeMintUrl(entry.mintUrl)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      states = await wallet.checkProofsStates(entry.proofs as any);
    } catch {
      return `Could not verify the deposit with mint ${entry.mintUrl} — refusing an unverifiable stake`;
    }
    if (!Array.isArray(states) || states.length !== entry.proofs.length) {
      return `Mint ${entry.mintUrl} returned a malformed proof-state response`;
    }
    const stateByY = new Map<string, string>();
    for (const s of states) {
      if (!s || typeof s !== 'object' || typeof s.Y !== 'string' || typeof s.state !== 'string') {
        return `Mint ${entry.mintUrl} returned a malformed proof-state response`;
      }
      stateByY.set(s.Y, s.state);
    }
    for (const proof of entry.proofs) {
      let Y: string;
      try {
        Y = hashToCurve(encoder.encode(String((proof as { secret?: unknown }).secret))).toHex(true);
      } catch {
        return 'Could not hash a deposit proof for the mint state check';
      }
      const state = stateByY.get(Y);
      if (state === 'SPENT') {
        return 'Deposit proofs are already spent at the mint — the stake was already redeemed';
      }
      if (state === 'PENDING') {
        return 'Deposit proofs are pending at the mint — the stake is mid-swap and cannot be trusted';
      }
      if (state !== 'UNSPENT') {
        return `Mint ${entry.mintUrl} did not confirm the deposit proofs as unspent`;
      }
    }
  }
  return null;
}

/**
 * Request the escrow operator to release the locked stakes to the winner.
 *
 * The operator verifies the signed battle-finished event and returns a fresh
 * Cashu token paid to the winner. When no service URL is configured this
 * returns null and the winner must request release out-of-band.
 */
export async function requestEscrowRelease(args: {
  serviceUrl: string;
  battleId: string;
  winnerPubkey: string;
  hostPubkey: string;
  guestPubkey: string;
  hostDepositToken: string;
  guestDepositToken: string;
  finishedEvent: Record<string, unknown>;
}): Promise<{ token: string } | null> {
  const {
    serviceUrl,
    battleId,
    winnerPubkey,
    hostPubkey,
    guestPubkey,
    finishedEvent,
    hostDepositToken,
    guestDepositToken,
  } = args;
  if (!serviceUrl) return null;

  const url = serviceUrl.replace(/\/$/, '') + '/release';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      battleId,
      winnerPubkey,
      hostEscrowPubkey: hostPubkey,
      guestEscrowPubkey: guestPubkey,
      hostDepositToken,
      guestDepositToken,
      finishedEvent,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Release request failed');
    throw new Error(text);
  }

  const data = (await res.json()) as { token?: string };
  if (!data.token) return null;
  return { token: data.token };
}

/**
 * Pending escrow-claim journal (localStorage).
 *
 * The escrow deposit tokens live only in React state during a battle, and the
 * winner's release request is a single fetch: if it fails (or the page is
 * closed) the tokens — and with them any way to claim the locked stakes —
 * would be gone for good. Journaling everything the release needs BEFORE the
 * first attempt makes the claim durable: it survives refresh/close and is
 * retried on the next visit to the battle page.
 *
 * The release token returned by the operator is journaled as soon as it
 * arrives, BEFORE the wallet receive: the operator will not release twice, so
 * a receive failure must never trigger a second /release call.
 */
export interface PendingEscrowClaim {
  battleId: string;
  winnerPubkey: string;
  hostPubkey: string;
  guestPubkey: string;
  hostDepositToken: string;
  guestDepositToken: string;
  finishedEvent: Record<string, unknown>;
  prizeAmount: number;
  createdAt: number;
  attempts: number;
  /** Set once the operator has released — retry then only re-receives. */
  releaseToken?: string;
}

const PENDING_CLAIM_PREFIX = 'bao_battle_claim_';
/** Stop auto-retrying after this many failures (journal is kept for support). */
export const PENDING_CLAIM_MAX_ATTEMPTS = 25;

function pendingClaimKey(battleId: string): string {
  return `${PENDING_CLAIM_PREFIX}${battleId}`;
}

export function savePendingEscrowClaim(claim: PendingEscrowClaim): void {
  try {
    localStorage.setItem(pendingClaimKey(claim.battleId), JSON.stringify(claim));
  } catch {
    // Best-effort — a full localStorage must not break the battle flow.
  }
}

export function loadPendingEscrowClaims(): PendingEscrowClaim[] {
  const claims: PendingEscrowClaim[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PENDING_CLAIM_PREFIX)) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '') as Partial<PendingEscrowClaim>;
        if (
          typeof parsed.battleId !== 'string' ||
          typeof parsed.winnerPubkey !== 'string' ||
          typeof parsed.hostDepositToken !== 'string' ||
          typeof parsed.guestDepositToken !== 'string'
        ) {
          continue;
        }
        claims.push({
          battleId: parsed.battleId,
          winnerPubkey: parsed.winnerPubkey,
          hostPubkey: typeof parsed.hostPubkey === 'string' ? parsed.hostPubkey : '',
          guestPubkey: typeof parsed.guestPubkey === 'string' ? parsed.guestPubkey : '',
          hostDepositToken: parsed.hostDepositToken,
          guestDepositToken: parsed.guestDepositToken,
          finishedEvent: (parsed.finishedEvent ?? {}) as Record<string, unknown>,
          prizeAmount: typeof parsed.prizeAmount === 'number' ? parsed.prizeAmount : 0,
          createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
          attempts: typeof parsed.attempts === 'number' ? parsed.attempts : 0,
          releaseToken: typeof parsed.releaseToken === 'string' ? parsed.releaseToken : undefined,
        });
      } catch {
        continue;
      }
    }
  } catch {
    // storage blocked
  }
  return claims;
}

export function clearPendingEscrowClaim(battleId: string): void {
  try {
    localStorage.removeItem(pendingClaimKey(battleId));
  } catch {
    // Ignore — a stale entry only causes a harmless extra retry.
  }
}
