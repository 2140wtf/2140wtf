import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';

import {
  CardSchemaError,
  MAX_FEED_CARDS,
  MAX_FEED_STATUSES,
  buildFundraiserCardContent,
  cardTags,
  discoveryFilter,
  emptyFundFeedFoldState,
  foldFundFeedEvent,
  fundraiserACoord,
  publishFundraiserCard,
  subscribeFundFeed,
  type AgentHints,
  type FundraiserCardEvent,
  type FundFeedFoldState,
  type MilestoneStatusEvent,
} from './baoCards';

const SK = generateSecretKey();
const PK = getPublicKey(SK);
const OTHER = generateSecretKey();

const hints = (over: Partial<AgentHints> = {}): AgentHints => ({
  amountUnit: 'sats',
  canContributeFrom: ['browser', 'mcp'],
  idempotency: 'contributionId',
  ...over,
});

const validContent = () =>
  buildFundraiserCardContent({
    title: 'Fund the BAO bridge',
    summary: 'A test campaign',
    format: 'milestones',
    rails: ['cashu'],
    milestones: [{ id: 'm1', title: 'First', amount: 21_000, status: 'locked' }],
    attestation: 'agent-verified',
    api: 'https://bao.network/v1/fundraisers/bridge',
    agentHints: hints(),
  });

describe('fundraiserACoord', () => {
  it('builds the full NIP-01 a-coordinate', () => {
    expect(fundraiserACoord(PK, 'my-slug')).toBe(`39801:${PK}:my-slug`);
  });
  it('rejects non-hex pubkeys and bad slugs (typed errors)', () => {
    expect(() => fundraiserACoord('nothex', 's')).toThrow(CardSchemaError);
    expect(() => fundraiserACoord(PK, 'BAD SLUG')).toThrow(CardSchemaError);
    expect(() => fundraiserACoord(PK, '')).toThrow(CardSchemaError);
  });
});

describe('buildFundraiserCardContent - typed errors on every negative path', () => {
  it('builds a valid v1 card', () => {
    const c = validContent();
    expect(c.v).toBe(1);
    expect(c.agentHints.amountUnit).toBe('sats');
    expect(c.milestones[0].amount).toBe(21000);
  });
  it('rejects empty title/summary', () => {
    expect(() => buildFundraiserCardContent({ ...validContent(), title: ' ' } as never)).toThrow(CardSchemaError);
    expect(() => buildFundraiserCardContent({ ...validContent(), summary: '' })).toThrow(CardSchemaError);
  });
  it('rejects bad format and rails', () => {
    expect(() => buildFundraiserCardContent({ ...validContent(), format: 'other' as never })).toThrow(CardSchemaError);
    expect(() => buildFundraiserCardContent({ ...validContent(), rails: [] })).toThrow(CardSchemaError);
    expect(() => buildFundraiserCardContent({ ...validContent(), rails: ['paypal' as never] })).toThrow(CardSchemaError);
  });
  it('rejects float/NaN milestone amounts (sats are integers)', () => {
    expect(() =>
      buildFundraiserCardContent({ ...validContent(), milestones: [{ id: 'm1', title: 'x', amount: 1.5, status: 'locked' }] }),
    ).toThrow(CardSchemaError);
    expect(() =>
      buildFundraiserCardContent({ ...validContent(), milestones: [{ id: 'm1', title: 'x', amount: Number.NaN, status: 'locked' }] }),
    ).toThrow(CardSchemaError);
  });
  it('rejects bad milestone status', () => {
    expect(() =>
      buildFundraiserCardContent({ ...validContent(), milestones: [{ id: 'm1', title: 'x', amount: 1, status: 'weird' as never }] }),
    ).toThrow(CardSchemaError);
  });
  it('rejects unknown canContributeFrom and non-https api', () => {
    expect(() => buildFundraiserCardContent({ ...validContent(), agentHints: hints({ canContributeFrom: ['telepathy' as never] }) })).toThrow(
      CardSchemaError,
    );
    expect(() => buildFundraiserCardContent({ ...validContent(), api: 'http://bao.network' })).toThrow(CardSchemaError);
    expect(() => buildFundraiserCardContent({ ...validContent(), api: 'not a url' })).toThrow(CardSchemaError);
  });
  it('error carries the offending field', () => {
    try {
      buildFundraiserCardContent({ ...validContent(), rails: [] });
      expect.unreachable();
    } catch (e) {
      expect((e as CardSchemaError).field).toBe('rails');
    }
  });
});

