/**
 * demoFaucet - claim demo (private-signet) sats from the demo universe API.
 *
 * The old HTTP signet faucet (deleted in b2f77e6) is replaced by the demo
 * API's own faucet: `POST /v1/wallet/claim` is ASYNC (202 pending ->
 * completed), so the claim is polled through `/v1/wallet/claim-status` until
 * it settles and the per-rail balance is read back. Keys are URL-safe and at
 * most 64 chars - the status route puts the key in the path, and a `:` there
 * breaks the API's NIP-98 audience match.
 *
 * Demo-only by design: the testnet Fund API is non-custodial and has no
 * faucet (`assertNonCustodialConfig` fails closed with custody config there).
 */
import { errorMessage } from './errors';
import { fundFetch, type FundHttpSigner } from './fundHttp';
import {
  DEMO_FAUCET_RAILS,
  DEMO_LEDGER_RAILS,
  isDemoNetwork,
  type DemoFaucetRail,
  type DemoLedgerRail,
} from './fundNetwork';

export interface DemoClaimResult {
  rail: DemoFaucetRail;
  status: 'completed' | 'failed' | 'pending';
  claimedSats: number;
  message?: string;
}

interface ClaimResponse {
  status?: string;
  idempotency_key?: string;
  rail?: string;
  amount_sats?: number;
}

interface ClaimStatusResponse {
  status?: string;
  result?: { claimed_sats?: number; new_balance_sats?: number; error?: string; code?: string } | null;
}

type BalanceResponse = Record<string, { sats?: number } | undefined>;

/** Per-claim ceiling the client asks for; the faucet enforces its own 24h cap. */
export const DEMO_CLAIM_MAX_SATS = 10_000;

function claimKey(rail: string): string {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `baofund-${rail}-${uuid}`.slice(0, 64);
}

/** Poll a claim to a terminal state; `pending` is slow, not failed. */
export async function pollDemoClaim(
  signer: FundHttpSigner,
  key: string,
  pollMs = 2_000,
  timeoutMs = 60_000,
): Promise<{ status: 'completed' | 'failed' | 'pending'; claimedSats?: number; message?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    // fundFetch returns the whole JSON body; the API envelope is {data, meta}.
    const body = await fundFetch<{ data?: ClaimStatusResponse }>(`/v1/wallet/claim-status/${key}`, { signer });
    const status = body?.data;
    const state = status?.status;
    if (state === 'completed') return { status: 'completed', claimedSats: status?.result?.claimed_sats };
    if (state === 'failed') {
      const reason = status?.result?.error ?? status?.result?.code ?? 'claim failed';
      return { status: 'failed', message: String(reason) };
    }
  }
  return { status: 'pending' };
}

/**
 * Claim demo sats on the first faucet rail that settles (lightning first -
 * LNbits is the fast path; cashu/ecash depend on the signet mint/federation).
 */
export async function claimDemoSats(
  signer: FundHttpSigner,
  opts: { amountSats?: number; rails?: readonly DemoFaucetRail[]; pollMs?: number; timeoutMs?: number } = {},
): Promise<DemoClaimResult> {
  const fallbackRail: DemoFaucetRail = opts.rails?.[0] ?? DEMO_FAUCET_RAILS[0];
  if (!isDemoNetwork()) {
    return {
      rail: fallbackRail,
      status: 'failed',
      claimedSats: 0,
      message: 'The faucet is demo-only; the testnet Fund API is non-custodial.',
    };
  }
  const amountSats = Math.min(Math.max(1, Math.floor(opts.amountSats ?? DEMO_CLAIM_MAX_SATS)), DEMO_CLAIM_MAX_SATS);
  const rails = opts.rails ?? DEMO_FAUCET_RAILS;
  let last: DemoClaimResult = { rail: fallbackRail, status: 'failed', claimedSats: 0, message: 'No demo faucet rail accepted the claim.' };

  for (const rail of rails) {
    const key = claimKey(rail);
    try {
      await fundFetch<{ data?: ClaimResponse }>('/v1/wallet/claim', {
        method: 'POST',
        signer,
        body: { rail, amount_sats: amountSats, idempotency_key: key },
      });
    } catch (e) {
      last = { rail, status: 'failed', claimedSats: 0, message: errorMessage(e) };
      continue;
    }
    const settled = await pollDemoClaim(signer, key, opts.pollMs, opts.timeoutMs);
    if (settled.status === 'completed') {
      return { rail, status: 'completed', claimedSats: settled.claimedSats ?? amountSats };
    }
    last = { rail, status: settled.status, claimedSats: 0, message: settled.message };
  }
  return last;
}

/** The ledger rail (cashu/ecash) this wallet can pay a contribution from. */
export async function demoFundedRail(
  signer: FundHttpSigner,
  minSats: number,
): Promise<{ rail: DemoLedgerRail; balanceSats: number } | null> {
  const body = await fundFetch<{ data?: BalanceResponse }>('/v1/wallet/balance', { signer });
  const balances = body?.data;
  for (const rail of DEMO_LEDGER_RAILS) {
    const sats = balances?.[rail]?.sats ?? 0;
    if (sats >= minSats) return { rail, balanceSats: sats };
  }
  return null;
}
