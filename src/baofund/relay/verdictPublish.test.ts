import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import { VerdictPublishError, signMilestoneVerdict } from './verdictPublish';
import { parseVerdictEvent } from './verdictFeed';

const SK = generateSecretKey();
const PUB = getPublicKey(SK);
const HASH = 'e'.repeat(64);
const SIGNER = {
  signEvent: async (e: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(e, SK) as unknown as NostrEvent,
};

describe('signMilestoneVerdict', () => {
  it('signs a verdict the reader parses under the verifier pin', async () => {
    const ev = await signMilestoneVerdict(
      SIGNER,
      {
        marketId: 'mk_1',
        fundraiserId: 'fr_1',
        milestoneId: 'm1',
        score: 92,
        attempt: 2,
        verdict: 'pass',
        model: 'deepseek-v4-flash',
        evidenceHash: HASH,
        createdAt: 1_700_000_000,
      },
      { timestamp: 1_700_000_000 },
    );
    expect(ev.tags.find((t) => t[0] === 'evidence_hash')?.[1]).toBe(`sha256:${HASH}`);
    const parsed = parseVerdictEvent(ev, PUB);
    expect(parsed).toMatchObject({
      marketId: 'mk_1',
      fundraiserId: 'fr_1',
      milestoneId: 'm1',
      score: 92,
      attempt: 2,
      verdict: 'pass',
      model: 'deepseek-v4-flash',
      evidenceHash: HASH,
    });
  });

  it('drops the market d tag when no market id is given', async () => {
    const ev = await signMilestoneVerdict(SIGNER, {
      score: 10,
      attempt: 1,
      verdict: 'fail',
      model: 'm',
      evidenceHash: HASH,
    }, { timestamp: 1 });
    expect(ev.tags.some((t) => t[0] === 'd')).toBe(false);
    expect(parseVerdictEvent(ev, PUB)?.marketId).toBeNull();
  });

  it('rejects invalid score, attempt, evidence hash and empty text fields', async () => {
    const base = { score: 50, attempt: 1, verdict: 'pass', model: 'm', evidenceHash: HASH };
    await expect(signMilestoneVerdict(SIGNER, { ...base, score: Number.NaN })).rejects.toBeInstanceOf(VerdictPublishError);
    await expect(signMilestoneVerdict(SIGNER, { ...base, attempt: 0 })).rejects.toBeInstanceOf(VerdictPublishError);
    await expect(signMilestoneVerdict(SIGNER, { ...base, evidenceHash: 'nope' })).rejects.toBeInstanceOf(VerdictPublishError);
    await expect(signMilestoneVerdict(SIGNER, { ...base, model: '  ' })).rejects.toBeInstanceOf(VerdictPublishError);
  });

  it('another verifier key does not parse under the pin', async () => {
    const ev = await signMilestoneVerdict(SIGNER, {
      score: 50,
      attempt: 1,
      verdict: 'pass',
      model: 'm',
      evidenceHash: HASH,
    }, { timestamp: 1 });
    expect(parseVerdictEvent(ev, getPublicKey(generateSecretKey()))).toBeNull();
  });
});
