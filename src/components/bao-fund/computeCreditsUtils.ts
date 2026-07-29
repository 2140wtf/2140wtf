import { decodeCashuToken } from '@/lib/cashu/cashu';

/**
 * localStorage key for the funding-token outbox. SCOPED BY FUNDER PUBKEY:
 * the outbox holds the only durable copy of a minted token, and on a shared
 * browser an unscoped key would let account B see (or destroy) account A's
 * token — bearer tokens included.
 */
export function creditOutboxStorageKey(funderPubkey: string | undefined, requestId: string): string {
  return `bao_credit_outbox_${funderPubkey ?? 'logged-out'}_${requestId}`;
}

/**
 * True when a token carries lock-shaped proof secrets that
 * extractTokenLockPubkeys silently skips (P2PK with locktime/refund/n_sigs
 * tags, the standard NUT-11 object form, HTLCs, …). Such tokens are NOT
 * bearer — Routstr's unsigned split is rejected by the mint, and the
 * receive-back fallback can't sign for them either.
 */
export function hasUnsupportedLockSecrets(tokenStr: string): boolean {
  const entries = decodeCashuToken(tokenStr);
  if (!entries) return false;
  for (const entry of entries) {
    for (const proof of entry.proofs) {
      const secret = (proof as { secret?: unknown }).secret;
      if (typeof secret !== 'string') continue;
      try {
        const parsed: unknown = JSON.parse(secret);
        // NUT-10 well-known secrets are ["<KIND>", …] — P2PK, HTLC, …
        if (Array.isArray(parsed) && typeof parsed[0] === 'string') return true;
      } catch { /* plain bearer secret */ }
    }
  }
  return false;
}
