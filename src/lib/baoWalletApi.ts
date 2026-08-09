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
    // A wedged deployment hung this route for 60s (Cloudflare 504); a fresh
    // wallet can still take ~20s on the first read. Fail fast enough that the
    // UI degrades to local balances instead of stalling the whole wallet.
    signal: AbortSignal.timeout(30_000),
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

// ─── Scoped demo-sats spend (POST /v1/wallet/send) ───────────────────────────

/** Rails the scoped spend endpoint accepts. */
export type BaoSendRail = 'lightning' | 'cashu' | 'l1' | 'liquid' | 'spark' | 'ark' | 'ecash';

export interface BaoSendInput {
  rail: BaoSendRail;
  amountSats: number;
  /** `user:<64-hex-pubkey>` or `fundraiser:<fundraiser-id>` — anything else is rejected as out of scope. */
  destination: string;
  /** One UUID per user action; reused verbatim on retries so double-taps can't double-spend. */
  idempotencyKey: string;
}

export interface BaoSendResult {
  status: string;
  new_balance_sats?: number;
}

/** Thrown for every non-2xx spend; `code` carries the API's machine code (INSUFFICIENT_BALANCE, SEND_DAILY_LIMIT, …). */
export class BaoSendError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'BaoSendError';
  }
}

/** True while the scoped spend route hasn't shipped to the API deployment yet. */
export function isSendRouteMissing(e: unknown): boolean {
  return e instanceof BaoSendError && e.httpStatus === 404;
}

/**
 * Spend demo sats from the caller's custodial per-rail balance (POST
 * /v1/wallet/send). Scoped destinations only: `user:<pubkey>` transfers to
 * another ₿AO user, `fundraiser:<id>` contributes to a milestone fundraiser
 * (the balance-debit path equivalent of /v1/fundraisers/:id/contribute).
 * The API binds the NIP-98 auth to the exact body via the payload hash.
 */
export async function sendDemoSats(signer: BaoApiSigner, input: BaoSendInput): Promise<BaoSendResult> {
  const url = `${baoApiBase()}/v1/wallet/send`;
  const body = JSON.stringify({
    rail: input.rail,
    amount_sats: input.amountSats,
    destination: input.destination,
    idempotency_key: input.idempotencyKey,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: await baoNip98Header(signer, url, 'POST', body),
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: BaoSendResult;
    error?: { message?: string; code?: string };
    message?: string;
  };
  if (!res.ok) {
    throw new BaoSendError(json?.error?.message ?? json?.message ?? `HTTP ${res.status}`, json?.error?.code, res.status);
  }
  return json?.data ?? { status: 'completed' };
}

export interface BaoDepositInvoice {
  bolt11: string;
  payment_hash: string;
  amount_sats: number;
  expires_at: number;
}

export async function createBaoDepositInvoice(
  signer: BaoApiSigner,
  amountSats: number,
  memo = 'BAO wallet deposit',
): Promise<BaoDepositInvoice> {
  const url = `${baoApiBase()}/v1/wallet/deposit`;
  const body = JSON.stringify({ amount_sats: amountSats, memo });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: await baoNip98Header(signer, url, 'POST', body) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: BaoDepositInvoice; error?: { message?: string } };
  if (!res.ok || !json.data) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json.data;
}

export async function checkBaoDepositStatus(
  signer: BaoApiSigner,
  paymentHash: string,
): Promise<{ paid: boolean; amount_sats?: number; preimage?: string }> {
  const url = `${baoApiBase()}/v1/wallet/deposit-status/${encodeURIComponent(paymentHash)}`;
  const res = await fetch(url, {
    headers: { Authorization: await baoNip98Header(signer, url, 'GET') },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { paid?: boolean; amount_sats?: number; preimage?: string }; error?: { message?: string } };
  if (!res.ok || !json.data) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return { paid: json.data.paid === true, amount_sats: json.data.amount_sats, preimage: json.data.preimage };
}

export async function redeemBaoCashuToken(
  signer: BaoApiSigner,
  token: string,
  idempotencyKey = crypto.randomUUID(),
): Promise<{ amount_sats: number; balance_sats: number; redeemed: boolean }> {
  const url = `${baoApiBase()}/v1/wallet/cashu-redeem`;
  const body = JSON.stringify({ token, idempotency_key: idempotencyKey });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: await baoNip98Header(signer, url, 'POST', body) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { amount_sats: number; balance_sats: number; redeemed: boolean }; error?: { message?: string } };
  if (!res.ok || !json.data) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json.data;
}

// ─── Cashu faucet claim + proof collection ─────────────────────────────────

