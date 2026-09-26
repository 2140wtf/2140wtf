// Tests for relay-first campaign discovery (cards in, drafts out) and the
// signed-card publisher. No network: WebRelayConn is not exercised here; the
// publisher takes an injected publish function.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import { buildFundraiserCardContent, FUNDRAISER_CARD_KIND, MILESTONE_STATUS_KIND } from '../lib/baoCards';
import type { BaoFundraiser, BaoMilestone, SignerLike } from '../lib/baoFundraising';
import { campaignSlug, cardMilestonesFor, cardRailsFor, publishCampaignCard } from './publishCampaignCard';
import { draftsFromEvents } from './relayFeed';

const SK = generateSecretKey();
const PUB = getPublicKey(SK);

function cardEvent(opts: {
  slug: string;
  createdAt: number;
  fr?: string;
  title?: string;
  amount?: number;
  secretKey?: Uint8Array;
}): NostrEvent {
  const content = buildFundraiserCardContent({
    title: opts.title ?? 'Solar Compute Coop',
    summary: 'Milestone-funded compute for open models.',
    format: 'milestones',
    rails: ['cashu'],
    milestones: [{ id: 'm1', title: 'Rack A', amount: opts.amount ?? 21_000, status: 'locked' }],
    attestation: 'none',
    api: 'https://fund.example/api',
    agentHints: { amountUnit: 'sats', canContributeFrom: ['browser'], idempotency: 'pledgeId' },
  });
  const tags: string[][] = [
    ['d', opts.slug],
    ['title', content.title],
    ['summary', content.summary],
    ['alt', '₦AO Fund fundraiser card'],
  ];
  if (opts.fr) tags.push(['fr', opts.fr]);
  return finalizeEvent(
    { kind: FUNDRAISER_CARD_KIND, created_at: opts.createdAt, tags, content: JSON.stringify(content) },
    opts.secretKey ?? SK,
  ) as NostrEvent;
}

describe('draftsFromEvents', () => {
  it('maps a signed card to a draft with owner, goal, rail, status and API id', () => {
    const drafts = draftsFromEvents([cardEvent({ slug: 'solar', createdAt: 1_700_000_000, fr: 'fr_abc123' })]);
    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    expect(d.id).toBe(`${FUNDRAISER_CARD_KIND}:${PUB.toLowerCase()}:solar`);
    expect(d.title).toBe('Solar Compute Coop');
    expect(d.goalSats).toBe(21_000);
    expect(d.pledgedSats).toBe(0);
    expect(d.rail).toBe('cashu');
    expect(d.status).toBe('locked');
    expect(d.ownerPubkey).toBe(PUB.toLowerCase());
    expect(d.frId).toBe('fr_abc123');
  });

  it('applies replaceable semantics: the newest card for a slug wins', () => {
    const older = cardEvent({ slug: 'solar', createdAt: 1_700_000_000, title: 'Old title' });
    const newer = cardEvent({ slug: 'solar', createdAt: 1_700_000_100, title: 'New title' });
    const drafts = draftsFromEvents([older, newer]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe('New title');
  });

  it('drops invalid content and unsigned authors instead of failing the feed', () => {
    const bad = finalizeEvent(
      { kind: FUNDRAISER_CARD_KIND, created_at: 1, tags: [['d', 'bad']], content: '{"v":1}' },
      SK,
    ) as NostrEvent;
    const tampered = { ...cardEvent({ slug: 'x', createdAt: 1 }), content: '{"v":1,"title":"x"}' } as NostrEvent;
    const drafts = draftsFromEvents([bad, tampered, cardEvent({ slug: 'ok', createdAt: 2 })]);
    expect(drafts.map((d) => d.id.endsWith(':ok'))).toEqual([true]);
  });

  it('ignores a malformed fr tag without dropping the card', () => {
    const ev = cardEvent({ slug: 'solar', createdAt: 1 });
    ev.tags.push(['fr', 'not a valid id!!']);
    const drafts = draftsFromEvents([finalizeEvent({ ...ev, tags: ev.tags }, SK) as NostrEvent]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].frId).toBeUndefined();
  });

  describe('39803 milestone statuses', () => {
    const aCoord = `39801:${PUB.toLowerCase()}:solar`;
    const pins = new Map([[aCoord, new Set([PUB.toLowerCase()])]]);

    function statusEvent(slug: string, milestone: string, seq: number, status: string): NostrEvent {
      return finalizeEvent(
        {
          kind: MILESTONE_STATUS_KIND,
          created_at: 1_700_000_000 + seq,
          tags: [['d', `${slug}:${milestone}:${seq}`]],
          content: JSON.stringify({ v: 1, fundraiser: aCoord, milestone, seq, status }),
        },
        SK,
      ) as NostrEvent;
    }

    it('applies the newest registrar-pinned status over the card default', () => {
      const card = cardEvent({ slug: 'solar', createdAt: 1_700_000_000 });
      const drafts = draftsFromEvents([card, statusEvent('solar', 'm1', 1, 'locked'), statusEvent('solar', 'm1', 2, 'released')], 20, pins);
      expect(drafts[0].status).toBe('released');
    });

    it('keeps the card default when no registrar pin is configured', () => {
      const card = cardEvent({ slug: 'solar', createdAt: 1_700_000_000 });
      const drafts = draftsFromEvents([card, statusEvent('solar', 'm1', 1, 'released')]);
      expect(drafts[0].status).toBe('locked');
    });

    it('drops statuses whose author is not the pinned registrar', () => {
      const card = cardEvent({ slug: 'solar', createdAt: 1_700_000_000 });
      const otherPin = new Map([[aCoord, new Set(['a'.repeat(64)])]]);
      const drafts = draftsFromEvents([card, statusEvent('solar', 'm1', 1, 'released')], 20, otherPin);
      expect(drafts[0].status).toBe('locked');
    });
  });
});

