import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  DEFAULT_DISCOVERY_RELAYS,
  buildMintRecommendationEvent,
  getPublishedReview,
  rememberPublishedReview,
  reviewCooldownRemainingMs,
  REVIEW_COOLDOWN_MS,
  upsertRecommendation,
  groupRecommendationsByUrl,
  parseDiscoveryRelays,
  parseMintAnnouncement,
  parseMintRecommendation,
  fetchMintInfo,
  rankDiscoveredMints,
  type DiscoveredMint,
  type MintAnnouncement,
  type MintRecommendation,
} from './mintDiscovery';

let seq = 0;
function ev(kind: number, tags: string[][], content = '', pubkey = 'a'.repeat(64)): Event {
  seq += 1;
  return {
    id: `ev-${seq}`,
    pubkey,
    created_at: 1_700_000_000 + seq,
    kind,
    tags,
    content,
    sig: 'f'.repeat(128),
  };
}

const MINT_URL = 'https://mint.example.com/Bitcoin';

describe('parseMintAnnouncement', () => {
  it('parses a valid announcement with network, nuts and metadata', () => {
    const parsed = parseMintAnnouncement(ev(
      38172,
      [['d', 'mint-id-1'], ['u', MINT_URL], ['n', 'mainnet'], ['nuts', '4,5,7,17']],
      JSON.stringify({ name: 'Example Mint', description: 'A test mint' }),
    ));
    expect(parsed).not.toBeNull();
    expect(parsed!.mintId).toBe('mint-id-1');
    expect(parsed!.mintUrl).toBe(MINT_URL);
    expect(parsed!.network).toBe('mainnet');
    expect(parsed!.nuts).toEqual([4, 5, 7, 17]);
    expect(parsed!.name).toBe('Example Mint');
    expect(parsed!.description).toBe('A test mint');
  });

  it('rejects missing d/u, non-https and private mints', () => {
    expect(parseMintAnnouncement(ev(38172, [['u', MINT_URL]]))).toBeNull();
    expect(parseMintAnnouncement(ev(38172, [['d', 'x']]))).toBeNull();
    expect(parseMintAnnouncement(ev(38172, [['d', 'x'], ['u', 'http://mint.example.com']]))).toBeNull();
    expect(parseMintAnnouncement(ev(38172, [['d', 'x'], ['u', 'https://127.0.0.1:3338']]))).toBeNull();
    expect(parseMintAnnouncement(ev(38000, [['d', 'x'], ['u', MINT_URL]]))).toBeNull();
  });

  it('keeps an unknown network as unknown and tolerates junk metadata', () => {
    const parsed = parseMintAnnouncement(ev(38172, [['d', 'x'], ['u', MINT_URL], ['n', 'liquid']], 'not json'));
    expect(parsed!.network).toBe('unknown');
    expect(parsed!.name).toBeUndefined();
  });
});

describe('parseMintRecommendation', () => {
  it('parses a review for a Cashu mint', () => {
    const parsed = parseMintRecommendation(ev(
      38000,
      [['d', 'mint-id-1'], ['k', '38172'], ['u', MINT_URL], ['rating', '4']],
      'solid mint',
    ));
    expect(parsed).not.toBeNull();
    expect(parsed!.mintId).toBe('mint-id-1');
    expect(parsed!.mintUrls).toEqual([MINT_URL]);
    expect(parsed!.rating).toBe(4);
    expect(parsed!.content).toBe('solid mint');
  });

  it('rejects non-Cashu recommendations and drops out-of-range ratings', () => {
    expect(parseMintRecommendation(ev(38000, [['d', 'x'], ['k', '38173'], ['u', MINT_URL]]))).toBeNull();
    expect(parseMintRecommendation(ev(38000, [['k', '38172'], ['u', MINT_URL]]))).toBeNull();
    const parsed = parseMintRecommendation(ev(38000, [['d', 'x'], ['k', '38172'], ['u', MINT_URL], ['rating', '9']]));
    expect(parsed!.rating).toBeUndefined();
  });
});

describe('groupRecommendationsByUrl', () => {
  it('groups by every mentioned mint URL', () => {
    const rec: MintRecommendation = {
      eventId: 'r1',
      createdAt: 1_700_000_000,
      author: 'a',
      mintId: 'm',
      mintUrls: ['https://a.example.com', 'https://b.example.com'],
      content: '',
    };
    const groups = groupRecommendationsByUrl([rec]);
    expect(groups.get('https://a.example.com')).toEqual([rec]);
    expect(groups.get('https://b.example.com')).toEqual([rec]);
  });
});

