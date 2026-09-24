import type { MilestoneEvidenceV1 } from './baoWorkContract';
import { fundApiOrigin, fundFetch } from './fundHttp';
/**
 * BAO Fund fundraising API client.
 *
 * Talks to the /v1/fundraisers surface of the dedicated Fund API over
 * HTTP only - no tournament/markets code is imported into this repo. Reads
 * are anonymous; mutations authenticate with NIP-98 (a kind-27235 event
 * signed by the user's Nostr signer, sent as `X-Nostr-Auth: <b64>` so the access gate keeps `Authorization`).
 * URL resolution, auth headers, envelope errors, timeouts, and the read
 * project-isolation policy live in fundHttp.
 *
 * Rails: testnet campaigns fund through the on-chain escrow on Bitcoin
 * testnet4 (`l1`) or Liquid testnet (`liquid`); real-money campaigns use
 * mainnet Cashu (`cashu`).
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
  /** Settlement network ('testnet' | 'mainnet') - first-class API field.
   *  Older campaigns may instead carry the [rail:mainnet-cashu] description
   *  marker (fallback detection). */
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
  /** Campaign discussion room link - withheld from non-contributors on
   *  donor-gated campaigns (never rely on it for discovery). */
  chat_room_link?: string | null;
  /** Viewer-relative room availability (false = hide the Chat affordance). */
  chat_room_available?: boolean;
  /** Viewer has contributed to this campaign (donor-only surfaces). */
  is_contributor?: boolean;
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
  /** Escrowed sats applied to this milestone (waterfall slice); present on
   *  detail responses, absent on older payloads. */
  escrow_amount_sats?: number | null;
}

export interface BaoContribution {
  id: number;
  fundraiser_id: string;
  contributor_pubkey: string;
  amount_sats: number;
  rail: string;
  reference: string | null;
  created_at: string;
  /** Lifecycle: 'escrowed' (cashu locked) | 'pending' (awaiting payment or
   * explorer confirmation) | 'confirmed' (on-chain deposit verified). */
  status?: string;
  /** Per-contribution on-chain escrow address (testnet rails l1/liquid). */
  deposit_address?: string | null;
  /** Server-computed block-explorer link for the payment tx. */
  explorer_tx_url?: string;
}

export const BAO_RAILS = ['l1', 'lightning', 'bolt12', 'cashu', 'spark', 'ark', 'liquid', 'nwc', 'fedimint', 'btc-testnet4', 'liquid-testnet'] as const;
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
  'btc-testnet4': 'Bitcoin testnet4',
  'liquid-testnet': 'Liquid testnet',
};

/** Display label for any settlement-rail id a card or API record can carry. */
export function railLabel(rail?: string): string {
  if (!rail) return '';
  if (rail === 'l1' || rail === 'btc-testnet4') return 'Bitcoin testnet4';
  if (rail === 'liquid' || rail === 'liquid-testnet') return 'Liquid testnet';
  return BAO_RAIL_LABELS[rail as BaoRail] ?? rail;
}

/**
 * Rails the pledge UI may offer: testnet campaigns settle through the
 * on-chain taproot escrow (Bitcoin testnet4 `l1`, Liquid testnet `liquid`);
 * real-money campaigns settle through mainnet Cashu tokens
 * (donor-locked, released by the verified milestone gate). Every other rail
 * is fail-closed at the contribution gate.
 */
export const BAO_LIVE_RAILS: readonly BaoRail[] = ['l1', 'liquid', 'cashu'];

export function isBaoRailLive(rail: BaoRail): boolean {
  return BAO_LIVE_RAILS.includes(rail);
}

/**
 * Web UI base for bao.markets ("View on bao.markets" links). Returns null
 * when the active API is a local development instance - those campaigns and
 * markets exist only in the local database, so a production bao.markets link
 * would 404. Override with VITE_BAO_MARKETS_WEB_URL when running a local web UI.
 */