export interface BaoCashuClaimResult {
  status: 'pending' | 'completed';
  idempotency_key: string;
  claimed_sats?: number;
  new_balance_sats?: number;
  txid?: string;
}

interface BaoCashuClaimStatusEnvelope {
  data?: {
    status?: unknown;
    idempotency_key?: unknown;
    claimed_sats?: unknown;
    new_balance_sats?: unknown;
    txid?: unknown;
    result?: {
      claimed_sats?: unknown;
      new_balance_sats?: unknown;
      txid?: unknown;
      error?: unknown;
    } | null;
  };
  error?: { message?: string; code?: string };
  message?: string;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Claim real BAO signet Cashu proofs and a matching custodial demo credit. */
export async function claimBaoCashu(
  signer: BaoApiSigner,
  amountSats: number,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<BaoCashuClaimResult> {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new Error('Claim amount must be a positive whole number of sats');
  }
  const url = `${baoApiBase()}/v1/wallet/claim`;
  const body = JSON.stringify({
    rail: 'cashu',
    amount_sats: amountSats,
    idempotency_key: idempotencyKey,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: await baoNip98Header(signer, url, 'POST', body),
    },
    body,
    signal: AbortSignal.timeout(70_000),
  });
  const json = (await res.json().catch(() => ({}))) as BaoCashuClaimStatusEnvelope;
  if (!res.ok && res.status !== 202) {
    throw new BaoSendError(
      json.error?.message ?? json.message ?? `HTTP ${res.status}`,
      json.error?.code,
      res.status,
    );
  }
  const data = json.data ?? {};
  const result = data.result ?? data;
  const status = res.status === 202 || data.status === 'pending' ? 'pending' : 'completed';
  return {
    status,
    idempotency_key: typeof data.idempotency_key === 'string' ? data.idempotency_key : idempotencyKey,
    claimed_sats: positiveInteger(result.claimed_sats),
    new_balance_sats: positiveInteger(result.new_balance_sats),
    txid: typeof result.txid === 'string' ? result.txid : undefined,
  };
}

/** Poll an asynchronous Cashu faucet claim without relying on a session token. */
export async function checkBaoCashuClaimStatus(
  signer: BaoApiSigner,
  idempotencyKey: string,
): Promise<BaoCashuClaimResult> {
  const url = `${baoApiBase()}/v1/wallet/claim-status/${encodeURIComponent(idempotencyKey)}`;
  const res = await fetch(url, {
    headers: { Authorization: await baoNip98Header(signer, url, 'GET') },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as BaoCashuClaimStatusEnvelope;
  if (!res.ok) {
    throw new BaoSendError(
      json.error?.message ?? json.message ?? `HTTP ${res.status}`,
      json.error?.code,
      res.status,
    );
  }
  const data = json.data ?? {};
  const result = data.result ?? {};
  if (data.status === 'failed') {
    throw new BaoSendError(
      typeof result.error === 'string' ? result.error : 'BAO Cashu claim failed',
      'CLAIM_FAILED',
      409,
    );
  }
  return {
    status: data.status === 'completed' ? 'completed' : 'pending',
    idempotency_key: typeof data.idempotency_key === 'string' ? data.idempotency_key : idempotencyKey,
    claimed_sats: positiveInteger(result.claimed_sats),
    new_balance_sats: positiveInteger(result.new_balance_sats),
    txid: typeof result.txid === 'string' ? result.txid : undefined,
  };
}

/** Fetch real Cashu payout tokens waiting to be imported into the local wallet. */
export async function fetchPendingBaoCashuTokens(signer: BaoApiSigner): Promise<string[]> {
  const url = `${baoApiBase()}/v1/wallet/cashu-pending`;
  const res = await fetch(url, {
    headers: { Authorization: await baoNip98Header(signer, url, 'GET') },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { tokens?: unknown };
    error?: { message?: string; code?: string };
    message?: string;
  };
  if (!res.ok) {
    throw new BaoSendError(
      json.error?.message ?? json.message ?? `HTTP ${res.status}`,
      json.error?.code,
      res.status,
    );
  }
  return Array.isArray(json.data?.tokens)
    ? json.data.tokens.filter((token): token is string => typeof token === 'string' && token.trim().length > 0)
    : [];
}

/** Clear pending payout tokens only after every token is durable locally. */
export async function clearPendingBaoCashuTokens(signer: BaoApiSigner): Promise<void> {
  const url = `${baoApiBase()}/v1/wallet/cashu-collect`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: await baoNip98Header(signer, url, 'POST') },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string };
    message?: string;
  };
  if (!res.ok) {
    throw new BaoSendError(
      json.error?.message ?? json.message ?? `HTTP ${res.status}`,
      json.error?.code,
      res.status,
    );
  }
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