describe('rankDiscoveredMints', () => {
  const mainnet: MintAnnouncement = {
    eventId: 'a1',
    createdAt: 1_700_000_000,
    mintId: 'm1',
    mintUrl: 'https://mainnet.example.com',
    network: 'mainnet',
    nuts: [4, 5, 7, 17],
    name: 'Mainnet Mint',
  };
  const signet: MintAnnouncement = {
    eventId: 'a2',
    createdAt: 1_700_000_000,
    mintId: 'm2',
    mintUrl: 'https://signet.example.com',
    network: 'signet',
    nuts: [4],
  };
  const rec = (url: string, rating?: number): MintRecommendation => ({
    eventId: `r-${url}-${rating ?? 'x'}`,
    createdAt: 1_700_000_000,
    author: 'b'.repeat(64),
    mintId: 'm',
    mintUrls: [url],
    ...(rating !== undefined ? { rating } : {}),
    content: '',
  });

  it('ranks mainnet + NUT support + recommendations above a bare mint', () => {
    const ranked = rankDiscoveredMints([mainnet, signet], [rec(mainnet.mintUrl, 5)]);
    expect(ranked[0].url).toBe(mainnet.mintUrl);
    expect(ranked[0].avgRating).toBe(5);
    expect(ranked[0].recommendations).toHaveLength(1);
    // Signet is filtered entirely (owner rule: no signet wallet anywhere).
    expect(ranked.map((m) => m.url)).toEqual([mainnet.mintUrl]);
  });

  it('keeps only the latest announcement per URL and the latest review per author', () => {
    const newer: MintAnnouncement = { ...mainnet, eventId: 'a1-new', createdAt: 1_800_000_000, nuts: [4] };
    const olderReview: MintRecommendation = { ...rec(mainnet.mintUrl, 1), eventId: 'r-old', createdAt: 1_700_000_000 };
    const newerReview: MintRecommendation = { ...rec(mainnet.mintUrl, 5), eventId: 'r-new', createdAt: 1_800_000_000 };
    const ranked = rankDiscoveredMints([mainnet, newer], [olderReview, newerReview]);
    expect(ranked[0].announcement?.eventId).toBe('a1-new');
    expect(ranked[0].recommendations).toHaveLength(1);
    expect(ranked[0].avgRating).toBe(5);
  });

  it('binds a u-less review to its announcement d-tag', () => {
    const review: MintRecommendation = { ...rec('https://ignored.example', 4), mintId: mainnet.mintId, mintUrls: [] };
    const ranked = rankDiscoveredMints([mainnet], [review]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].url).toBe(mainnet.mintUrl);
    expect(ranked[0].recommendations).toHaveLength(1);
  });

  it('includes URL-only mints from recommendations without an announcement', () => {
    const ranked = rankDiscoveredMints([], [rec('https://url-only.example.com')]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].network).toBe('unknown');
    expect(ranked[0].score).toBe(0.5);
  });

  it('follows scope only counts recommendations from followed pubkeys', () => {
    const followed = 'c'.repeat(64);
    const r1 = { ...rec(mainnet.mintUrl, 5), author: followed, eventId: 'r1' };
    const r2 = { ...rec(mainnet.mintUrl, 1), author: 'd'.repeat(64), eventId: 'r2' };
    const all = rankDiscoveredMints([mainnet], [r1, r2]);
    expect(all[0].recommendations).toHaveLength(2);
    const scoped = rankDiscoveredMints([mainnet], [r1, r2], { followPubkeys: new Set([followed]) });
    expect(scoped[0].recommendations).toHaveLength(1);
    expect(scoped[0].avgRating).toBe(5);
  });
});

describe('parseDiscoveryRelays', () => {
  it('defaults to the public relay set', () => {
    expect(parseDiscoveryRelays(undefined)).toEqual([...DEFAULT_DISCOVERY_RELAYS]);
    expect(parseDiscoveryRelays('   ')).toEqual([...DEFAULT_DISCOVERY_RELAYS]);
  });

  it('keeps only valid wss:// entries, dedupes, and caps the list', () => {
    expect(parseDiscoveryRelays('wss://a.example, ws://b.example, wss://a.example')).toEqual(['wss://a.example']);
    const many = Array.from({ length: 12 }, (_, i) => `wss://r${i}.example`).join(',');
    expect(parseDiscoveryRelays(many)).toHaveLength(8);
  });

  it('does not silently fall back to public relays for a configured-but-invalid list', () => {
    // A typo must disable discovery, not leak traffic to third-party relays.
    expect(parseDiscoveryRelays('WSS://relay.internal.example')).toEqual([]);
    expect(parseDiscoveryRelays('ws://relay.internal.example')).toEqual([]);
    expect(parseDiscoveryRelays('wss://')).toEqual([]);
  });
});

