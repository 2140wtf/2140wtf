import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MalformedOnchainReleaseError,
  contributeToFundraiser,
  contributionErrorHint,
  createFundraiser,
  fetchContributions,
  fetchScoreJobEvents,
  releaseMilestone,
  releaseOnchainMilestone,
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
    network: 'testnet',
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

describe('releaseOnchainMilestone', () => {
  const plan = {
    rail: 'l1' as const,
    payout_address: 'tb1ppayout',
    total_in_sats: 10_000,
    payout_sats: 9_500,
    fee_sats: 500,
    inputs: [{ txid: 'aa'.repeat(32), vout: 0, value_sats: 10_000, address: 'tb1pescrow', sighash: 'bb'.repeat(32), oracle_signature: 'cc'.repeat(64), judge_leaf: 'dd', control_block: 'ee' }],
  };

  it('prepares with an empty body and finalizes with the project signatures', async () => {
    const fetchMock = stubFetch(
      { body: { data: plan } },
      { body: { data: { ...plan, txid: 'ff'.repeat(32), raw_tx: '02000000aa' } } },
    );
    const prepared = await releaseOnchainMilestone(signer, 'fr_1', 'frm_1');
    expect(prepared).toEqual(plan);
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/fundraisers/fr_1/milestones/frm_1/release/onchain');
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({});

    const finalized = await releaseOnchainMilestone(signer, 'fr_1', 'frm_1', ['cc'.repeat(64)]);
    expect(finalized).toMatchObject({ txid: 'ff'.repeat(32) });
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      project_signatures: ['cc'.repeat(64)],
    });
  });

  it.each<[string, unknown]>([
    ['{}', {}],
    ['missing inputs', { rail: 'l1', payout_address: 'tb1ppayout', total_in_sats: 10_000, payout_sats: 9_500, fee_sats: 500 }],
    ['inputs not an array', { ...plan, inputs: {} }],
    ['empty inputs', { ...plan, inputs: [] }],
    ['unknown rail', { ...plan, rail: 'btc' }],
    ['input missing sighash', { ...plan, inputs: [{ ...plan.inputs[0], sighash: undefined }] }],
    ['input with a non-hex oracle signature', { ...plan, inputs: [{ ...plan.inputs[0], oracle_signature: 'not-hex' }] }],
  ])('fails closed on a malformed phase-1 plan (%s)', async (_label, body) => {
    stubFetch({ body: { data: body } });
    const err = await releaseOnchainMilestone(signer, 'fr_1', 'frm_1').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MalformedOnchainReleaseError);
    expect((err as MalformedOnchainReleaseError).code).toBe('ONCHAIN_RELEASE_MALFORMED');
    expect((err as Error).message).toMatch(/malformed/i);
  });

  it.each<[string, unknown]>([
    ['{}', {}],
    ['plan where a tx is expected', plan],
    ['tx missing raw_tx', { rail: 'l1', txid: 'ff'.repeat(32), payout_address: 'tb1ppayout', payout_sats: 9_500, fee_sats: 500 }],
    ['tx with a non-hex txid', { rail: 'l1', txid: 'nope', raw_tx: '02000000aa', payout_address: 'tb1ppayout', payout_sats: 9_500, fee_sats: 500 }],
  ])('fails closed on a malformed phase-2 tx (%s)', async (_label, body) => {
    stubFetch({ body: { data: body } });
    const err = await releaseOnchainMilestone(signer, 'fr_1', 'frm_1', ['cc'.repeat(64)]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MalformedOnchainReleaseError);
    expect((err as MalformedOnchainReleaseError).code).toBe('ONCHAIN_RELEASE_MALFORMED');
  });

  it('returns a well-formed phase-2 tx untouched', async () => {
    const tx = { rail: 'liquid' as const, txid: 'ff'.repeat(32), raw_tx: '02000000aabb', payout_address: 'lq1payout', payout_sats: 9_000, fee_sats: 500 };
    stubFetch({ body: { data: tx } });
    await expect(releaseOnchainMilestone(signer, 'fr_1', 'frm_1', ['cc'.repeat(64)])).resolves.toEqual(tx);
  });
});

