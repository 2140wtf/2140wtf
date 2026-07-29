// src/pets/battle/lib/cashuEscrow.ts
//
// Helpers for real-sats pet battle escrow using Cashu P2PK tokens.
//
// Both players lock their stake to a configured operator escrow pubkey before
// the battle starts. The operator (a trusted service) observes the signed
// battle-finished event and releases the combined stakes to the winner as a
// new Cashu token.

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
   * required ["P2PK", <pubkey>]. Defaults to none — only the bare P2PK secret is
   * accepted.
   */
  allowedTags?: string[];
}

function parseP2PKSecret(secret: unknown, options?: ParseP2PKOptions): P2PKSecret | null {
  const allowedTags = options?.allowedTags ?? [];
  if (typeof secret !== 'string') return null;
  try {
    const parsed = JSON.parse(secret);
    if (Array.isArray(parsed)) {
      // NUT-11 P2PK secrets look like ["P2PK", <pubkey>, ...tags]
      if (parsed.length < 2) return null;
      if (parsed[0] !== 'P2PK') return null;
      if (typeof parsed[1] !== 'string') return null;
      // Reject extra tags unless every one is explicitly allowed.
      if (parsed.length > 2) {
        const tags = parsed.slice(2);
        if (
          !tags.every((tag) => {
            if (!Array.isArray(tag) || tag.length === 0) return false;
            return allowedTags.includes(tag[0]);
          })
        ) {
          return null;
        }
      }
      return { pubkey: parsed[1] };
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
 * Returns an empty array for fully-unlocked (bearer) tokens. Proofs whose
 * secrets don't parse as strict P2PK are skipped, so callers deciding between
 * "locked vs bearer" should compare against the proof count when it matters.
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
 * Validate that a deposit token locks the expected amount to the operator
 * escrow pubkey and uses an allowed mint.
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
  if (!isTokenLockedToPubkey(tokenStr, escrowPubkey)) {
    return { valid: false, reason: 'Token is not locked to the escrow pubkey', amount };
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