describe('draftsFromEvents robustness (fuzz)', () => {
  it('never throws folding 50 randomly shaped events', () => {
    let seed = 0xf00d;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const kinds = [FUNDRAISER_CARD_KIND, MILESTONE_STATUS_KIND, 49305, 38060, 1, 5];
    const values: unknown[] = ['solar', 'm1', 1, 0, -1, 'released', 'nope', '', 'a'.repeat(64), `39801:${'a'.repeat(64)}:x`, null, {}, []];
    const pins = new Map([[`39801:${PUB.toLowerCase()}:solar`, new Set([PUB.toLowerCase()])]]);
    for (let i = 0; i < 50; i++) {
      const tagCount = Math.floor(rand() * 6);
      const tags: string[][] = [];
      for (let t = 0; t < tagCount; t++) {
        const name = ['d', 'fr', 't', 'e', 'a'][Math.floor(rand() * 5)];
        tags.push([name, String(values[Math.floor(rand() * values.length)] ?? '')]);
      }
      const ev = finalizeEvent(
        {
          kind: kinds[Math.floor(rand() * kinds.length)],
          created_at: Math.floor(rand() * 1e9),
          tags,
          content: JSON.stringify(values[Math.floor(rand() * values.length)] ?? null),
        },
        SK,
      ) as NostrEvent;
      expect(() => draftsFromEvents([ev], 20, pins)).not.toThrow();
      expect(() => draftsFromEvents([ev], 20)).not.toThrow();
    }
  }, 20_000);
});