export function baoMarketsWebBase(): string | null {
  const fromEnv = (import.meta.env.VITE_BAO_MARKETS_WEB_URL as string | undefined)?.replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  const api = fundApiOrigin();
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(api)) return null;
  return 'https://bao.markets';
}


/**
 * Parse an API date field. TIMESTAMPTZ columns arrive as ISO strings over
 * JSON, while older records/callers used unix seconds - accept both.
 * Returns null for missing/unparseable values (never an Invalid Date).
 */
export function baoApiDate(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return new Date(value * 1000);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

export interface SignerLike {
  signEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<{ id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string }>;
  /** Raw 32-byte hash schnorr signing (on-chain releases); optional. */
  signSchnorr?(hashHex: string): Promise<string>;
}

interface ListEnvelope<T> {
  data: T;
  pagination?: { limit: number; offset: number; total: number; has_more: boolean };
}

export async function fetchFundraisers(status?: string, signer?: SignerLike): Promise<BaoFundraiser[]> {
  // Follow the pagination envelope: the default page is small, and silently
  // reading only page 1 hides campaigns once the list outgrows it - including
  // the one just created (the relay-first create poll matches on this list).
  const out: BaoFundraiser[] = [];
  let offset = 0;
  const limit = 100;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set('status', status);
    const res = await fundFetch<ListEnvelope<BaoFundraiser[]>>(`/v1/fundraisers?${params}`, signer ? { signer } : {});
    out.push(...res.data);
    if (!res.pagination?.has_more || res.data.length === 0) break;
    offset += res.data.length;
  }
  return out;
}

export async function fetchFundraiser(id: string, signer?: SignerLike): Promise<{ fundraiser: BaoFundraiser; milestones: BaoMilestone[] }> {
  const res = await fundFetch<{ data: { fundraiser: BaoFundraiser; milestones: BaoMilestone[] } }>(
    `/v1/fundraisers/${encodeURIComponent(id)}`,
    signer ? { signer } : {},
  );
  return res.data;
}

/**
 * Every contribution for a campaign. The route defaults to 50 rows and does
 * not return pagination metadata, so callers that computed totals or looked
 * for a donor's escrowed row silently missed older records. Page until a
 * short page arrives (bounded).
 */