describe('releaseMilestone response validation', () => {
  it('refuses a malformed 200 body (no fabricated release)', async () => {
    stubFetch({ body: {} });
    await expect(releaseMilestone(signer, 'fr_1', 'frm_1', {})).rejects.toThrow(/malformed|missing/i);
  });

  it('refuses a milestone without a status (no fabricated release)', async () => {
    stubFetch({ body: { data: { milestone: { id: 'frm_1' }, fundraiser: { id: 'fr_1' } } } });
    await expect(releaseMilestone(signer, 'fr_1', 'frm_1', {})).rejects.toThrow(/malformed|missing/i);
  });

  it('returns the milestone on a well-formed release response', async () => {
    stubFetch({ body: { data: { milestone: { id: 'frm_1', status: 'released' }, fundraiser: { id: 'fr_1' } } } });
    const out = await releaseMilestone(signer, 'fr_1', 'frm_1', {});
    expect(out.milestone.status).toBe('released');
  });

  it('accepts the cashu escrow release shape (swap awaiting project signature)', async () => {
    stubFetch({ body: { data: { demo: true, escrow_release: { swap: 'swap-token', awaiting: ['project'] } } } });
    const out = await releaseMilestone(signer, 'fr_1', 'frm_1', {});
    expect(out).toMatchObject({ escrow_release: { awaiting: ['project'] } });
  });
});