describe('cardTags', () => {
  it('emits d/title/summary/alt + topics and image', () => {
    const t = cardTags({ slug: 's', title: 'T', summary: 'S', topics: ['ai', ' ', 'x'], image: 'https://i/p.png' });
    expect(t[0]).toEqual(['d', 's']);
    expect(t.filter((x) => x[0] === 't').map((x) => x[1])).toEqual(['ai', 'x']);
    expect(t.find((x) => x[0] === 'image')).toEqual(['image', 'https://i/p.png']);
    expect(t.find((x) => x[0] === 'alt')).toBeTruthy();
  });
});

describe('publishFundraiserCard', () => {
  it('publishes kind 39801 to the fund relay and returns the a-coordinate', async () => {
    const seen: { kind: number; tags: string[][]; relay?: string }[] = [];
    const id = await publishFundraiserCard(
      async (t) => {
        seen.push(t);
        return { id: 'ev1' };
      },
      { creatorPubkey: PK, slug: 'bridge', relay: 'wss://discovery.example', content: validContent(), tags: cardTags({ slug: 'bridge', title: 'T', summary: 'S' }) },
    );
    expect(seen[0].kind).toBe(39801);
    expect(seen[0].relay).toBeTruthy();
    expect(id.aCoord).toBe(`39801:${PK}:bridge`);
  });
});

const cardEvent = (over: Partial<FundraiserCardEvent> = {}, key = SK): FundraiserCardEvent => finalizeEvent({
  kind: 39801, created_at: 1000, tags: [['d', 'bridge']], content: JSON.stringify(validContent()), ...over,
}, key);
const body = (over = {}) => ({ v: 1, fundraiser: fundraiserACoord(PK, 'bridge'), milestone: 'm1', seq: 1,
  status: 'unlocked', ledgerHead: 'a'.repeat(64), totals: { totalRaised: 21000 }, ...over });
const statusEvent = (over: Partial<MilestoneStatusEvent> = {}, key = SK): MilestoneStatusEvent => finalizeEvent({
  kind: 39803, created_at: 1001, tags: [['d', 'bridge:m1:1']], content: JSON.stringify(body()), ...over,
}, key);
const coord = fundraiserACoord(PK, 'bridge');
const authority = { registrarPins: new Map([[coord, new Set([PK])]]) };
const fold = (state: FundFeedFoldState, event: FundraiserCardEvent) => foldFundFeedEvent(state, event, event.kind, authority);