export async function fetchContributions(id: string): Promise<BaoContribution[]> {
  const all: BaoContribution[] = [];
  const limit = 100;
  const seen = new Set<string>();
  for (let offset = 0; offset < 2000; offset += limit) {
    const res = await fundFetch<{ data: BaoContribution[] }>(
      `/v1/fundraisers/${encodeURIComponent(id)}/contributions?limit=${limit}&offset=${offset}`,
    );
    const page = Array.isArray(res.data) ? res.data : [];
    // Defensive: an API ignoring `offset` must not loop forever.
    let added = 0;
    for (const row of page) {
      const key = `${row?.id ?? ''}:${row?.created_at ?? ''}:${row?.contributor_pubkey ?? ''}:${row?.amount_sats ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(row);
      added += 1;
    }
    if (page.length < limit || added === 0) break;
  }
  return all;
}

export interface CreateMilestoneInput {
  title: string;
  description?: string;
  amount_sats: number;
  /** Delivery criteria - becomes the prediction-market question. */
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
  /** 'testnet' (default) | 'mainnet' - first-class settlement network. */
  network?: string;
  format?: BaoFundraiserFormat;
  category?: string;
  milestones?: CreateMilestoneInput[];
  /** BAO Community: optional encrypted discussion room for the campaign
   *  (provisioned by the operator API - rule 8; the fund never touches
   *  chat correctness). */
  discussion_room?: { enabled: boolean; gate?: 'open' | 'invite' | 'follows' | 'donors' };
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
  const res = await fundFetch<{ data: CreateFundraiserResult }>('/v1/fundraisers', {
    method: 'POST',
    body: input,
    signer,
  });
  return res.data;
}

/** Historical shared-bridge intent kind; no creation publisher remains here. */
export const BAO_FUNDRAISER_CREATE_KIND = 38003;  /**
   * The fund's OWN relay - one relay per app (markets and 2140.social each have
   * their dedicated strfry; the fund's is bao-chat-strfry-fund on the VPS,
   * fronted at wss://relay.bao.fund - the fund's OWN domain, owner decision
   * 2026-09-09). Join links, pledge events, and fund chat all live here -
   * never on the markets relay. Override with VITE_BAO_RELAY_URL for local dev.
   */
  export function baoRelayUrl(): string {
    return (import.meta.env.VITE_BAO_RELAY_URL as string | undefined) ?? 'wss://relay.bao.fund';
  }

/** Campaign creation uses createFundraiser through the dedicated Fund API.
 * The old relay-first helper was removed: a shared bridge could ingest its
 * intent, and timeout fallback could create a second campaign. No kind-38003
 * creation publisher is exposed by this module. */

export interface ContributionSplitOutput {
  milestone_id: string;
  address: string;
  amount_sats: number;
  witness_script?: string;
  explorer_url?: string;
}

export interface ContributionPaymentInstructions {
  kind: string;
  address?: string;
  amount_sats?: number;
  explorer_url?: string;
  witness_script?: string;
  token?: string;
  invoice?: string;
  memo?: string;
  /** Split pledge (one tx, one output per milestone): present when kind === 'addresses'. */
  intent_id?: string;
  total_sats?: number;
  outputs?: ContributionSplitOutput[];
}

export interface ContributeResult {
  /** Legacy flag returned by older API versions. */
  test?: boolean;
  payment_instructions: ContributionPaymentInstructions;
  /** Present on the single-contribution paths; split-pledge responses return
   *  only the group + outputs. */
  fundraiser?: BaoFundraiser;
  milestones?: BaoMilestone[];
  replayed?: boolean;
  /** Split pledge group id (also mirrored in payment_instructions.intent_id). */
  split_group?: string;
  /** Explorer link for the committed tx of a split group. */
  tx_explorer_url?: string;
}

export interface ContributeInput {
  amount_sats: number;
  rail: BaoRail;
  reference?: string;
  idempotencyKey?: string;
  preferredModel?: string;
  /** Donor-supplied escrow deposit: on the mainnet Cashu rail the donor
   * pastes a token from their own wallet; it is locked in the 2-of-3 escrow
   * and only released when the milestone verification gate passes. */
  cashuToken?: string;
  /** On-chain rails: split this pledge across the milestones as ONE tx with
   *  one milestone-bound escrow output each (requires idempotencyKey). */
  split?: boolean;
  /** Commit the donor txid for a split pledge group (every pending output). */
  splitGroup?: string;
}

export async function contributeToFundraiser(
  signer: SignerLike,
  id: string,
  input: ContributeInput,
): Promise<ContributeResult> {
  const res = await fundFetch<{ data: ContributeResult }>(`/v1/fundraisers/${encodeURIComponent(id)}/contribute`, {
    method: 'POST',
    body: {
      amount_sats: input.amount_sats,
      rail: input.rail,
      ...(input.cashuToken ? { cashu_token: input.cashuToken } : {}),
      // Donor's AI judge-model vote (sats-weighted; counts for donations ≥ 1,000 sats).
      ...(input.preferredModel ? { preferred_model: input.preferredModel } : {}),
      reference: input.reference,
      ...(input.split ? { split: true } : {}),
      ...(input.splitGroup ? { split_group: input.splitGroup } : {}),
      // The caller should pass a STABLE key per checkout intent so a retry
      // after a network timeout dedupes server-side (the API returns
      // `replayed: true` for repeats). A per-call Date.now() key - the old
      // behaviour - made every retry a brand-new contribution.
      idempotency_key: input.idempotencyKey ?? `2140:${id}:${input.rail}:${input.amount_sats}:${crypto.randomUUID()}`,
    },
    signer,
  });
  return res.data;
}

/**
 * Map a contribution API error (code + server message) to a user-facing hint.
 * Returns null when the error isn't one of the known contribution gates, so
 * callers fall back to the raw message.
 */
/**
 * On-chain milestone release (owner-only). Phase 1 (no signatures): the API
 * returns per-input sighashes + oracle co-signatures; phase 2 (with the
 * owner's schnorr signatures over those sighashes): the assembled raw tx.
 * The API never broadcasts.
 */
export interface OnchainReleaseInput {
  txid: string;
  vout: number;
  value_sats: number;
  address: string;
  sighash: string;
  oracle_signature: string;
  judge_leaf: string;
  control_block: string;
}

export interface OnchainReleasePlan {
  rail: 'l1' | 'liquid';
  payout_address: string;
  total_in_sats: number;
  payout_sats: number;
  fee_sats: number;
  inputs: OnchainReleaseInput[];
  instructions?: string;
}

export interface OnchainReleaseTx {
  rail: 'l1' | 'liquid';
  txid: string;
  raw_tx: string;
  payout_address: string;
  payout_sats: number;
  fee_sats: number;
  explorer_tx_url?: string;
}

/**
 * Typed failure for a 2xx on-chain release body that does not match the
 * phase-1 plan or phase-2 tx shape. The caller must treat the release as NOT
 * prepared/assembled - a `{}` body previously reached the section render and
 * crashed on `plan.inputs.length`.
 */
export class MalformedOnchainReleaseError extends Error {
  readonly code = 'ONCHAIN_RELEASE_MALFORMED';
  constructor(message: string) {
    super(message);
    this.name = 'MalformedOnchainReleaseError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/i;
const HEX128 = /^[0-9a-f]{128}$/i;
const HEX_BYTES = /^(?:[0-9a-f]{2})+$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSats(value: unknown, positive = false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0);
}

function isRail(value: unknown): value is 'l1' | 'liquid' {
  return value === 'l1' || value === 'liquid';
}

function assertOnchainReleasePlan(data: unknown): asserts data is OnchainReleasePlan {
  if (
    !isRecord(data) || !isRail(data.rail) ||
    typeof data.payout_address !== 'string' || data.payout_address.length === 0 ||
    !isSats(data.total_in_sats, true) || !isSats(data.payout_sats) || !isSats(data.fee_sats) ||
    !Array.isArray(data.inputs) || data.inputs.length === 0
  ) {
    throw new MalformedOnchainReleaseError('The Fund API returned a malformed on-chain release plan - no transaction was prepared.');
  }
  for (const input of data.inputs) {
    if (
      !isRecord(input) ||
      typeof input.txid !== 'string' || !HEX64.test(input.txid) ||
      !isSats(input.vout) || !isSats(input.value_sats, true) ||
      typeof input.address !== 'string' || input.address.length === 0 ||
      typeof input.sighash !== 'string' || !HEX64.test(input.sighash) ||
      typeof input.oracle_signature !== 'string' || !HEX128.test(input.oracle_signature) ||
      typeof input.judge_leaf !== 'string' || input.judge_leaf.length === 0 ||
      typeof input.control_block !== 'string' || input.control_block.length === 0
    ) {
      throw new MalformedOnchainReleaseError('The Fund API returned a malformed on-chain release plan input - no transaction was prepared.');
    }
  }
}

function assertOnchainReleaseTx(data: unknown): asserts data is OnchainReleaseTx {
  if (
    !isRecord(data) || !isRail(data.rail) ||
    typeof data.txid !== 'string' || !HEX64.test(data.txid) ||
    typeof data.raw_tx !== 'string' || !HEX_BYTES.test(data.raw_tx) ||
    typeof data.payout_address !== 'string' || data.payout_address.length === 0 ||
    !isSats(data.payout_sats) || !isSats(data.fee_sats)
  ) {
    throw new MalformedOnchainReleaseError('The Fund API returned a malformed on-chain release transaction - the release was NOT assembled.');
  }
}

export async function releaseOnchainMilestone(
  signer: SignerLike,
  fundraiserId: string,
  milestoneId: string,
  projectSignatures?: string[],
): Promise<OnchainReleasePlan | OnchainReleaseTx> {
  // The request phase decides which shape must come back: no signatures means
  // the API prepares a plan; with signatures it assembles the raw tx. A body
  // from the wrong phase (or a partial one) is rejected, never cast through.
  const finalizing = Array.isArray(projectSignatures) && projectSignatures.length > 0;
  const res = await fundFetch<{ data: OnchainReleasePlan | OnchainReleaseTx }>(
    `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/milestones/${encodeURIComponent(milestoneId)}/release/onchain`,
    {
      method: 'POST',
      body: finalizing ? { project_signatures: projectSignatures } : {},
      signer,
    },
  );
  const data = res?.data;
  if (finalizing) {
    assertOnchainReleaseTx(data);
    return data;
  }
  assertOnchainReleasePlan(data);
  return data;
}

export function contributionErrorHint(err: unknown): string | null {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'FUNDRAISER_EXTERNAL_FUNDING_REQUIRED':
      return 'This rail is disabled until external funding is verified on the API side - testnet pledges cannot be recorded while the escrow gate is up.';
    case 'ESCROW_NOT_CONFIGURED':
      return 'The API\'s cashu escrow oracle is not configured - pledges are blocked server-side (ESCROW_NOT_CONFIGURED).';
    case 'ESCROW_KEYS_NOT_DISTINCT':
      return 'This campaign\'s escrow needs three different keys (project, donor, oracle) - you cannot pledge to your own campaign with the same identity that owns it.';
    case 'ESCROW_TOKEN_INVALID':
      return 'The faucet token was rejected by the API\'s escrow validation - it does not match this contribution (amount, mint, or lock structure).';
    case 'ESCROW_PROOFS_SPENT':
      return 'Those token proofs were already spent at the mint - claim a fresh faucet token and try again.';
    case 'MINT_STATE_CHECK_FAILED':
      return 'The mint could not confirm the token is unspent - please try again shortly.';
    default:
      return null;
  }
}

export async function releaseMilestone(
  signer: SignerLike,
  fundraiserId: string,
  milestoneId: string,
  opts?: { payout_reference?: string; proof_event_id?: string },
): Promise<{ milestone: BaoMilestone; fundraiser: BaoFundraiser }> {
  const res = await fundFetch<{ data: { milestone: BaoMilestone; fundraiser: BaoFundraiser } }>(
    `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/milestones/${encodeURIComponent(milestoneId)}/release`,
    { method: 'POST', body: opts ?? {}, signer },
  );
  // A release is money-adjacent: an empty/malformed 200 must never be
  // reported as a completed release (the caller otherwise shows
  // "Attested & released" for a response that proves nothing). Two valid
  // shapes: a recorded release (`milestone` with a status) or the cashu
  // escrow path (`escrow_release` swap awaiting the project signature).
  const data = res?.data as Record<string, unknown> | undefined;
  const milestone = data?.milestone as { status?: unknown } | undefined;
  const milestoneOk = Boolean(milestone) && typeof milestone === 'object' && typeof milestone.status === 'string';
  const escrowRelease = data?.escrow_release;
  const escrowOk = Boolean(escrowRelease) && typeof escrowRelease === 'object';
  if (!data || typeof data !== 'object' || (!milestoneOk && !escrowOk)) {
    throw new Error('The Fund API returned a malformed release response - the milestone was NOT confirmed released.');
  }
  return data as unknown as { milestone: BaoMilestone; fundraiser: BaoFundraiser };
}

export interface ClaimStreamResult {
  claimable_sats: number;
  fundraiser: BaoFundraiser;
}

/** Claim vested sats from a stream-format fundraiser (owner only). */
export async function claimStream(
  signer: SignerLike,
  fundraiserId: string,
): Promise<ClaimStreamResult> {
  const res = await fundFetch<{ data: ClaimStreamResult }>(
    `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/claim`,
    { method: 'POST', body: {}, signer },
  );
  return res.data;
}

export type BaoVerificationVerdict = 'pass' | 'review' | 'fail';

/** One recorded AI scoring attempt for a milestone. */
export interface BaoMilestoneVerification {
  id: number;
  milestone_id: string;
  fundraiser_id: string;
  attempt: number;
  model: string;
  score: number;
  verdict: BaoVerificationVerdict;
  fee_msats: number;
  inference_msats: number;
  operator_msats: number;
  input_tokens: number;
  output_tokens: number;
  cost_msats: number;
  evidence_hash: string;
  rules_hash: string;
  receipt_hash: string | null;
  nostr_event_id: string | null;
  job_id: number | null;
  created_at: string;
}

export interface ScoreMilestoneResult {
  job_id: number;
  estimated_fee_msats: number;
  /** Effective judge model the job will be scored with (donor-vote snapshot or default). */
  model: string;
}

/**
 * Delivery evidence submitted to the AI scorer. Prefer the typed
 * `MilestoneEvidenceV1` (bound to the work contract: delivered_commit, archive
 * url+sha256, workflow_hash, artifact_event_ids) so the scorer's tools verify
 * real fields; a plain string is accepted for backward compatibility and stays
 * advisory-only.
 */
export type ScoreMilestoneEvidence = MilestoneEvidenceV1 | string;

/**
 * Input to a milestone AI-scoring job (advisory L0.5 signal, see
 * docs/BAO_FUND_RESOLUTION.md §2). The worker runs the judge, may call
 * verification tools, and publishes a signed kind-38060 event.
 */
export interface ScoreMilestoneInput {
  /** Typed delivery evidence (preferred) or a free-text evidence note. */
  evidence: ScoreMilestoneEvidence;
  /** Max judge fee to reserve for the job, in msats. Capped server-side by the milestone's max_verification_fee_msats. */
  toolBudgetMsats?: number;
  /** Cap on verification-tool calls per scoring run (runaway/cost guard). */
  maxToolCalls?: number;
}

/** Progress frame streamed from a running score job (SSE). */
export type ScoreJobEventType = 'accepted' | 'tool_call' | 'token' | 'verdict' | 'done' | 'error';

/** One verification-tool invocation the judge made (schema-driven, validated). */
export interface ScoreToolCallEvent {
  /** Tool name, e.g. `github:compare`, `fetch-hash`, `ci-status`, `nostr-fetch`. */
  tool: string;
  /** Validated, contract-bound argument (commit sha / archive url / workflow hash). */
  argument: string;
  /** Opaque reference to the deterministic result (for the kind-38060 `tool` tag). */
  resultRef?: string;
  /** SHA-256 of the deterministic result, so a client can re-check independently. */
  resultHash?: string;
}

export interface ScoreJobEvent {
  type: ScoreJobEventType;
  /** Present when `type === 'tool_call'`. */
  tool?: ScoreToolCallEvent;
  /** Present when `type === 'verdict'` - advisory outcome of this attempt. */
  verdict?: BaoVerificationVerdict;
  /** Present when `type === 'verdict'` - 0..100 advisory confidence/score. */
  score?: number;
  /** Judge model id the job is running with. */
  model?: string;
  /** Reasoning token delta when `type === 'token'`. */
  delta?: string;
  /** Mirror of the score result's job id (present on every frame). */
  job_id: number;
}

/**
 * Submit milestone evidence and enqueue AI scoring (owner/admin). The API
 * returns 202 + job id; the worker publishes a public, signed kind-38060
 * score event and the fee is deducted from the milestone payout.
 *
 * Accepts either a `ScoreMilestoneInput` object (typed evidence + tool/cost
 * guardrails) or a legacy free-text string, which is treated as
 * `{ evidence: <string> }`.
 */
export async function scoreMilestone(
  signer: SignerLike,
  fundraiserId: string,
  milestoneId: string,
  input: ScoreMilestoneInput | string,
): Promise<ScoreMilestoneResult> {
  const body: { evidence: string; tool_budget_msats?: number; max_tool_calls?: number } =
    typeof input === 'string'
      ? { evidence: input }
      : {
          // The API schema requires `evidence` as a string: MilestoneEvidenceV1
        // objects are serialized (the judge parses them back).
        evidence: typeof input.evidence === 'string' ? input.evidence : JSON.stringify(input.evidence),
          ...(input.toolBudgetMsats !== undefined ? { tool_budget_msats: input.toolBudgetMsats } : {}),
          ...(input.maxToolCalls !== undefined ? { max_tool_calls: input.maxToolCalls } : {}),
        };
  const MAX_EVIDENCE_CHARS = 64_000;
  if (body.evidence.trim().length === 0) throw new Error('Evidence is empty - describe what was delivered.');
  if (body.evidence.length > MAX_EVIDENCE_CHARS) {
    throw new Error(
      `Evidence is ${body.evidence.length.toLocaleString()} chars - cap is ${MAX_EVIDENCE_CHARS.toLocaleString()}. Link an artifact (url + sha256) instead of pasting raw content.`,
    );
  }
  const res = await fundFetch<{ data: ScoreMilestoneResult }>(
    `/v1/fundraisers/${encodeURIComponent(fundraiserId)}/milestones/${encodeURIComponent(milestoneId)}/score`,
    { method: 'POST', body, signer },
  );
  return res.data;
}

/**
 * Live-tail an AI scoring job's progress over SSE and collect every frame.
 * Emitted frames: tool-call invocations (with deterministic result hashes),
 * reasoning token deltas, and the final advisory verdict. The consumer should
 * reconcile the terminal state from the signed kind-38060 event once the
 * stream closes - tool calls and tokens here are advisory transcripts only.
 *
 * Hardening (ported from 2140wtf audit round 3–14): the stream is capped by
 * total bytes, frame bytes, and event count, and every frame is validated
 * against the ScoreJobEvent shape before it is trusted - a hostile or buggy
 * stream can neither exhaust memory nor smuggle malformed events in.
 */
const MAX_SCORE_STREAM_BYTES = 512 * 1024;
const MAX_SCORE_STREAM_EVENTS = 512;
const MAX_SCORE_STREAM_FRAME_BYTES = 32 * 1024;
const MAX_SCORE_STREAM_DELTA_LENGTH = 8 * 1024;

function isScoreJobEvent(value: unknown): value is ScoreJobEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  if (typeof event.type !== 'string' || !['accepted', 'tool_call', 'token', 'verdict', 'done', 'error'].includes(event.type)) return false;
  if (typeof event.job_id !== 'number' || !Number.isSafeInteger(event.job_id)) return false;
  if (event.delta !== undefined && (typeof event.delta !== 'string' || event.delta.length > MAX_SCORE_STREAM_DELTA_LENGTH)) return false;
  return true;
}

export async function fetchScoreJobEvents(
  fundraiserId: string,
  milestoneId: string,
  jobId: number,
  signal?: AbortSignal,
): Promise<ScoreJobEvent[]> {
  const url = `${fundApiOrigin()}/v1/fundraisers/${encodeURIComponent(fundraiserId)}/milestones/${encodeURIComponent(milestoneId)}/score/${encodeURIComponent(String(jobId))}/events`;
  const res = await fetch(url, { signal, redirect: 'error' });
  if (!res.ok || !res.body) throw new Error(`Score stream failed with HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events: ScoreJobEvent[] = [];
  let buffer = '';
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SCORE_STREAM_BYTES) {
        await reader.cancel('score stream too large');
        throw new Error('Score stream exceeded its size limit.');
      }
      buffer += decoder.decode(value, { stream: true });
      // Drain every COMPLETE frame first - a single read chunk may carry
      // several legitimate frames whose combined size exceeds the frame cap
      // (checking before draining would falsely abort well-behaved streams).
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (frame.length > MAX_SCORE_STREAM_FRAME_BYTES) continue; // oversized frame: skip, don't trust
        const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine || events.length >= MAX_SCORE_STREAM_EVENTS) continue;
        try {
          const parsed: unknown = JSON.parse(dataLine.slice(5).trim());
          if (isScoreJobEvent(parsed)) events.push(parsed);
        } catch {
          // Skip malformed or schema-invalid frames rather than trusting them.
        }
      }
      // Whatever remains is an incomplete frame fragment; if it already
      // exceeds the frame cap, no separator will ever make it legal.
      if (buffer.length > MAX_SCORE_STREAM_FRAME_BYTES) {
        await reader.cancel('score stream frame too large');
        throw new Error('Score stream frame exceeded its size limit.');
      }
    }
  } finally {
    reader.releaseLock();
  }
  return events;
}