describe('rankDiscoveredMints - per-author dedupe across URLs (wave 3)', () => {
  const urlA = 'https://a.example.com';
  const urlB = 'https://b.example.com';
  const ann: MintAnnouncement = {
    eventId: 'a1', createdAt: 1_700_000_000, mintId: 'mA', mintUrl: urlA, network: 'mainnet', nuts: [4, 5],
  };
  const author = 'e'.repeat(64);
  it('counts a multi-url review and a later single-url review by the same author once per URL', () => {
    const multi: MintRecommendation = {
      eventId: 'r-multi', createdAt: 1_700_000_000, author, mintId: 'mA', mintUrls: [urlA, urlB], rating: 1, content: '',
    };
    const single: MintRecommendation = {
      eventId: 'r-single', createdAt: 1_800_000_000, author, mintId: 'mA', mintUrls: [urlB], rating: 5, content: '',
    };
    const ranked = rankDiscoveredMints([ann], [multi, single]);
    const a = ranked.find((m) => m.url === urlA)!;
    const b = ranked.find((m) => m.url === urlB)!;
    expect(a.recommendations).toHaveLength(1);
    expect(a.avgRating).toBe(1);
    expect(b.recommendations).toHaveLength(1);
    expect(b.avgRating).toBe(5); // the later review wins for urlB
  });
});

describe('fetchMintInfo (wave 5)', () => {
  it('summarizes /v1/info', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        name: 'Example Mint',
        version: '1.2.3',
        motd: 'be nice',
        nuts: {
          4: { methods: [{ method: 'bolt11', unit: 'sat' }] },
          5: { methods: [{ method: 'bolt11', unit: 'sat' }] },
        },
      }),
    })));
    const info = await fetchMintInfo('https://mint.example.com');
    expect(info).toMatchObject({ name: 'Example Mint', version: '1.2.3', motd: 'be nice', nuts: [4, 5], units: ['SAT'], methods: ['BOLT11'] });
    vi.unstubAllGlobals();
  });

  it('refuses blocked test-network hosts without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchMintInfo('https://relay.bao.network/cashu')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('buildMintRecommendationEvent', () => {
  it('round-trips through parseMintRecommendation after signing', () => {
    const sk = generateSecretKey();
    const template = buildMintRecommendationEvent({
      mintUrl: MINT_URL,
      mintId: 'mint-id-1',
      rating: 4,
      content: 'solid mint',
      nowSeconds: 1_700_000_000,
    });
    expect(template.kind).toBe(38000);
    const signed = finalizeEvent(template, sk) as Event;
    const parsed = parseMintRecommendation(signed);
    expect(parsed).not.toBeNull();
    expect(parsed!.mintId).toBe('mint-id-1');
    expect(parsed!.mintUrls).toEqual([MINT_URL]);
    expect(parsed!.rating).toBe(4);
    expect(parsed!.content).toBe('solid mint');
    expect(parsed!.author).toBe(getPublicKey(sk));
  });

  it('uses the URL as the addressable d-tag for URL-only mints and validates input', () => {
    const template = buildMintRecommendationEvent({ mintUrl: MINT_URL, content: 'good' });
    expect(template.tags).toContainEqual(['d', MINT_URL]);
    expect(template.tags.some((t) => t[0] === 'rating')).toBe(false);
    expect(() => buildMintRecommendationEvent({ mintUrl: MINT_URL })).toThrow(/rating or some text/);
    expect(() => buildMintRecommendationEvent({ mintUrl: MINT_URL, rating: 6 })).toThrow(/1 to 5/);
    expect(() => buildMintRecommendationEvent({ mintUrl: 'http://insecure.example' })).toThrow(/public mint URL/);
  });
});