describe('signed discovery feed', () => {
  it('inserts creator-signed cards and keeps newest per coordinate', () => {
    const old = cardEvent(); const newer = cardEvent({ created_at: 2000 });
    let s = fold(emptyFundFeedFoldState(), old);
    s = fold(s, newer); s = fold(s, old);
    expect(s.cards.get(coord)?.eventId).toBe(newer.id);
    expect(s.invalid).toBe(0);
    s = fold(s, cardEvent({}, OTHER)); expect(s.cards.size).toBe(2);
  });
  it('retains the lower event ID on equal timestamps in either delivery order', () => {
    const a = cardEvent(); const b = cardEvent({ content: JSON.stringify({ ...validContent(), title: 'Other' }) });
    for (const events of [[a,b],[b,a]]) {
      const s = events.reduce(fold, emptyFundFeedFoldState());
      expect(s.cards.get(coord)?.eventId).toBe([a.id,b.id].sort()[0]);
    }
  });
  it('rejects tampering even after verifyEvent cached a successful verification', () => {
    const e = cardEvent(); expect(verifyEvent(e)).toBe(true);
    e.content = JSON.stringify({ ...validContent(), title: 'Tampered' });
    expect(fold(emptyFundFeedFoldState(), e).invalid).toBe(1);
  });
  it.each([
    { tags: [] }, { tags: [['d','bridge'],['d','another']] }, { tags: [['d','bad slug']] },
    { content: 'not json' }, { content: JSON.stringify({ v: 2 }) }, { created_at: -1 },
  ])('rejects malformed signed card %j without throwing', over => {
    const s = fold(emptyFundFeedFoldState(), cardEvent(over));
    expect(s.invalid).toBe(1); expect(s.cards.size).toBe(0);
  });
  it.each([
    { rails: [] }, { milestones: null }, { milestones: [null] }, { attestation: 'fake' },
    { agentHints: null }, { agentHints: hints({ amountUnit: 'btc' as never }) },
    { api: 'https://user:password@example.com' }, { api: 'http://example.com' },
    { milestones: [{ id: '', title: 'Bad', amount: 1, status: 'locked' }] },
  ])('uses complete inbound validation %j', over => {
    const e = cardEvent({ content: JSON.stringify({ ...validContent(), ...over }) });
    expect(fold(emptyFundFeedFoldState(), e).invalid).toBe(1);
  });
  it('denies statuses without an external registrar pin and rejects other valid signers', () => {
    expect(foldFundFeedEvent(emptyFundFeedFoldState(), statusEvent(), 39803).invalid).toBe(1);
    expect(fold(emptyFundFeedFoldState(), statusEvent({}, OTHER)).invalid).toBe(1);
  });
  it('preserves status signer, milestone and ledger head, and deduplicates replay', () => {
    const e = statusEvent(); let s = fold(emptyFundFeedFoldState(), e); s = fold(s, e);
    expect(s.milestoneStatuses.get(coord)).toEqual([expect.objectContaining({ signer: PK, milestone: 'm1', ledgerHead: 'a'.repeat(64), seq: 1 })]);
  });
  it.each([
    { fundraiser: 'bridge' }, { milestone: '' }, { seq: -1 }, { seq: 1.5 }, { seq: 2 },
    { status: 'free-money' }, { ledgerHead: 'garbage' }, { totals: { totalRaised: -1 } },
    { totals: { supporterCount: 0.5 } }, { totals: { totalRaised: null } }, { totals: [] },
  ])('rejects malformed status %j', over => {
    expect(fold(emptyFundFeedFoldState(), statusEvent({ content: JSON.stringify(body(over)) })).invalid).toBe(1);
  });
  it('does not infer kinds from content or accept a mismatching dispatcher kind', () => {
    expect(foldFundFeedEvent(emptyFundFeedFoldState(), cardEvent(), 39803, authority).invalid).toBe(1);
    const e = cardEvent(); delete (e as Partial<FundraiserCardEvent>).kind;
    expect(fold(emptyFundFeedFoldState(), e).invalid).toBe(1);
  });
  it('bounds new feed entries without discarding existing state', () => {
    const initial = fold(emptyFundFeedFoldState(), cardEvent());
    const row = initial.cards.get(coord)!;
    const cards = new Map(Array.from({ length: MAX_FEED_CARDS }, (_, i) => [`fixture:${i}`, row]));
    const s = fold({ ...initial, cards }, cardEvent());
    expect(s.invalid).toBe(1); expect(s.cards).toBe(cards);
    const accepted = fold(emptyFundFeedFoldState(), statusEvent());
    const status = accepted.milestoneStatuses.get(coord)![0];
    const statuses = new Map([[coord, Array.from({ length: MAX_FEED_STATUSES }, (_, i) => ({ ...status, eventId: `fixture:${i}` }))]]);
    const bounded = fold({ ...accepted, milestoneStatuses: statuses }, statusEvent());
    expect(bounded.invalid).toBe(1); expect(bounded.milestoneStatuses).toBe(statuses);
  });
  it('requires public relay configuration and matching address before any publish', async () => {
    const publish = vi.fn();
    const card = { creatorPubkey: PK, slug: 'bridge', content: validContent(), tags: [['d','bridge']], relay: '' };
    await expect(publishFundraiserCard(publish, card)).rejects.toThrow(CardSchemaError);
    await expect(publishFundraiserCard(publish, { ...card, relay: 'wss://discovery.example', tags: [['d','other']] })).rejects.toThrow(CardSchemaError);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('subscribeFundFeed', () => {
  it('uses canonical filters and ignores delivery after unsubscribe', () => {
    let deliver!: (e: FundraiserCardEvent) => void;
    const stop = vi.fn(); const onState = vi.fn();
    const subscribe = vi.fn((_f, cb) => { deliver = cb; return stop; });
    const unsub = subscribeFundFeed({ subscribe }, { authority, topic: 'ai', onState });
    expect(subscribe.mock.calls[0][0]).toEqual(discoveryFilter('ai'));
    deliver(cardEvent()); deliver(statusEvent());
    expect(onState.mock.lastCall?.[0].milestoneStatuses.size).toBe(1);
    unsub(); unsub(); deliver(cardEvent());
    expect(stop).toHaveBeenCalledTimes(1); expect(onState).toHaveBeenCalledTimes(2);
  });
  it('reports subscription errors', () => {
    const onError = vi.fn();
    subscribeFundFeed({ subscribe: () => { throw new Error('offline'); } }, { onState: () => {}, onError });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