// ─── AI judge model registry (donor picker) ─────────────────────────────────

/** Default AI judge model (used when no donor preference is recorded). */
export const DEFAULT_VERIFICATION_MODEL = 'openai/gpt-5.6-sol';

/** Curated judge model from GET /v1/verification/models. */
export interface VerificationModel {
  /** Routstr/OpenRouter model id. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Provider prefix (e.g. 'moonshotai'). */
  provider: string;
  /** Input price in msats per 1M tokens. */
  input_msats_per_1m: number;
  /** Output price in msats per 1M tokens. */
  output_msats_per_1m: number;
  /** Whether the model accepts image input. */
  vision: boolean;
  /** Rough quality tier, for display only. */
  tier: string;
}

/**
 * Wire shape of the models endpoint. The API serializes the registry with
 * camelCase keys (`label`, `inputMsatsPer1M`); accept both that and the
 * snake_case shape so an older/newer deployment never renders a blank picker.
 */
interface WireVerificationModel {
  id: string;
  name?: string;
  label?: string;
  provider?: string;
  input_msats_per_1m?: number;
  inputMsatsPer1M?: number;
  output_msats_per_1m?: number;
  outputMsatsPer1M?: number;
  vision: boolean;
  tier: string;
}

function normalizeVerificationModel(m: WireVerificationModel): VerificationModel {
  return {
    id: m.id,
    name: m.name ?? m.label ?? m.id,
    provider: m.provider ?? m.id.split('/')[0] ?? '',
    input_msats_per_1m: m.input_msats_per_1m ?? m.inputMsatsPer1M ?? 0,
    output_msats_per_1m: m.output_msats_per_1m ?? m.outputMsatsPer1M ?? 0,
    vision: m.vision,
    tier: m.tier,
  };
}

export interface VerificationModelsResult {
  /** Server default judge model (used when no donor preference is recorded). */
  defaultModel: string;
  models: VerificationModel[];
}

/**
 * List the curated AI judge models donors can vote for at contribution time.
 * Keeps the server's `default_model` - pickers must initialize to it (it can
 * differ from the registry fallback when the server config moves on).
 */
export async function fetchVerificationModels(): Promise<VerificationModelsResult> {
  const res = await fundFetch<{ data: { default_model?: string; models: WireVerificationModel[] } }>('/v1/verification/models');
  return {
    defaultModel: res.data.default_model ?? DEFAULT_VERIFICATION_MODEL,
    models: res.data.models.map(normalizeVerificationModel),
  };
}
