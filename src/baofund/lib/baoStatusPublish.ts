/**
 * baoStatusPublish - registrar-side construction of kind-39803 milestone
 * statuses (the append-only projection of the 49305 ledger).
 *
 * The fold (`baoCards.foldFundFeedEvent`) is the normative gate; this module
 * is the publisher half: it builds the exact `d=<slug>:<milestone>:<seq>` tag
 * and content shape the fold accepts, signs with the registrar key and
 * self-checks the event under that key's own pin before returning.
 */
import { verifyEvent, type Event } from 'nostr-tools';
import {
  emptyFundFeedFoldState,
  foldFundFeedEvent,
  isFundraiserACoord,
  MILESTONE_STATUSES,
  MILESTONE_STATUS_KIND,
  type CardMilestone,
} from './baoCards';
import type { SignerLike } from './baoFundraising';

export class StatusPublishError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'StatusPublishError';
  }
}

export type MilestoneStatusTotals = {
  totalRaised?: number | null;
  supporterCount?: number | null;
  anonymousSats?: number | null;
};

export interface MilestoneStatusInput {
  /** Full 39801 a-coordinate - never a bare slug. */
  campaign: string;
  milestone: string;
  seq: number;
  status: CardMilestone['status'];
  /** Ledger chain head this status projects (64-hex), when known. */
  ledgerHead?: string | null;
  /** Signed assertion only - the fold marks it `ledgerVerified: false`. */
  totals?: MilestoneStatusTotals | null;
  createdAt?: number;
}

const HEX64 = /^[0-9a-f]{64}$/i;
const TOTALS_KEYS = ['totalRaised', 'supporterCount', 'anonymousSats'] as const;

/** The canonical append-only d tag: `<slug>:<milestone>:<seq>`. */
export function milestoneStatusDTag(campaign: string, milestone: string, seq: number): string {
  if (!isFundraiserACoord(campaign)) {
    throw new StatusPublishError('campaign must be a full 39801 a-coordinate', 'status_bad_campaign');
  }
  return `${campaign.split(':')[2]}:${milestone}:${seq}`;
}

function validateTotals(totals: MilestoneStatusTotals | null | undefined): MilestoneStatusTotals | undefined {
  if (totals === null || totals === undefined) return undefined;
  if (typeof totals !== 'object' || Array.isArray(totals)) {
    throw new StatusPublishError('totals must be an object when set', 'status_bad_totals');
  }
  for (const [key, value] of Object.entries(totals)) {
    if (!(TOTALS_KEYS as readonly string[]).includes(key)) {
      throw new StatusPublishError(`unknown totals key ${key}`, 'status_bad_totals');
    }
    if (value === null) {
      if (key === 'totalRaised') continue; // null totalRaised is allowed by the fold
      throw new StatusPublishError(`${key} must be an integer when set`, 'status_bad_totals');
    }
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new StatusPublishError(`${key} must be a non-negative integer or null`, 'status_bad_totals');
    }
  }
  return totals;
}

/** Build the fold-valid content body for one status event. */
export function buildMilestoneStatusContent(input: MilestoneStatusInput): Record<string, unknown> {
  if (!isFundraiserACoord(input.campaign)) {
    throw new StatusPublishError('campaign must be a full 39801 a-coordinate', 'status_bad_campaign');
  }
  if (typeof input.milestone !== 'string' || !input.milestone.trim()) {
    throw new StatusPublishError('milestone is required', 'status_bad_milestone');
  }
  if (!Number.isSafeInteger(input.seq) || input.seq < 1) {
    throw new StatusPublishError('seq must be a positive integer', 'status_bad_seq');
  }
  if (!MILESTONE_STATUSES.includes(input.status)) {
    throw new StatusPublishError(`status must be one of ${MILESTONE_STATUSES.join('|')}`, 'status_bad_status');
  }
  const ledgerHead = input.ledgerHead === null || input.ledgerHead === undefined ? null : String(input.ledgerHead).toLowerCase();
  if (ledgerHead !== null && !HEX64.test(ledgerHead)) {
    throw new StatusPublishError('ledgerHead must be 64-hex when set', 'status_bad_ledger_head');
  }
  const content: Record<string, unknown> = {
    v: 1,
    fundraiser: input.campaign,
    milestone: input.milestone,
    seq: input.seq,
    status: input.status,
  };
  if (ledgerHead) content.ledgerHead = ledgerHead;
  const totals = validateTotals(input.totals);
  if (totals) content.totals = totals;
  return content;
}

/**
 * Sign a 39803 status and prove the fold accepts it under the registrar's own
 * pin (exactly one d tag, valid schema, pinned author). A publisher must never
 * emit a status its own reader would drop.
 */
export async function signMilestoneStatus(
  signer: SignerLike,
  input: MilestoneStatusInput,
  opts: { timestamp?: number; selfCheck?: boolean } = {},
): Promise<Event> {
  const createdAt = input.createdAt ?? opts.timestamp ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new StatusPublishError('createdAt must be a non-negative integer', 'status_bad_created_at');
  }
  const content = buildMilestoneStatusContent(input);
  const unsigned = {
    kind: MILESTONE_STATUS_KIND,
    created_at: createdAt,
    tags: [['d', milestoneStatusDTag(input.campaign, input.milestone, input.seq)]],
    content: JSON.stringify(content),
  };
  const signed = (await signer.signEvent(unsigned)) as Event;
  if (!verifyEvent(JSON.parse(JSON.stringify(signed)) as Event)) {
    throw new StatusPublishError('status signature does not verify', 'status_bad_signature');
  }
  if (opts.selfCheck !== false) {
    const authority = {
      registrarPins: new Map([[input.campaign, new Set([signed.pubkey.toLowerCase()])]]),
    };
    const state = foldFundFeedEvent(emptyFundFeedFoldState(), signed, MILESTONE_STATUS_KIND, authority);
    if (state.invalid > 0 || state.milestoneStatuses.size !== 1) {
      throw new StatusPublishError('self-check rejected the status event', 'status_self_check_failed');
    }
  }
  return signed;
}
