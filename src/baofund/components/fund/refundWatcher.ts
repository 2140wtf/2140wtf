/**
 * Refund candidate discovery and a fail-closed execution boundary.
 * The current backend response does not establish donor-controlled outputs
 * or recoverable wallet proofs. Discovery is advisory; it does not prove
 * eligibility. claimRefund must remain unavailable until that contract exists.
 */
import { fundFetch, fundApiOrigin, type FundHttpSigner } from '../../lib/fundHttp';


// ─── Types ──────────────────────────────────────────────────────────────────

export interface RefundCandidate {
  contributionId: number;
  fundraiserId: string;
  amountSats: number;
  rail: string;
}

export interface RefundResult {
  ok: boolean;
  refundedSats: number;
  message: string;
}

export interface RefundDeps {
  /** Signs Nostr events (NIP-98) for authenticated API calls. */
  signer: FundHttpSigner;
  /** Donor pubkey (x-only hex). */
  donorPubkey: string;
  /** Donor private key (hex) - used for P2PK witness signing on the refund swap. */
  donorPrivkey: string;
  apiBase?: string;
}

// ─── Candidate detection ─────────────────────────────────────────────────────

/** Find the donor's escrowed contributions across campaigns. */
export async function findRefundCandidates(
  deps: Pick<RefundDeps, 'donorPubkey'>,
  fundraiserIds: string[],
  apiBase?: string,
): Promise<RefundCandidate[]> {
  const base = apiBase ?? fundApiOrigin();
  const candidates: RefundCandidate[] = [];
  for (const frId of fundraiserIds) {
    try {
      const body = await fundFetch<{ data?: Array<Record<string, unknown>> }>(
        `/v1/fundraisers/${encodeURIComponent(frId)}/contributions?limit=100`,
        { base },
      );
      for (const c of body.data ?? []) {
        if (String(c.contributor_pubkey ?? '').toLowerCase() !== deps.donorPubkey.toLowerCase()) continue;
        if (c.status === 'refunded') continue; // already refunded
        if (!c.lock_secret && !c.cashu_token) continue;
        candidates.push({
          contributionId: Number(c.id),
          fundraiserId: frId,
          amountSats: Number(c.amount_sats) || 0,
          rail: typeof c.rail === 'string' ? c.rail : 'cashu',
        });
      }
    } catch { /* skip unreachable campaigns */ }
  }
  return candidates;
}

// ─── Refund claim ────────────────────────────────────────────────────────────

/**
 * R10 containment: the old flow signed server-selected inputs without proving
 * output ownership, and interpreted HTTP success as recovered funds. Remove
 * that signing/completion path rather than letting an unverified response
 * authorize a spend. No server call or donor witness is produced here.
 *
 * Re-enable only after client-owned output construction, mint/keyset and
 * input-policy validation, independently verified witnesses, and returned
 * proof validation plus durable wallet storage are implemented together.
 */
export async function claimRefund(_deps: RefundDeps, _candidate: RefundCandidate): Promise<RefundResult> {
  return {
    ok: false,
    refundedSats: 0,
    message: 'Refund unavailable: donor-controlled outputs and recoverable wallet proofs cannot yet be verified. No refund was submitted.',
  };
}
