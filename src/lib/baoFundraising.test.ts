import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BAO_FUNDRAISER_CREATE_KIND,
  createFundraiserRelayFirst,
  type BaoFundraiser,
  type CreateFundraiserInput,
} from './baoFundraising';

const signer = {
  signEvent: vi.fn(async (e: { kind: number; created_at: number; tags: string[][]; content: string }) => ({
    ...e,
    id: 'nip98',
    pubkey: 'pk',
    sig: 'sig',
  })),
};

type PublishFn = (t: { kind: number; content: string; tags: string[][]; relay?: string }) => Promise<{ id: string }>;

const input: CreateFundraiserInput = {
  title: 'Relay-first campaign',
  runner_type: 'agent',
  goal_sats: 21000,
  settlement_rail: 'cashu',
  milestones: [{ title: 'Ship', amount_sats: 21000 }],
};

function fundraiser(partial: Partial<BaoFundraiser>): BaoFundraiser {
  return {
    id: 'fr_1',
    title: input.title,
    description: null,
    owner_pubkey: 'pk',
    runner_type: 'agent',
    goal_sats: 21000,
    raised_sats: 0,
    status: 'open',
    settlement_rail: 'cashu',
    network: 'demo',
    created_at: new Date().toISOString(),
    ...partial,
  };
}

/** Queue fetch responses: list calls first (possibly several), then detail. */
function stubFetch(...responses: { body: unknown; ok?: boolean }[]) {
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch');
    return {
      ok: next.ok ?? true,
      json: async () => next.body,
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('createFundraiserRelayFirst', () => {
  it('publishes a kind-38003 intent with d + n tags to the ₿AO relay and returns the ingested campaign', async () => {
    const publish = vi.fn<PublishFn>(async () => ({ id: 'intent-1' }));
    stubFetch(
      // list poll: campaign present, carrying the intent id
      { body: { data: [fundraiser({ id: 'fr_relay', nostr_event_id: 'intent-1' })] } },
      // detail fetch
      {
        body: {
          data: {
            fundraiser: fundraiser({ id: 'fr_relay', nostr_event_id: 'intent-1' }),
            milestones: [{ id: 'frm_1', market_id: 'baofund-fr_relay-0' }],
          },
        },
      },
    );

    const { result, via } = await createFundraiserRelayFirst(signer, input, { publish });

    expect(via).toBe('relay');
    expect(result.fundraiser.id).toBe('fr_relay');
    expect(result.markets).toEqual([{ milestone_id: 'frm_1', market_id: 'baofund-fr_relay-0' }]);

    const template = publish.mock.calls[0][0];
    expect(template.kind).toBe(BAO_FUNDRAISER_CREATE_KIND);
    expect(template.relay).toBe('wss://relay.bao.network');
    expect(template.tags.find((t: string[]) => t[0] === 'n')).toEqual(['n', 'demo']);
    // Random d tag per intent — addressable kinds replace on (pubkey, d),
    // so a stable d would let a second intent overwrite an un-ingested one.
    expect(template.tags.find((t: string[]) => t[0] === 'd')?.[1]).toMatch(/^frc-/);
    expect(JSON.parse(template.content)).toMatchObject({ title: input.title, goal_sats: 21000 });
  });

  it('keeps polling until the campaign surfaces', async () => {
    const publish = vi.fn<PublishFn>(async () => ({ id: 'intent-2' }));
    stubFetch(
      { body: { data: [] } },
      { body: { data: [fundraiser({ id: 'fr_late', nostr_event_id: 'intent-2' })] } },
      { body: { data: { fundraiser: fundraiser({ id: 'fr_late' }), milestones: [] } } },
    );

    const { result, via } = await createFundraiserRelayFirst(signer, input, {
      publish,
      intervalMs: 1,
      timeoutMs: 1_000,
    });

    expect(via).toBe('relay');
    expect(result.fundraiser.id).toBe('fr_late');
  });

  it('falls back to the REST POST when the relay publish fails', async () => {
    const publish = vi.fn<PublishFn>(async () => {
      throw new Error('relay down');
    });
    const fetchMock = stubFetch(
      { body: { data: { fundraiser: fundraiser({ id: 'fr_rest' }), milestones: [], markets: [] } } },
    );

    const { result, via } = await createFundraiserRelayFirst(signer, input, { publish });

    expect(via).toBe('rest');
    expect(result.fundraiser.id).toBe('fr_rest');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/fundraisers');
    expect(init?.method).toBe('POST');
  });

  it('falls back to the REST POST when the campaign never surfaces within the timeout', async () => {
    const publish = vi.fn<PublishFn>(async () => ({ id: 'intent-3' }));
    // Method-aware stub: GET polls stay empty, the POST is the REST fallback.
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({ data: { fundraiser: fundraiser({ id: 'fr_rest2' }), milestones: [] } }) } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, via } = await createFundraiserRelayFirst(signer, input, {
      publish,
      intervalMs: 1,
      timeoutMs: 20,
    });

    expect(via).toBe('rest');
    expect(result.fundraiser.id).toBe('fr_rest2');
    const lastCall = fetchMock.mock.calls.at(-1)!;
    expect(lastCall[1]?.method).toBe('POST');
  });
});