describe('follows scope is recommendation scope', () => {
  it('drops announcement-only mints and an empty follows set yields nothing', () => {
    const followed = 'c'.repeat(64);
    const annA: MintAnnouncement = { eventId: 'a', createdAt: 1, mintId: 'mA', mintUrl: 'https://a.example.com', network: 'mainnet', nuts: [] };
    const annB: MintAnnouncement = { eventId: 'b', createdAt: 1, mintId: 'mB', mintUrl: 'https://b.example.com', network: 'mainnet', nuts: [] };
    const review: MintRecommendation = { eventId: 'r', createdAt: 1, author: followed, mintId: 'mA', mintUrls: ['https://a.example.com'], content: '' };
    const scoped = rankDiscoveredMints([annA, annB], [review], { followPubkeys: new Set([followed]) });
    expect(scoped.map((m) => m.url)).toEqual(['https://a.example.com']);
    expect(rankDiscoveredMints([annA, annB], [review], { followPubkeys: new Set() })).toEqual([]);
    // Global scope still shows both announcements.
    expect(rankDiscoveredMints([annA, annB], [review])).toHaveLength(2);
  });
});

describe('upsertRecommendation (local publish echo)', () => {
  const me = 'e'.repeat(64);
  const other = 'f'.repeat(64);
  const base: DiscoveredMint = { url: MINT_URL, recommendations: [], network: 'mainnet', nuts: [4, 5], score: 3 };
  const mine: MintRecommendation = { eventId: 'r1', createdAt: 1, author: me, mintId: 'm', mintUrls: [MINT_URL], rating: 2, content: 'meh' };

  it('adds a review, then replaces the same author review (latest wins) without duplicating', () => {
    let list = upsertRecommendation([base], { ...mine, eventId: 'r0', author: other, rating: 4, content: '' });
    list = upsertRecommendation(list, mine);
    expect(list[0].recommendations).toHaveLength(2);
    expect(list[0].avgRating).toBe(3);

    list = upsertRecommendation(list, { ...mine, eventId: 'r2', createdAt: 2, rating: 5, content: 'better' });
    expect(list[0].recommendations).toHaveLength(2);
    expect(list[0].recommendations.find((r) => r.author === me)!.rating).toBe(5);
    expect(list[0].avgRating).toBe(4.5);
    expect(list[0].score).toBeGreaterThan(3);
  });

  it('leaves mints the review does not mention untouched', () => {
    const otherMint: DiscoveredMint = { ...base, url: 'https://other.example.com' };
    const list = upsertRecommendation([base, otherMint], mine);
    expect(list[0].recommendations).toHaveLength(1);
    expect(list[1]).toBe(otherMint);
  });
});

describe('local review guard (once per mint + cooldown)', () => {
  const pk = 'a'.repeat(64);
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom storage */ }
  });

  it('records a review and enforces the cooldown', () => {
    const t0 = 1_700_000_000_000;
    expect(getPublishedReview(pk, MINT_URL)).toBeNull();
    expect(reviewCooldownRemainingMs(pk, MINT_URL, t0)).toBe(0);
    rememberPublishedReview(pk, MINT_URL, { rating: 5, content: 'great' }, t0);
    expect(getPublishedReview(pk, MINT_URL)).toMatchObject({ rating: 5, content: 'great' });
    expect(reviewCooldownRemainingMs(pk, MINT_URL, t0 + 1_000)).toBe(REVIEW_COOLDOWN_MS - 1_000);
    expect(reviewCooldownRemainingMs(pk, MINT_URL, t0 + REVIEW_COOLDOWN_MS)).toBe(0);
  });

  it('a future-dated stored record cannot brick the cooldown', () => {
    const now = 1_700_000_000_000;
    try {
      localStorage.setItem(`bao-fund:mintReview:${pk}`, JSON.stringify({
        [MINT_URL]: { content: 'from the future', at: now + 10 * 365 * 24 * 3600_000 },
      }));
    } catch { /* jsdom storage */ }
    // A wildly future-dated record is ignored for the cooldown (the echo
    // survives) instead of disabling the button for years.
    expect(reviewCooldownRemainingMs(pk, MINT_URL, now)).toBe(0);
    expect(getPublishedReview(pk, MINT_URL)).not.toBeNull();
    // A plausible small skew keeps a normal cooldown.
    try {
      localStorage.setItem(`bao-fund:mintReview:${pk}`, JSON.stringify({
        [MINT_URL]: { content: 'slight skew', at: now + 10_000 },
      }));
    } catch { /* jsdom storage */ }
    expect(reviewCooldownRemainingMs(pk, MINT_URL, now)).toBe(REVIEW_COOLDOWN_MS + 10_000);
    expect(reviewCooldownRemainingMs(pk, MINT_URL, now + REVIEW_COOLDOWN_MS)).toBe(10_000);
  });

  it('is per identity and ignores malformed pubkeys', () => {
    rememberPublishedReview(pk, MINT_URL, { content: 'x' }, 1);
    expect(getPublishedReview('b'.repeat(64), MINT_URL)).toBeNull();
    expect(getPublishedReview('not-a-key', MINT_URL)).toBeNull();
    expect(reviewCooldownRemainingMs('not-a-key', MINT_URL, 2)).toBe(0);
  });
});

