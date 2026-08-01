import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BAO_FUNDRAISER_CREATE_KIND,
  contributeToFundraiser,
  createFundraiserRelayFirst,
  fetchVerificationModels,
  fetchVerificationStats,
  fundingProgressPct,
  latestVerification,
  releaseMilestone,
  scoreMilestone,
  topUpVerificationBalance,
  type BaoFundraiser,
  type BaoMilestoneVerification,
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

describe('fetchVerificationModels', () => {
  it('normalizes the camelCase registry wire format and keeps the server default model', async () => {
    stubFetch({
      body: {
        data: {
          default_model: 'openai/gpt-5.6-sol',
          models: [
            { id: 'moonshotai/kimi-k3', label: 'Kimi K3', inputMsatsPer1M: 3_000_000, outputMsatsPer1M: 15_000_000, vision: true, tier: 'flagship' },
            { id: 'openai/gpt-5.6-sol', label: 'GPT 5.6 Sol', inputMsatsPer1M: 2_000_000, outputMsatsPer1M: 8_000_000, vision: false, tier: 'strong' },
          ],
        },
      },
    });

    const { defaultModel, models } = await fetchVerificationModels();

    // The server's configured default must survive — discarding it used to
    // initialize pickers to a model the server doesn't actually default to.
    expect(defaultModel).toBe('openai/gpt-5.6-sol');
    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      id: 'moonshotai/kimi-k3',
      name: 'Kimi K3',
      provider: 'moonshotai',
      input_msats_per_1m: 3_000_000,
      output_msats_per_1m: 15_000_000,
      vision: true,
      tier: 'flagship',
    });
    expect(models[1].vision).toBe(false);
  });

  it('falls back to the registry default when the server omits default_model', async () => {
    stubFetch({
      body: {
        data: {
          models: [
            { id: 'qwen/qwen3.7-max', name: 'Qwen 3.7 Max', provider: 'qwen', input_msats_per_1m: 1, output_msats_per_1m: 2, vision: true, tier: 'efficient' },
          ],
        },
      },
    });

    const { defaultModel, models } = await fetchVerificationModels();
    expect(defaultModel).toBe('moonshotai/kimi-k3');
    expect(models[0]).toMatchObject({ id: 'qwen/qwen3.7-max', name: 'Qwen 3.7 Max', provider: 'qwen', input_msats_per_1m: 1 });
  });
});

describe('fundingProgressPct', () => {
  it('guards against NaN when the goal is 0, missing, or non-finite', () => {
    expect(fundingProgressPct(100, 0)).toBe(0);
    expect(fundingProgressPct(100, NaN)).toBe(0);
    expect(fundingProgressPct(100, Infinity)).toBe(0);
    expect(fundingProgressPct(100, -5000)).toBe(0);
  });

  it('never returns a negative percentage', () => {
    expect(fundingProgressPct(-1000, 5000)).toBe(0);
    expect(fundingProgressPct(NaN, 5000)).toBe(0);
  });

  it('clamps at 100 and rounds normally', () => {
    expect(fundingProgressPct(6000, 5000)).toBe(100);
    expect(fundingProgressPct(2500, 5000)).toBe(50);
    expect(fundingProgressPct(1, 3)).toBe(33);
  });
});

describe('latestVerification', () => {
  const verification = (partial: Partial<BaoMilestoneVerification>): BaoMilestoneVerification => ({
    id: 1,
    milestone_id: 'm_1',
    fundraiser_id: 'fr_1',
    attempt: 1,
    model: 'moonshotai/kimi-k3',
    score: 80,
    verdict: 'pass',
    fee_msats: 500_000,
    inference_msats: 300_000,
    operator_msats: 200_000,
    input_tokens: 1000,
    output_tokens: 100,
    cost_msats: 300_000,
    evidence_hash: 'sha256:a',
    rules_hash: 'sha256:b',
    receipt_hash: null,
    nostr_event_id: null,
    job_id: null,
    created_at: '2026-07-01T00:00:00Z',
    ...partial,
  });

  it('returns null for an empty list', () => {
    expect(latestVerification([])).toBeNull();
  });

  it('picks the highest attempt even when the server returns them out of order', () => {
    const older = verification({ id: 1, attempt: 1, model: 'model/old' });
    const newer = verification({ id: 2, attempt: 2, model: 'model/new' });
    // Server order cannot be trusted — newest first here.
    expect(latestVerification([newer, older])?.model).toBe('model/new');
  });

  it('breaks attempt ties by creation time', () => {
    const first = verification({ id: 1, attempt: 1, created_at: '2026-07-01T00:00:00Z' });
    const second = verification({ id: 2, attempt: 1, created_at: '2026-07-02T00:00:00Z' });
    expect(latestVerification([second, first])?.id).toBe(2);
  });

  it('does not mutate the input list', () => {
    const list = [verification({ id: 2, attempt: 2 }), verification({ id: 1, attempt: 1 })];
    latestVerification(list);
    expect(list.map((v) => v.id)).toEqual([2, 1]);
  });
});

