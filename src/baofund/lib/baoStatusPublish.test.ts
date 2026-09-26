import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import { emptyFundFeedFoldState, foldFundFeedEvent, MILESTONE_STATUS_KIND } from './baoCards';
import { StatusPublishError, buildMilestoneStatusContent, milestoneStatusDTag, signMilestoneStatus } from './baoStatusPublish';

const SK = generateSecretKey();
const PUB = getPublicKey(SK);
const CAMPAIGN = `39801:${'a'.repeat(64)}:solar-coop`;
const HASH = 'f'.repeat(64);
const SIGNER = {
  signEvent: async (e: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(e, SK) as unknown as NostrEvent,
};

const foldWithPin = (ev: NostrEvent, pubkey = PUB) =>
  foldFundFeedEvent(emptyFundFeedFoldState(), ev, MILESTONE_STATUS_KIND, {
    registrarPins: new Map([[CAMPAIGN, new Set([pubkey.toLowerCase()])]]),
  });

describe('signMilestoneStatus', () => {
  it('signs a status the fold accepts under the registrar pin', async () => {
    const ev = await signMilestoneStatus(SIGNER, {
      campaign: CAMPAIGN,
      milestone: 'm1',
      seq: 1,
      status: 'released',
      ledgerHead: HASH,
      totals: { totalRaised: 12_500, supporterCount: 3 },
      createdAt: 1_700_000_000,
    });
    expect(ev.kind).toBe(MILESTONE_STATUS_KIND);
    expect(ev.tags).toEqual([['d', 'solar-coop:m1:1']]);
    const state = foldWithPin(ev);
    expect(state.invalid).toBe(0);
    const rows = state.milestoneStatuses.get(CAMPAIGN);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({ milestone: 'm1', seq: 1, status: 'released', ledgerHead: HASH, ledgerVerified: false });
    expect(rows?.[0].totals?.totalRaised).toBe(12_500);
  });

  it('omits optional fields when unset', async () => {
    const ev = await signMilestoneStatus(SIGNER, { campaign: CAMPAIGN, milestone: 'm1', seq: 2, status: 'locked' }, { timestamp: 1 });
    const body = JSON.parse(ev.content) as Record<string, unknown>;
    expect(body.ledgerHead).toBeUndefined();
    expect(body.totals).toBeUndefined();
  });

  it('normalizes an uppercase ledgerHead so the fold accepts it', async () => {
    const ev = await signMilestoneStatus(
      SIGNER,
      { campaign: CAMPAIGN, milestone: 'm1', seq: 3, status: 'unlocked', ledgerHead: 'AB'.repeat(32) },
      { timestamp: 2 },
    );
    const body = JSON.parse(ev.content) as Record<string, unknown>;
    expect(body.ledgerHead).toBe('ab'.repeat(32));
    expect(foldWithPin(ev).invalid).toBe(0);
  });

  it('a status signed by another key is dropped by the pin', async () => {
    const other = getPublicKey(generateSecretKey());
    const ev = await signMilestoneStatus(SIGNER, { campaign: CAMPAIGN, milestone: 'm1', seq: 1, status: 'locked' }, { timestamp: 1 });
    expect(foldWithPin(ev, other).invalid).toBe(1);
    expect(foldWithPin(ev, other).milestoneStatuses.size).toBe(0);
  });
});

describe('buildMilestoneStatusContent validation', () => {
  it('rejects malformed campaign, seq, status, ledgerHead and totals', () => {
    const base = { campaign: CAMPAIGN, milestone: 'm1', seq: 1, status: 'locked' as const };
    expect(() => buildMilestoneStatusContent({ ...base, campaign: 'solar-coop' })).toThrow(StatusPublishError);
    expect(() => buildMilestoneStatusContent({ ...base, seq: 0 })).toThrow(StatusPublishError);
    expect(() => buildMilestoneStatusContent({ ...base, status: 'paused' as never })).toThrow(StatusPublishError);
    expect(() => buildMilestoneStatusContent({ ...base, ledgerHead: 'not-hex' })).toThrow(StatusPublishError);
    expect(() => buildMilestoneStatusContent({ ...base, totals: { bonus: 1 } as never })).toThrow(StatusPublishError);
    expect(() => buildMilestoneStatusContent({ ...base, totals: { supporterCount: -1 } })).toThrow(StatusPublishError);
  });

  it('derives the canonical d tag from the a-coordinate slug', () => {
    expect(milestoneStatusDTag(CAMPAIGN, 'm2', 3)).toBe('solar-coop:m2:3');
    expect(() => milestoneStatusDTag('not-a-coord', 'm2', 3)).toThrow(StatusPublishError);
  });
});
