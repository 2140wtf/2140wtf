import { afterEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import { MILESTONE_VERDICT_KIND, fetchMilestoneVerdicts, latestVerdicts, parseVerdictEvent, verdictVerifierFromConfig, verdictVerifierPubkey } from './verdictFeed';

const SK = generateSecretKey();
const PUB = getPublicKey(SK);

const mocks = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn() }));

vi.mock('@/baofund/community/websocket.js', () => ({
  WebRelayConn: class {
    query(...args: unknown[]) {
      return mocks.query(...args);
    }
    close() {
      mocks.close();
    }
  },
}));

function verdictEvent(opts: {
  attempt?: number;
  score?: number;
  verdict?: string;
  createdAt?: number;
  secretKey?: Uint8Array;
  fundraiser?: string;
  milestone?: string;  evidenceHash?: string;
  omitTags?: string[];
  rawContent?: string;
  }): NostrEvent {
  const tags: string[][] = [
    ['d', 'mk_1'],
    ['fundraiser', opts.fundraiser ?? 'fr_1'],
    ['milestone', opts.milestone ?? 'm1'],
    ['score', String(opts.score ?? 90)],
    ['attempt', String(opts.attempt ?? 1)],
    ['evidence_hash', opts.evidenceHash ?? 'a'.repeat(64)],
    ['model', 'deepseek-v4-flash'],
  ];
  if (opts.verdict) tags.push(['verdict', opts.verdict]);
  const filtered = (opts.omitTags ?? []).length
    ? tags.filter((t) => !(opts.omitTags as string[]).includes(t[0]))
    : tags;
  return finalizeEvent(
    {
      kind: MILESTONE_VERDICT_KIND,
      created_at: opts.createdAt ?? 1_700_000_000,
      tags: filtered,
      content: opts.rawContent ?? JSON.stringify({ verdict: opts.verdict ?? 'pass', score: opts.score ?? 90, model: 'deepseek-v4-flash' }),
    },
    opts.secretKey ?? SK,
  ) as unknown as NostrEvent;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('parseVerdictEvent', () => {
  it('parses a signed verdict from a pinned signer', () => {
    const v = parseVerdictEvent(verdictEvent({ attempt: 2, score: 95, verdict: 'pass' }), PUB);
    expect(v).toMatchObject({
      signer: PUB,
      fundraiserId: 'fr_1',
      milestoneId: 'm1',
      marketId: 'mk_1',
      score: 95,
      attempt: 2,
      verdict: 'pass',
      model: 'deepseek-v4-flash',
    });
  });

  it('rejects a non-pinned author, a wrong kind and a tampered signature', () => {
    const otherPub = getPublicKey(generateSecretKey());
    expect(parseVerdictEvent(verdictEvent({}), otherPub)).toBeNull();
    const wrongKind = { ...verdictEvent({}), kind: 38037 } as NostrEvent;
    expect(parseVerdictEvent(wrongKind, PUB)).toBeNull();
    const tampered = { ...verdictEvent({}), content: JSON.stringify({ verdict: 'fail' }) } as NostrEvent;
    expect(parseVerdictEvent(tampered, PUB)).toBeNull();
  });

  it('accepts any author when no pin is given (caller must pin)', () => {
    expect(parseVerdictEvent(verdictEvent({}), null)).not.toBeNull();
  });

  it('never throws for non-object content and falls back to the verdict tag', () => {
    for (const rawContent of ['null', '[]', '"pass"', '42']) {
      expect(() => parseVerdictEvent(verdictEvent({ rawContent, verdict: 'pass' }), PUB)).not.toThrow();
      expect(parseVerdictEvent(verdictEvent({ rawContent, verdict: 'pass' }), PUB)?.verdict).toBe('pass');
    }
    // Without a verdict tag there is nothing to read - null, still no throw.
    expect(parseVerdictEvent(verdictEvent({ rawContent: 'null' }), PUB)?.verdict ?? null).toBeNull();
  });

  it('normalizes sha256:-prefixed evidence hashes to bare lowercase hex', () => {
    const prefixed = parseVerdictEvent(verdictEvent({ evidenceHash: `sha256:${'A'.repeat(64)}` }), PUB);
    expect(prefixed?.evidenceHash).toBe('a'.repeat(64));
    const bare = parseVerdictEvent(verdictEvent({ evidenceHash: 'a'.repeat(64) }), PUB);
    expect(bare?.evidenceHash).toBe('a'.repeat(64));
    const unknown = parseVerdictEvent(verdictEvent({ evidenceHash: 'ipfs:Qm123' }), PUB);
    expect(unknown?.evidenceHash).toBe('ipfs:Qm123');
  });

  it('does not coerce a missing score/attempt tag to 0', () => {
    const noScore = parseVerdictEvent(verdictEvent({ score: 42, omitTags: ['score'] }), PUB);
    expect(noScore?.score).toBe(42); // falls back to the content body
    const noAttempt = parseVerdictEvent(verdictEvent({ omitTags: ['attempt'] }), PUB);
    expect(noAttempt?.attempt).toBeNull();
    const noBoth = parseVerdictEvent(verdictEvent({ score: 0, omitTags: ['score', 'attempt'] }), PUB);
    expect(noBoth?.score).toBe(0); // a real zero in content is still zero
    expect(noBoth?.attempt).toBeNull();
  });
});

describe('latestVerdicts', () => {
  it('keeps the highest attempt, then the newest, per fundraiser+milestone', () => {
    const older = verdictEvent({ attempt: 1, createdAt: 1_700_000_100 });
    const retry = verdictEvent({ attempt: 2, createdAt: 1_700_000_200, verdict: 'fail' });
    const sameAttemptNewer = verdictEvent({ attempt: 2, createdAt: 1_700_000_300, verdict: 'pass' });
    const latest = latestVerdicts([older, retry, sameAttemptNewer], PUB);
    expect(latest).toHaveLength(1);
    expect(latest[0].attempt).toBe(2);
    expect(latest[0].verdict).toBe('pass');
  });

  it('separates different milestones and drops unpinned events', () => {
    const other = verdictEvent({ milestone: 'm1', secretKey: generateSecretKey() });
    const m2 = verdictEvent({ milestone: 'm2' });
    const latest = latestVerdicts([other, m2], PUB);
    expect(latest).toHaveLength(1);
    expect(latest[0].milestoneId).toBe('m2');
  });

  it('skips a pinned event whose content is not a JSON object instead of poisoning the read', () => {
    const malformed = verdictEvent({ rawContent: 'null' });
    const good = verdictEvent({ attempt: 3, verdict: 'pass' });
    const one = verdictEvent({ attempt: 1, verdict: 'fail', createdAt: 1_700_000_100 });
    expect(() => latestVerdicts([malformed, one, good], PUB)).not.toThrow();
    const latest = latestVerdicts([malformed, one, good], PUB);
    expect(latest).toHaveLength(1);
    expect(latest[0].eventId).toBe(good.id);
  });
});

describe('fetchMilestoneVerdicts', () => {
  it('queries by kind and author pin, applying an optional market filter', async () => {
    mocks.query.mockResolvedValue([verdictEvent({})]);
    const result = await fetchMilestoneVerdicts('wss://relay.invalid', { verifierPubkey: PUB, marketId: 'mk_1' });
    expect(mocks.query).toHaveBeenCalledWith(
      { kinds: [MILESTONE_VERDICT_KIND], authors: [PUB], '#d': ['mk_1'] },
      expect.any(Number),
    );
    expect(result).toHaveLength(1);
    expect(mocks.close).toHaveBeenCalled();
  });

  it('returns [] and still closes when the relay fails', async () => {
    mocks.query.mockRejectedValue(new Error('connection refused'));
    await expect(fetchMilestoneVerdicts('wss://relay.invalid', { verifierPubkey: PUB })).resolves.toEqual([]);
    expect(mocks.close).toHaveBeenCalled();
  });

  it('refuses an empty/malformed verifier pin instead of accepting any author', async () => {
    // An unpinned read is a fail-open: parseVerdictEvent treats an empty
    // expectedSigner as "any author" (by design for display), so the fetch
    // gate must reject the pin BEFORE querying.
    mocks.query.mockResolvedValue([verdictEvent({ secretKey: generateSecretKey() })]);
    await expect(fetchMilestoneVerdicts('wss://relay.invalid', { verifierPubkey: '' })).resolves.toEqual([]);
    await expect(fetchMilestoneVerdicts('wss://relay.invalid', { verifierPubkey: 'not-hex' })).resolves.toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe('parseVerdictEvent robustness (fuzz)', () => {
  it('never throws on 50 randomly shaped signed events', () => {
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const pool: unknown[] = [0, 1, 'pass', 'fail', '', '  ', 'a'.repeat(64), `sha256:${'b'.repeat(64)}`, 91, 1e21, {}, [], null];
    const names = ['d', 'm', 'score', 'attempt', 'verdict', 'evidence_hash', 'model', 'fundraiser', 'milestone'];
    for (let i = 0; i < 50; i++) {
      const tagCount = Math.floor(rand() * 8);
      const tags: string[][] = [];
      for (let t = 0; t < tagCount; t++) {
        const name = names[Math.floor(rand() * names.length)];
        const value = pool[Math.floor(rand() * pool.length)];
        tags.push(value === undefined ? [name] : [name, String(value)]);
      }
      const ev = finalizeEvent(
        {
          kind: MILESTONE_VERDICT_KIND,
          created_at: Math.floor(rand() * 1e9),
          tags,
          content: String(pool[Math.floor(rand() * pool.length)] ?? ''),
        },
        SK,
      ) as unknown as NostrEvent;
      expect(() => parseVerdictEvent(ev, PUB)).not.toThrow();
      expect(() => parseVerdictEvent(ev, null)).not.toThrow();
      expect(() => latestVerdicts([ev, ev], PUB)).not.toThrow();
    }
  }, 20_000);
});

describe('verdictVerifierFromConfig', () => {  it('reads a valid pin and rejects missing/invalid values', () => {
    expect(verdictVerifierFromConfig(PUB)).toBe(PUB.toLowerCase());
    expect(verdictVerifierFromConfig(undefined)).toBeNull();
    expect(verdictVerifierFromConfig('nope')).toBeNull();
  });

  it('reads nothing from an unconfigured environment', () => {
    expect(verdictVerifierPubkey()).toBeNull();
  });
});