describe('publishCampaignCard', () => {
  afterEach(() => vi.unstubAllEnvs());

  const fundraiser: BaoFundraiser = {
    id: 'fr_abc123',
    title: 'Solar Compute Coop',
    description: 'Milestone-funded compute for open models.',
    owner_pubkey: PUB,
    runner_type: 'agent',
    goal_sats: 21_000,
    raised_sats: 0,
    status: 'open',
    settlement_rail: 'cashu',
    network: 'testnet',
    created_at: '2026-09-14T00:00:00Z',
    format: 'milestones',
  };
  const milestones: BaoMilestone[] = [
    {
      id: 'm1',
      fundraiser_id: fundraiser.id,
      idx: 0,
      title: 'Rack A',
      description: 'Rack delivered',
      amount_sats: 21_000,
      status: 'locked',
      unlocked_at: null,
      released_at: null,
      payout_reference: null,
    },
  ];

  it('locks the slug to the API id and maps rails/milestones safely', () => {
    expect(campaignSlug('Solar Compute Coop!', 'fr_abc123')).toMatch(/^solar-compute-coop-[a-z0-9]{1,6}$/);
    expect(campaignSlug('!!!', 'fr_abc123').endsWith('c123')).toBe(true);
    expect(cardRailsFor(fundraiser)).toEqual(['cashu']);
    expect(cardRailsFor({ ...fundraiser, settlement_rail: 'lightning' })).toEqual(['lightning']);
    expect(cardRailsFor({ ...fundraiser, settlement_rail: 'liquid' })).toEqual(['liquid']);
    expect(cardRailsFor({ ...fundraiser, settlement_rail: 'l1' })).toEqual(['l1']);
    expect(cardRailsFor({ ...fundraiser, settlement_rail: 'btc-testnet4' })).toEqual(['l1']);
    expect(cardMilestonesFor(milestones)).toEqual([{ id: 'm1', title: 'Rack A', amount: 21_000, status: 'locked' }]);
  });

  it('publishes a signed-shape card with the fr tag when the API base is https', async () => {
    vi.stubEnv('VITE_BAO_FUND_API_URL', 'https://fund.example/api');
    const captor = vi.fn(async (t: { kind: number; content: string; tags: string[][]; relay?: string }) => {
      expect(t.kind).toBe(FUNDRAISER_CARD_KIND);
      expect(t.tags.find((x) => x[0] === 'fr')?.[1]).toBe('fr_abc123');
      const d = t.tags.find((x) => x[0] === 'd')?.[1];
      expect(d).toBeTruthy();
      expect(t.content).toContain('Solar Compute Coop');
      return { id: 'e'.repeat(64) };
    });
    const signer = { signEvent: vi.fn() } as unknown as SignerLike;
    const out = await publishCampaignCard({
      signer,
      fundraiser,
      milestones,
      relayUrl: 'wss://relay.bao.fund',
      publish: captor,
    });
    expect(out.ok).toBe(true);
    expect(out.id).toBe('e'.repeat(64));
    expect(out.aCoord).toBe(`${FUNDRAISER_CARD_KIND}:${PUB.toLowerCase()}:${campaignSlug(fundraiser.title, fundraiser.id)}`);
    expect(captor).toHaveBeenCalledTimes(1);
  });

  it('fails closed (no throw) when the API base is not https', async () => {
    vi.stubEnv('VITE_BAO_FUND_API_URL', 'http://127.0.0.1:4318/fund-api');
    const out = await publishCampaignCard({
      signer: { signEvent: vi.fn() } as unknown as SignerLike,
      fundraiser,
      milestones,
      publish: vi.fn(),
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('https');
  });
});

describe('draftsFromEvents hardening (deep-hunt wave 2)', () => {
  it('relay-only cards never claim real-money status, even with the marker in the summary', () => {
    const ev = cardEvent({ slug: 'spoof', createdAt: 1_700_000_000 });
    // Rewrite the signed content summary to carry the legacy mainnet marker.
    const content = JSON.parse(ev.content) as { summary: string };
    content.summary = `${content.summary} [rail:mainnet-cashu]`;
    const spoofed = finalizeEvent(
      { kind: ev.kind, created_at: ev.created_at, tags: ev.tags, content: JSON.stringify(content) },
      SK,
    ) as NostrEvent;
    const drafts = draftsFromEvents([spoofed]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].mainnetCashu).toBe(false);
  });

  it('rejects implausibly future-dated cards so they cannot evict the real feed', () => {
    const future = cardEvent({ slug: 'future', createdAt: Math.floor(Date.now() / 1000) + 100_000 });
    const real = cardEvent({ slug: 'real', createdAt: Math.floor(Date.now() / 1000) - 60 });
    const drafts = draftsFromEvents([future, real]);
    expect(drafts.map((d) => d.title)).toHaveLength(1);
    expect(drafts[0].id.endsWith(':real')).toBe(true);
  });

  it('a stale republish does not relink the accepted card to an old fr tag', () => {
    const older = cardEvent({ slug: 'solar', createdAt: 1_700_000_000, fr: 'fr_old' });
    const newer = cardEvent({ slug: 'solar', createdAt: 1_700_000_100, fr: 'fr_new' });
    // Serve newest first, then the stale replay.
    const drafts = draftsFromEvents([newer, older]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].frId).toBe('fr_new');
  });

  it('the newest card dropping (or malforming) fr clears the old linkage', () => {
    // Older card links an API fundraiser; the owner republishes WITHOUT the
    // fr tag. The stale link must not survive - it would enrich the newest
    // card with a different fundraiser's API data.
    const older = cardEvent({ slug: 'solar', createdAt: 1_700_000_000, fr: 'fr_old' });
    const newer = cardEvent({ slug: 'solar', createdAt: 1_700_000_100 });
    const drafts = draftsFromEvents([older, newer]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].frId).toBeUndefined();

    // Same when the newest carries a malformed fr (ignored, not inherited).
    const malformed = cardEvent({ slug: 'solar', createdAt: 1_700_000_200 });
    malformed.tags.push(['fr', 'not a valid id!!']);
    const resigned = finalizeEvent({ kind: malformed.kind, created_at: malformed.created_at, tags: malformed.tags, content: malformed.content }, SK) as NostrEvent;
    const drafts2 = draftsFromEvents([older, resigned]);
    expect(drafts2).toHaveLength(1);
    expect(drafts2[0].frId).toBeUndefined();
  });
});