/** Deterministic PRNG (mulberry32) so fuzz failures reproduce exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('mint discovery - hostile-input fuzz (WS9)', () => {
  const rnd = mulberry32(0x5eed);
  const randomString = (max: number): string =>
    Array.from({ length: Math.floor(rnd() * max) }, () => String.fromCharCode(32 + Math.floor(rnd() * 95))).join('');

  it('parsers never throw and bound their output', () => {
    for (let i = 0; i < 300; i++) {
      const tags: string[][] = [];
      const tagCount = Math.floor(rnd() * 40);
      for (let t = 0; t < tagCount; t++) {
        const name = ['d', 'u', 'n', 'nuts', 'k', 'rating', randomString(6)][Math.floor(rnd() * 7)];
        tags.push([name, rnd() < 0.3 ? randomString(200) : `https://mint${Math.floor(rnd() * 50)}.example.com`]);
      }
      const content = rnd() < 0.5 ? JSON.stringify({ name: randomString(200), description: randomString(400) }) : randomString(300);
      const announceEv = ev(38172, tags, content);
      const recEv = ev(38000, tags, content);

      expect(() => parseMintAnnouncement(announceEv)).not.toThrow();
      expect(() => parseMintRecommendation(recEv)).not.toThrow();

      const a = parseMintAnnouncement(announceEv);
      if (a) {
        expect(a.mintUrl.startsWith('https://')).toBe(true);
        expect(a.nuts.length).toBeLessThanOrEqual(64);
        if (a.name) expect(a.name.length).toBeLessThanOrEqual(80);
        if (a.description) expect(a.description.length).toBeLessThanOrEqual(240);
      }
      const rec = parseMintRecommendation(recEv);
      if (rec) {
        expect(rec.mintUrls.length).toBeLessThanOrEqual(16);
        expect(rec.content.length).toBeLessThanOrEqual(500);
      }
    }
  });

  it('ranking is unique, sorted, bounded and free of test-network mints', () => {
    for (let i = 0; i < 50; i++) {
      const announcements: MintAnnouncement[] = [];
      const recs: MintRecommendation[] = [];
      for (let n = 0; n < 10; n++) {
        announcements.push({
          eventId: `a${i}-${n}`,
          createdAt: 1_700_000_000 + Math.floor(rnd() * 1_000_000),
          mintId: `m${n}`,
          mintUrl: `https://mint${Math.floor(rnd() * 8)}.example.com`,
          network: (['mainnet', 'testnet', 'signet', 'regtest', 'unknown'] as const)[Math.floor(rnd() * 5)],
          nuts: [4, 5, 7, 17],
        });
        recs.push({
          eventId: `r${i}-${n}`,
          createdAt: 1_700_000_000 + Math.floor(rnd() * 1_000_000),
          author: `${n}${'f'.repeat(63)}`.slice(-64),
          mintId: `m${n}`,
          mintUrls: [`https://mint${Math.floor(rnd() * 8)}.example.com`],
          rating: 1 + Math.floor(rnd() * 5),
          content: '',
        });
      }
      const ranked = rankDiscoveredMints(announcements, recs);
      const urls = ranked.map((m) => m.url);
      expect(new Set(urls).size).toBe(urls.length);
      for (let n = 1; n < ranked.length; n++) expect(ranked[n - 1].score).toBeGreaterThanOrEqual(ranked[n].score);
      for (const m of ranked) {
        expect(['testnet', 'signet', 'regtest']).not.toContain(m.network);
        // One review per (author, URL): distinct authors can never exceed the input authors.
        const authors = m.recommendations.map((r) => r.author.toLowerCase());
        expect(new Set(authors).size).toBe(authors.length);
      }
    }
  });
});
