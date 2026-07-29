/**
 * bao.markets fundraising API client (DEMO).
 *
 * Talks to the /v1/fundraisers surface of a bao.markets API instance over
 * HTTP only — no tournament/markets code is imported into this repo. Reads
 * are anonymous; mutations authenticate with NIP-98 (a kind-27235 event
 * signed by the user's Nostr signer, sent as `Authorization: Nostr <b64>`).
 *
 * The API is in DEMO mode (signet): contributions are recorded but no real
 * payment is verified or settled. The UI must label the flow accordingly.
 */

export type BaoFundraiserFormat = 'milestones' | 'stream';

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
  /** v2: payout format. Missing on legacy rows → treat as 'milestones'. */
  format?: BaoFundraiserFormat;
  category?: string | null;
  /** v2 stream fields (unix seconds) */
  stream_start_at?: number | string | null;
  stream_end_at?: number | string | null;
  claimed_sats?: number;
  /** v2 computed stream fields returned by GET /:id */
  stream_vested_sats?: number;
  stream_claimable_sats?: number;
  /**
   * Set when the campaign was created relay-first: the id of the ingested
   * kind-38003 intent event. Clients poll the list endpoint for their intent
   * id to learn the campaign id.
   */
  nostr_event_id?: string | null;
}

export type BaoMilestoneStatus = 'locked' | 'unlocked' | 'released' | 'refunded';