describe('contributeToFundraiser preferred_model', () => {
  it('sends preferred_model when a judge model is selected', async () => {
    const fetchMock = stubFetch({
      body: { data: { payment_instructions: { kind: 'demo' }, fundraiser: fundraiser({}), milestones: [] } },
    });

    await contributeToFundraiser(signer, 'fr_1', {
      amount_sats: 2_000,
      rail: 'cashu',
      idempotencyKey: 'k1',
      preferredModel: 'anthropic/claude-fable-5',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/fundraisers/fr_1/contribute');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      amount_sats: 2_000,
      rail: 'cashu',
      preferred_model: 'anthropic/claude-fable-5',
    });
  });

  it('omits preferred_model when no judge model is selected', async () => {
    const fetchMock = stubFetch({
      body: { data: { payment_instructions: { kind: 'demo' }, fundraiser: fundraiser({}), milestones: [] } },
    });

    await contributeToFundraiser(signer, 'fr_1', { amount_sats: 500, rail: 'lightning', idempotencyKey: 'k2' });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('preferred_model');
  });
});

describe('scoreMilestone', () => {
  it('posts the evidence and returns the enqueued job', async () => {
    const fetchMock = stubFetch({
      body: { data: { demo: true, job_id: 42, estimated_fee_msats: 500_000, model: 'moonshotai/kimi-k3' } },
    });

    const result = await scoreMilestone(signer, 'fr_1', 'm_1', 'see commit abc123');

    expect(result).toEqual({ job_id: 42, estimated_fee_msats: 500_000, model: 'moonshotai/kimi-k3', demo: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/fundraisers/fr_1/milestones/m_1/score');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ evidence: 'see commit abc123' });
    expect(init?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Nostr /) });
  });
});

describe('fetchVerificationStats', () => {
  it('returns fee totals, balance, and attempt history', async () => {
    const verification = {
      id: 1,
      milestone_id: 'm_1',
      fundraiser_id: 'fr_1',
      attempt: 1,
      model: 'moonshotai/kimi-k3',
      score: 87,
      verdict: 'pass',
      fee_msats: 500_000,
      inference_msats: 320_000,
      operator_msats: 200_000,
      input_tokens: 4200,
      output_tokens: 350,
      cost_msats: 320_000,
      evidence_hash: 'sha256:abc',
      rules_hash: 'sha256:def',
      receipt_hash: null,
      nostr_event_id: null,
      job_id: 42,
      created_at: new Date().toISOString(),
    };
    stubFetch({
      body: {
        data: {
          total_fees_msats: 500_000,
          verification_balance_sats: 1_000,
          verification_debt_sats: 0,
          verifications: [verification],
        },
      },
    });

    const stats = await fetchVerificationStats('fr_1');

    expect(stats.total_fees_msats).toBe(500_000);
    expect(stats.verification_balance_sats).toBe(1_000);
    expect(stats.verifications).toHaveLength(1);
    expect(stats.verifications[0]).toMatchObject({ milestone_id: 'm_1', score: 87, verdict: 'pass' });
  });
});

describe('topUpVerificationBalance', () => {
  it('posts the amount and returns the updated fundraiser', async () => {
    const fetchMock = stubFetch({
      body: { data: { demo: true, fundraiser: fundraiser({ id: 'fr_1' }) } },
    });

    const updated = await topUpVerificationBalance(signer, 'fr_1', 5_000);

    expect(updated.id).toBe('fr_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/fundraisers/fr_1/verification/topup');
    expect(JSON.parse(String(init?.body))).toEqual({ amount_sats: 5_000 });
  });
});

describe('releaseMilestone', () => {
  it('returns the itemized fee breakdown', async () => {
    stubFetch({
      body: {
        data: {
          demo: true,
          milestone: { id: 'm_1', status: 'released' },
          fundraiser: fundraiser({ id: 'fr_1' }),
          milestone_amount_sats: 10_000,
          verification_fee_msats: 500_000,
          released_sats: 9_500,
        },
      },
    });

    const result = await releaseMilestone(signer, 'fr_1', 'm_1');

    expect(result.milestone.status).toBe('released');
    expect(result.verification_fee_msats).toBe(500_000);
    expect(result.released_sats).toBe(9_500);
  });

  it('sends the idempotency key so a retry after an ambiguous failure replays server-side', async () => {
    const fetchMock = stubFetch({
      body: {
        data: {
          milestone: { id: 'm_1', status: 'released' },
          fundraiser: fundraiser({ id: 'fr_1' }),
        },
      },
    });

    await releaseMilestone(signer, 'fr_1', 'm_1', { idempotency_key: '2140:release:fr_1:m_1:abc' });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ idempotency_key: '2140:release:fr_1:m_1:abc' });
  });
});
