/**
 * bao.markets custodial wallet balances (read-only).
 *
 * bao.markets holds per-user balances across several rails (lightning,
 * cashu, fedimint ecash, spark, liquid, ark, L1) in its own ledger. Those
 * sats are NOT NIP-60 ecash proofs, so the local ₿AO wallet can never see
 * them — the client fetches them from the API instead, authenticated with
 * NIP-98 (sign-only, so NIP-46 bunkers and NIP-07 extensions both work).
 */

import { baoNip98Header, type BaoApiSigner } from '@/lib/baoApiAuth';
import { baoApiBase } from '@/lib/baoFundraising';

export interface BaoRailBalance {
  sats: number;
}

/** Per-rail balances as returned by GET /v1/wallet/balance. */
export interface BaoWalletBalances {
  lightning: number;
  /** Fedimint ecash rail. */
  ecash: number;
  /** Custodial cashu ledger on bao.markets (distinct from local NIP-60 proofs). */
  cashu: number;
  spark: number;
  l1: number;
  liquid: number;
  ark: number;
}

interface RailPayload {
  sats?: unknown;
}

interface BalanceEnvelope {
  data?: {
    lightning?: RailPayload;
    ecash?: RailPayload;
    cashu?: RailPayload;
    spark?: RailPayload;
    l1?: RailPayload;
    liquid?: RailPayload;
    ark?: RailPayload;
  };
  error?: { message?: string };
}

function railSats(rail: RailPayload | undefined): number {
  const sats = Number(rail?.sats);
  return Number.isFinite(sats) && sats > 0 ? Math.floor(sats) : 0;
}

/** Fetch the caller's per-rail balances from the bao.markets API. */
export async function fetchBaoWalletBalances(signer: BaoApiSigner): Promise<BaoWalletBalances> {
  const url = `${baoApiBase()}/v1/wallet/balance`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: await baoNip98Header(signer, url, 'GET') },
  });
  const json = (await res.json().catch(() => ({}))) as BalanceEnvelope;
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  const d = json?.data ?? {};
  return {
    lightning: railSats(d.lightning),
    ecash: railSats(d.ecash),
    cashu: railSats(d.cashu),
    spark: railSats(d.spark),
    l1: railSats(d.l1),
    liquid: railSats(d.liquid),
    ark: railSats(d.ark),
  };
}

/** Sum of all custodial rails. */
export function totalBaoApiBalance(balances: BaoWalletBalances): number {
  return (
    balances.lightning +
    balances.ecash +
    balances.cashu +
    balances.spark +
    balances.l1 +
    balances.liquid +
    balances.ark
  );
}

// ─── Positions (my trades) ───────────────────────────────────────────────────

export interface BaoPosition {
  market_id: string;
  market_title?: string;
  outcome_id: string;
  /** Position size in sats. */
  size: number;
  /** Average entry price (0..1). */
  avg_price: number;
  /** Current outcome price (0..1), when the API has it. */
  current_price?: number;
  realized_pnl: number;
  unrealized_pnl: number;
  updated_at: number;
}

interface PositionsEnvelope {
  data?: {
    positions?: BaoPosition[];
  };
}

/** Fetch the caller's open positions from the bao.markets API (NIP-98 signed). */
export async function fetchBaoPositions(signer: BaoApiSigner): Promise<BaoPosition[]> {
  const url = `${baoApiBase()}/v1/positions`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: await baoNip98Header(signer, url, 'GET') },
  });
  const json = (await res.json().catch(() => ({}))) as PositionsEnvelope & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json?.data?.positions ?? [];
}

/** One SMJ (parimutuel) bet from GET /v1/smj/positions (same shape as BaoPosition + pool_model). */
export interface BaoSmjPosition extends BaoPosition {
  pool_model: 'smj';
}

/** Fetch the caller's SMJ bets from the bao.markets API (NIP-98 signed). Empty when the route isn't deployed yet. */
export async function fetchBaoSmjPositions(signer: BaoApiSigner): Promise<BaoSmjPosition[]> {
  const url = `${baoApiBase()}/v1/smj/positions`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: await baoNip98Header(signer, url, 'GET') },
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { positions?: BaoSmjPosition[] }; error?: { message?: string } };
  if (!res.ok) {
    // Older API deployments don't have this route yet — treat as no SMJ positions.
    if (res.status === 404) return [];
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json?.data?.positions ?? [];
}