describe('Fund-only campaign creation', () => {
  it('makes one authenticated POST to the Fund endpoint', async () => {
    const fetchMock = stubFetch({ body: { data: { fundraiser: fundraiser({}), milestones: [], markets: [] } } });
    const result = await createFundraiser(signer, input);
    expect(result.fundraiser.id).toBe('fr_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${location.origin}/fund-api/v1/fundraisers`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject(input);
  });
  it('does not retry campaign creation when the Fund API fails', async () => {
    const fetchMock = stubFetch({ ok: false, body: { error: { message: 'offline' } } });
    await expect(createFundraiser(signer, input)).rejects.toThrow('offline');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('contributeToFundraiser', () => {
  it('sends the donor-supplied faucet token as cashu_token', async () => {
    const fetchMock = stubFetch({
      body: { data: { fundraiser: fundraiser({}), milestones: [], replayed: false } },
    });

    await contributeToFundraiser(signer, 'fr_1', {
      amount_sats: 1000,
      rail: 'cashu',
      cashuToken: 'cashuBo2test…',
      idempotencyKey: 'k-1',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/fr_1/contribute');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.cashu_token).toBe('cashuBo2test…');
    expect(body.rail).toBe('cashu');
    expect(body.amount_sats).toBe(1000);
  });

  it('omits cashu_token when no faucet token was claimed', async () => {
    const fetchMock = stubFetch({
      body: { data: { fundraiser: fundraiser({}), milestones: [], replayed: false } },
    });

    await contributeToFundraiser(signer, 'fr_1', {
      amount_sats: 500,
      rail: 'l1',
      idempotencyKey: 'k-2',
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.cashu_token).toBeUndefined();
    expect(body.rail).toBe('l1');
  });

  it('attaches the API error code to the thrown error', async () => {
    stubFetch({
      ok: false,
      body: {
        error: { code: 'FUNDRAISER_EXTERNAL_FUNDING_REQUIRED', message: 'This contribution rail is disabled until external funding is verified' },
      },
    });

    const err = await contributeToFundraiser(signer, 'fr_1', {
      amount_sats: 1000,
      rail: 'cashu',
      idempotencyKey: 'k-3',
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect((err as { code?: string }).code).toBe('FUNDRAISER_EXTERNAL_FUNDING_REQUIRED');
    expect((err as Error).message).toContain('external funding');
  });

  it('maps every known contribution gate code to a distinctive hint', () => {
    const cases: Array<[string, string]> = [
      ['FUNDRAISER_EXTERNAL_FUNDING_REQUIRED', 'external funding is verified'],
      ['ESCROW_NOT_CONFIGURED', 'escrow oracle'],
      ['ESCROW_KEYS_NOT_DISTINCT', 'three different keys'],
      ['ESCROW_TOKEN_INVALID', 'escrow validation'],
      ['ESCROW_PROOFS_SPENT', 'already spent'],
      ['MINT_STATE_CHECK_FAILED', 'could not confirm'],
    ];
    for (const [code, snippet] of cases) {
      const err = Object.assign(new Error('server message'), { code });
      const hint = contributionErrorHint(err);
      expect(hint, code).toContain(snippet);
      expect(hint, code).not.toBe('server message');
    }
    expect(contributionErrorHint(new Error('HTTP 503'))).toBeNull();
    expect(contributionErrorHint('not an error')).toBeNull();
  });
});

describe('fetchScoreJobEvents (hardened SSE parser)', () => {
  const validEvent = { type: 'token', job_id: 7, delta: 'x' };

  const sseResponse = (frames: string[], opts: { chunkFrames?: number } = {}): Response => {
    const body = frames.map((f) => `${f}\n\n`).join('');
    const per = opts.chunkFrames ?? frames.length; // default: one chunk
    const chunks: Uint8Array[] = [];
    const enc = new TextEncoder();
    for (let i = 0; i < body.length; i += Math.max(1, Math.ceil(body.length / Math.max(1, per)))) {
      chunks.push(enc.encode(body.slice(i, i + Math.max(1, Math.ceil(body.length / Math.max(1, per))))));
    }
    let idx = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (idx < chunks.length) controller.enqueue(chunks[idx++]);
        else controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };

  const runParser = async (res: Response) => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => res) as typeof fetch;
    try {
      return await fetchScoreJobEvents('f1', 'm1', 7);
    } finally {
      globalThis.fetch = origFetch;
    }
  };

  it('parses valid data frames from a well-behaved stream', async () => {
    const events = await runParser(
      sseResponse([`data: ${JSON.stringify(validEvent)}`, `data: ${JSON.stringify({ type: 'done', job_id: 7 })}`]),
    );
    expect(events.length).toBe(2);
    expect(events[0]).toMatchObject({ type: 'token', job_id: 7 });
  });

  it('accepts several legitimate frames arriving in ONE oversized chunk (drain-then-check order)', async () => {
    // 40 frames × ~1 KiB each = ~40 KB total in a single read chunk - larger
    // than the 32 KB frame cap combined, but every individual frame is small.
    const frames = Array.from({ length: 40 }, (_, i) => `data: ${JSON.stringify({ type: 'token', job_id: 7, delta: 'd'.repeat(900) + `-${i}` })}`);
    const events = await runParser(sseResponse(frames, { chunkFrames: 1 }));
    expect(events.length).toBe(40);
  });

  it('skips (not aborts on) a single oversized frame', async () => {
    const big = `data: ${JSON.stringify({ type: 'token', job_id: 7, delta: 'z'.repeat(40_000) })}`;
    const events = await runParser(sseResponse([big, `data: ${JSON.stringify(validEvent)}`]));
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ type: 'token', delta: 'x' });
  });

  it('aborts when an INCOMPLETE frame fragment exceeds the frame cap', async () => {
    // One giant frame with NO trailing \n\n - never complete, always illegal.
    const giant = `data: ${JSON.stringify({ type: 'token', job_id: 7, delta: 'q'.repeat(40_000) })}`;
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(giant)); // no separator - fragment forever
        controller.close();
      },
    });
    await expect(runParser(new Response(stream, { status: 200 }))).rejects.toThrow(/frame/i);
  });

  it('rejects schema-invalid frames instead of trusting them', async () => {
    const events = await runParser(
      sseResponse([
        'data: {"type":"nuke","job_id":7}',
        `data: ${JSON.stringify(validEvent)}`,
        'data: not-json',
      ]),
    );
    expect(events.length).toBe(1);
  });
});

describe('fetchContributions pagination (wave 3)', () => {
  it('pages past the 50-row default so totals and donor lookups are complete', async () => {
    const page = (offset: number, n: number) => ({
      data: Array.from({ length: n }, (_, i) => ({
        id: `c${offset + i}`,
        fundraiser_id: 'fr_1',
        contributor_pubkey: 'ab'.repeat(32),
        amount_sats: 1,
        rail: 'l1',
        status: 'confirmed',
        created_at: '2026-01-01',
        deposit_address: null,
        reference: null,
        explorer_tx_url: null,
      })),
    });
    const fetchMock = stubFetch({ body: page(0, 100) }, { body: page(100, 1) });
    const rows = await fetchContributions('fr_1');
    expect(rows).toHaveLength(101);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('limit=100');
    expect(urls[1]).toContain('offset=100');
  });
});
