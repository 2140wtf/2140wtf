/**
 * bao.markets fundraising API client (TEST).
 *
 * Talks to the /v1/fundraisers surface of a bao.markets API instance over
 * HTTP only — no tournament/markets code is imported into this repo. Reads
 * are anonymous; mutations authenticate with NIP-98 (a kind-27235 event
 * signed by the user's Nostr signer, sent as `Authorization: Nostr <b64>`).
 *
 * The API is in TEST mode: contributions are recorded but no real payment is
 * verified or settled. The UI must label the flow accordingly.
 */

export interface BaoFundraiser {
  id: string;
  title: string;
  description: string | null;
  owner_pubkey: string;
  runner_type: 'agent' | 'human' | 'agent_human';
  goal_sats: number;
  raised_sats: number;
  status: 'open' | 'funded' | 'completed' | 'cancelled';
  settlement_rail: string;
  network: string;
  created_at: string;
}

export interface BaoMilestone {
  id: string;
  fundraiser_id: string;
  idx: number;
  title: string;
  description: string | null;
  amount_sats: number;
  status: 'locked' | 'unlocked' | 'released';
  unlocked_at: string | null;
  released_at: string | null;
  payout_reference: string | null;
}

export interface BaoContribution {
  id: number;
  fundraiser_id: string;
  contributor_pubkey: string;
  amount_sats: number;
  rail: string;
  reference: string | null;
  created_at: string;
}

export const BAO_RAILS = ['l1', 'lightning', 'bolt12', 'cashu', 'spark', 'ark', 'liquid', 'nwc', 'fedimint'] as const;
export type BaoRail = (typeof BAO_RAILS)[number];

export const BAO_RAIL_LABELS: Record<BaoRail, string> = {
  l1: 'On-chain (L1)',
  lightning: 'Lightning',
  bolt12: 'BOLT12',
  cashu: 'Cashu',
  spark: 'Spark',
  ark: 'Ark',
  liquid: 'Liquid',
  nwc: 'NWC',
  fedimint: 'Fedimint',
};

/** Base URL of the bao.markets API (no trailing slash). */
export function baoApiBase(): string {
  return (import.meta.env.VITE_BAO_FUNDRAISING_API_URL as string | undefined)?.replace(/\/+$/, '')
    || 'http://localhost:3462';
}

interface SignerLike {
  signEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<{ id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string }>;
}

async function nip98Header(signer: SignerLike, url: string, method: string): Promise<string> {
  const event = await signer.signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', method]],
    content: '',
  });
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

async function apiFetch<T>(path: string, opts?: { method?: string; body?: unknown; signer?: SignerLike }): Promise<T> {
  const url = `${baoApiBase()}${path}`;
  const method = opts?.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (opts?.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts?.signer) headers['Authorization'] = await nip98Header(opts.signer, url, method);

  const res = await fetch(url, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

interface ListEnvelope<T> {
  data: T;
  pagination?: { limit: number; offset: number; total: number; has_more: boolean };
}

export async function fetchFundraisers(status?: string): Promise<BaoFundraiser[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await apiFetch<ListEnvelope<BaoFundraiser[]>>(`/v1/fundraisers${q}`);
  return res.data;
}

export async function fetchFundraiser(id: string): Promise<{ fundraiser: BaoFundraiser; milestones: BaoMilestone[] }> {
  const res = await apiFetch<{ data: { fundraiser: BaoFundraiser; milestones: BaoMilestone[] } }>(`/v1/fundraisers/${encodeURIComponent(id)}`);
  return res.data;
}

export async function fetchContributions(id: string): Promise<BaoContribution[]> {
  const res = await apiFetch<{ data: BaoContribution[] }>(`/v1/fundraisers/${encodeURIComponent(id)}/contributions`);
  return res.data;
}

export interface CreateFundraiserInput {
  title: string;
  description?: string;
  runner_type: 'agent' | 'human' | 'agent_human';
  goal_sats: number;
  settlement_rail: BaoRail;
  milestones: { title: string; description?: string; amount_sats: number }[];
}

export async function createFundraiser(
  signer: SignerLike,
  input: CreateFundraiserInput,
): Promise<{ fundraiser: BaoFundraiser; milestones: BaoMilestone[] }> {
  const res = await apiFetch<{ data: { fundraiser: BaoFundraiser; milestones: BaoMilestone[] } }>('/v1/fundraisers', {
    method: 'POST',
    body: input,
    signer,
  });
  return res.data;
}

export interface ContributeResult {
  test: boolean;
  payment_instructions: { kind: string } & Record<string, unknown>;
  fundraiser: BaoFundraiser;
  milestones: BaoMilestone[];
  replayed?: boolean;
}

export async function contributeToFundraiser(
  signer: SignerLike,
  id: string,
  input: { amount_sats: number; rail: BaoRail; reference?: string },
): Promise<ContributeResult> {
  const res = await apiFetch<{ data: ContributeResult }>(`/v1/fundraisers/${encodeURIComponent(id)}/contribute`, {
    method: 'POST',
    body: {
      ...input,
      idempotency_key: `2140:${id}:${input.rail}:${input.amount_sats}:${Date.now()}`,
    },
    signer,
  });
  return res.data;
}

export async function releaseMilestone(
  signer: SignerLike,
  fundraiserId: string,
  milestoneId: string,
): Promise<{ milestone: BaoMilestone; fundraiser: BaoFundraiser }> {
  const res = await apiFetch<{ data: { milestone: BaoMilestone; fundraiser: BaoFundraiser } }>(
    `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/milestones/${encodeURIComponent(milestoneId)}/release`,
    { method: 'POST', body: {}, signer },
  );
  return res.data;
}