export interface BaoMilestone {
  id: string;
  fundraiser_id: string;
  idx: number;
  title: string;
  description: string | null;
  amount_sats: number;
  status: BaoMilestoneStatus;
  unlocked_at: string | null;
  released_at: string | null;
  payout_reference: string | null;
  /** v2: every milestone IS a prediction market on bao.markets. */
  market_id?: string | null;
  question?: string | null;
  criteria?: string | null;
  deadline_at?: number | string | null;
  /** Runner fee in basis points (100 = 1.0%, 214 = 2.14%, 421 = 4.21%). */
  fee_bps?: number;
  /** Outcome of the linked market once resolved. */
  market_resolution?: 'yes' | 'no' | null;
  proof_event_id?: string | null;
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

/**
 * Rails that work end-to-end on bao.markets today: they have live settlement
 * methods on the market coordinator (lightning / cashu / taproot≈L1) AND a
 * working demo faucet claim. The DEMO fundraiser ledger *accepts* all nine
 * rails (contributions are recorded, not settled), but the rest have no live
 * settlement adapter yet — the UI offers them disabled as "soon" so nobody
 * picks a rail that can't actually pay out.
 */
export const BAO_LIVE_RAILS: readonly BaoRail[] = ['lightning', 'cashu', 'l1'];

export function isBaoRailLive(rail: BaoRail): boolean {
  return BAO_LIVE_RAILS.includes(rail);
}

/** Where users claim free demo sats (₿AO Demo Network faucet, 21,400 sats per rail per 24h). */
export const BAO_MARKETS_URL = 'https://bao.markets';

/** Base URL of the bao.markets API (no trailing slash). */
export function baoApiBase(): string {
  const fromEnv = (import.meta.env.VITE_BAO_FUNDRAISING_API_URL as string | undefined)?.replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  // No local API: dev and deployed builds alike talk to the public bao.markets
  // API. The env var remains as an explicit override.
  return 'https://relay.bao.network/bao-api';
}


/**
 * Parse an API date field. TIMESTAMPTZ columns arrive as ISO strings over
 * JSON, while older records/callers used unix seconds — accept both.
 * Returns null for missing/unparseable values (never an Invalid Date).
 */
export function baoApiDate(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return new Date(value * 1000);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
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

export interface CreateMilestoneInput {
  title: string;
  description?: string;
  amount_sats: number;
  /** Delivery criteria — becomes the prediction-market question. */
  criteria?: string;
  /** Unix seconds. */
  deadline_at?: number;
  fee_bps?: number;
}

export interface CreateFundraiserInput {
  title: string;
  description?: string;
  runner_type: 'agent' | 'human' | 'agent_human';
  goal_sats: number;
  settlement_rail: BaoRail;
  format?: BaoFundraiserFormat;
  category?: string;
  milestones?: CreateMilestoneInput[];
  /** Stream format: vesting window in unix seconds (required iff format='stream'). */
  stream_start_at?: number;
  stream_end_at?: number;
}

export interface CreateFundraiserResult {
  fundraiser: BaoFundraiser;
  milestones: BaoMilestone[];
  /** One prediction market per milestone (milestones format only). */
  markets?: { milestone_id: string; market_id: string }[];
}

export async function createFundraiser(
  signer: SignerLike,
  input: CreateFundraiserInput,
): Promise<CreateFundraiserResult> {
  const res = await apiFetch<{ data: CreateFundraiserResult }>('/v1/fundraisers', {
    method: 'POST',
    body: input,
    signer,
  });
  return res.data;
}

/** Kind of the ₿AO Fund campaign-creation intent the bao.markets bridge ingests. */
export const BAO_FUNDRAISER_CREATE_KIND = 38003;

/** Relay the bao.markets bridge subscribes to for creation intents. */
export function baoRelayUrl(): string {
  return (import.meta.env.VITE_BAO_RELAY_URL as string | undefined) ?? 'wss://relay.bao.network';
}

/**
 * Network tag the bridge filters intents on. The public bao.markets
 * deployment is the signet demo; override only when pointing at a local API.
 */
function baoNetwork(): string {
  return (import.meta.env.VITE_BAO_NETWORK as string | undefined) ?? 'demo';
}

export interface RelayCreateOptions {
  /**
   * Publish a signed event (e.g. `useNostrPublish().mutateAsync`). Must accept
   * the `relay` override so the intent lands on the ₿AO relay the bridge
   * subscribes to, regardless of the user's relay set.
   */
  publish: (t: { kind: number; content: string; tags: string[][]; relay?: string }) => Promise<{ id: string }>;
  /** How long to poll the list API for the ingested campaign (default 30s). */
  timeoutMs?: number;
  /** Poll interval (default 2s). */
  intervalMs?: number;
}

/**
 * Relay-first campaign creation. Publishes the SAME body the REST route
 * accepts as a signed kind-38003 intent to the ₿AO relay; the bao.markets
 * bridge verifies the signature (the same proof of key control as the REST
 * route's NIP-98 auth), quota-checks the author, and runs the identical
 * creation core. The campaign then appears in the list API carrying
 * `nostr_event_id` = the intent's id, which we poll for.
 *
 * Falls back to the REST POST when the relay publish fails or the campaign
 * doesn't surface within the timeout (bridge down, quota hit, relay policy
 * change) — creation keeps working even with the bridge offline.
 *
 * The `d` tag is a random UUID per intent: kind 38003 is addressable, and a
 * stable `d` would let a second intent REPLACE an un-ingested first one on
 * the relay before the bridge's backfill scan ever sees it.
 */
export async function createFundraiserRelayFirst(
  signer: SignerLike,
  input: CreateFundraiserInput,
  opts: RelayCreateOptions,
): Promise<{ result: CreateFundraiserResult; via: 'relay' | 'rest' }> {
  try {
    const intent = await opts.publish({
      kind: BAO_FUNDRAISER_CREATE_KIND,
      content: JSON.stringify(input),
      tags: [['d', `frc-${crypto.randomUUID()}`], ['n', baoNetwork()], ['alt', '₿AO Fund campaign create intent']],
      relay: baoRelayUrl(),
    });
    const found = await pollForRelayCreatedFundraiser(intent.id, opts);
    if (found) return { result: found, via: 'relay' };
  } catch {
    // Relay path unavailable — fall through to the REST route.
  }
  return { result: await createFundraiser(signer, input), via: 'rest' };
}

/** Poll the list API until the bridge-ingested campaign (by intent id) appears. */
async function pollForRelayCreatedFundraiser(
  intentEventId: string,
  opts: RelayCreateOptions,
): Promise<CreateFundraiserResult | null> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  const interval = opts.intervalMs ?? 2_000;
  while (Date.now() < deadline) {
    const list = await fetchFundraisers().catch(() => null);
    const hit = list?.find((f) => f.nostr_event_id === intentEventId);
    if (hit) {
      const detail = await fetchFundraiser(hit.id);
      return {
        fundraiser: detail.fundraiser,
        milestones: detail.milestones,
        markets: detail.milestones
          .filter((m) => m.market_id)
          .map((m) => ({ milestone_id: m.id, market_id: m.market_id! })),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return null;
}

export interface ContributeResult {
  /** DEMO mode marker (replaces the old `test` flag). */
  demo?: boolean;
  /** Legacy flag returned by older API versions. */
  test?: boolean;
  payment_instructions: { kind: string } & Record<string, unknown>;
  fundraiser: BaoFundraiser;
  milestones: BaoMilestone[];
  replayed?: boolean;
}

export async function contributeToFundraiser(
  signer: SignerLike,
  id: string,
  input: { amount_sats: number; rail: BaoRail; reference?: string; idempotencyKey?: string },
): Promise<ContributeResult> {
  const res = await apiFetch<{ data: ContributeResult }>(`/v1/fundraisers/${encodeURIComponent(id)}/contribute`, {
    method: 'POST',
    body: {
      amount_sats: input.amount_sats,
      rail: input.rail,
      reference: input.reference,
      // The caller should pass a STABLE key per checkout intent so a retry
      // after a network timeout dedupes server-side (the API returns
      // `replayed: true` for repeats). A per-call Date.now() key — the old
      // behaviour — made every retry a brand-new contribution.
      idempotency_key: input.idempotencyKey ?? `2140:${id}:${input.rail}:${input.amount_sats}:${crypto.randomUUID()}`,
    },
    signer,
  });
  return res.data;
}

export async function releaseMilestone(
  signer: SignerLike,
  fundraiserId: string,
  milestoneId: string,
  opts?: { payout_reference?: string; proof_event_id?: string },
): Promise<{ milestone: BaoMilestone; fundraiser: BaoFundraiser }> {
  const res = await apiFetch<{ data: { milestone: BaoMilestone; fundraiser: BaoFundraiser } }>(
    `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/milestones/${encodeURIComponent(milestoneId)}/release`,
    { method: 'POST', body: opts ?? {}, signer },
  );
  return res.data;
}

export interface ClaimStreamResult {
  demo?: boolean;
  claimable_sats: number;
  fundraiser: BaoFundraiser;
}

/** Claim vested sats from a stream-format fundraiser (owner only, DEMO recorded-only). */
export async function claimStream(
  signer: SignerLike,
  fundraiserId: string,
): Promise<ClaimStreamResult> {
  const res = await apiFetch<{ data: ClaimStreamResult }>(
    `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/claim`,
    { method: 'POST', body: {}, signer },
  );
  return res.data;
}
