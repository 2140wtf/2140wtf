/**
 * verdictPublish - verifier-side construction of kind-38060 AI milestone
 * verdicts (the terminal score event the UI reads from the relay).
 *
 * `verdictFeed.parseVerdictEvent` is the normative gate; this module builds
 * the exact tag/content shape it parses, signs with the verifier key and
 * self-checks the signed event against that key before returning.
 */
import { verifyEvent, type Event } from 'nostr-tools/pure';
import { MILESTONE_VERDICT_KIND, parseVerdictEvent } from './verdictFeed';
import type { SignerLike } from '../lib/baoFundraising';

export class VerdictPublishError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'VerdictPublishError';
  }
}

export interface MilestoneVerdictInput {
  /** Resolution-market id (the reader also accepts `m`). */
  marketId?: string | null;
  fundraiserId?: string | null;
  milestoneId?: string | null;
  score: number;
  attempt: number;
  verdict: string;
  model: string;
  /** 64-hex evidence digest the verdict was computed over. */
  evidenceHash: string;
  createdAt?: number;
}

const HEX64 = /^[0-9a-f]{64}$/i;

const requireText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new VerdictPublishError(`${field} is required`, 'verdict_bad_field');
  }
  return value;
};

/** Sign a kind-38060 verdict the relay reader will parse and pin. */
export async function signMilestoneVerdict(
  signer: SignerLike,
  input: MilestoneVerdictInput,
  opts: { timestamp?: number; selfCheck?: boolean } = {},
): Promise<Event> {
  if (!Number.isFinite(input.score)) {
    throw new VerdictPublishError('score must be a finite number', 'verdict_bad_score');
  }
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new VerdictPublishError('attempt must be a positive integer', 'verdict_bad_attempt');
  }
  if (!HEX64.test(input.evidenceHash)) {
    throw new VerdictPublishError('evidenceHash must be 64-hex', 'verdict_bad_evidence_hash');
  }
  const verdict = requireText(input.verdict, 'verdict');
  const model = requireText(input.model, 'model');
  const createdAt = input.createdAt ?? opts.timestamp ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new VerdictPublishError('createdAt must be a non-negative integer', 'verdict_bad_created_at');
  }

  const tags: string[][] = [
    ['score', String(input.score)],
    ['attempt', String(input.attempt)],
    ['verdict', verdict],
    ['evidence_hash', `sha256:${input.evidenceHash.toLowerCase()}`],
    ['model', model],
  ];
  if (input.marketId) tags.unshift(['d', input.marketId]);
  if (input.fundraiserId) tags.push(['fundraiser', input.fundraiserId]);
  if (input.milestoneId) tags.push(['milestone', input.milestoneId]);

  const unsigned = {
    kind: MILESTONE_VERDICT_KIND,
    created_at: createdAt,
    tags,
    content: JSON.stringify({ verdict, score: input.score, model }),
  };
  const signed = (await signer.signEvent(unsigned)) as Event;
  if (!verifyEvent(JSON.parse(JSON.stringify(signed)) as Event)) {
    throw new VerdictPublishError('verdict signature does not verify', 'verdict_bad_signature');
  }
  if (opts.selfCheck !== false) {
    const parsed = parseVerdictEvent(signed, signed.pubkey);
    if (!parsed || parsed.score !== input.score || parsed.attempt !== input.attempt || parsed.evidenceHash !== input.evidenceHash.toLowerCase()) {
      throw new VerdictPublishError('self-check rejected the verdict event', 'verdict_self_check_failed');
    }
  }
  return signed;
}
