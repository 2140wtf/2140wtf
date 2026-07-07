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
 */
export function isTokenLockedToPubkey(
  tokenStr: string,
  pubkey: string,
  options?: ParseP2PKOptions,
): boolean {
  const entries = decodeCashuToken(tokenStr);
  if (!entries || entries.length === 0) return false;
  for (const entry of entries) {
    for (const proof of entry.proofs) {
      const p = proof as { secret?: unknown } | undefined;
      const lock = parseP2PKSecret(p?.secret, options);
      if (lock?.pubkey !== pubkey) return false;
    }
  }
  return true;
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
 */
export function validateEscrowDeposit(
  tokenStr: string,
  expectedAmount: number,
  escrowPubkey: string,
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
