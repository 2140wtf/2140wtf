import { afterEach, describe, it, expect, vi } from 'vitest';

import {
  apiMarketToBaoMarket,
  baoApiFetch,
  baoApiFetchAll,
  resetBaoApiCircuit,
  type ApiMarket,
} from './baoMarketApi';

const baseApiMarket: ApiMarket = {
  id: 'baofund-fr_abc-0',
  title: 'Will Oracle dashboard deliver: prototype live by Jan 1?',
  description: 'Milestone market',
  category: 'BAO-FUND',
  type: 'binary',
  status: 'ACTIVE',
  network: 'demo',
  created_at: 1_700_000_000,
  end_date: 1_800_000_000,
  outcomes: [
    { id: 'YES', label: 'Yes', price: 0.62, volume: 100 },
    { id: 'NO', label: 'No', price: 0.38, volume: 50 },
  ],
  total_volume: 150,
  trade_count: 3,
  creator_pubkey: 'd'.repeat(64),
};

describe('apiMarketToBaoMarket', () => {
  it('maps API fields to BaoMarket (parity with the old inline mapper)', () => {
    const m = apiMarketToBaoMarket(baseApiMarket);
    expect(m.marketId).toBe(baseApiMarket.id);
    expect(m.title).toBe(baseApiMarket.title);
    expect(m.category).toBe('bao-fund');
    expect(m.state).toBe('active');
    expect(m.type).toBe('binary');
    expect(m.endTime).toBe(baseApiMarket.end_date);
    expect(m.createdAt).toBe(baseApiMarket.created_at);
    expect(m.creatorPubkey).toBe(baseApiMarket.creator_pubkey);
    expect(m.outcomes).toEqual([
      { id: 'YES', label: 'Yes', probability: 0.62, volumeSats: 100 },
      { id: 'NO', label: 'No', probability: 0.38, volumeSats: 50 },
    ]);
    expect(m.totalVolumeSats).toBe(150);
    expect(m.tradeCount).toBe(3);
    expect(m.resolution).toBeNull();
    // Without a nostr_event_id the raw event id falls back to the market id.
    expect(m.rawEvent.id).toBe(baseApiMarket.id);
  });

  it('normalizes nullable dates and rejects invalid metrics', () => {
    const m = apiMarketToBaoMarket({
      ...baseApiMarket,
      end_date: null,
      total_volume: Number.NaN,
      trade_count: -1,
      liquidity: 2140,
    });
    expect(m.endTime).toBe(0);
    expect(m.totalVolumeSats).toBeUndefined();
    expect(m.tradeCount).toBeUndefined();
    expect(m.liquiditySats).toBe(2140);
  });

  it('prefers nostr_event_id for the raw event id and carries resolution', () => {
    const m = apiMarketToBaoMarket({
      ...baseApiMarket,
      nostr_event_id: 'e'.repeat(64),
      status: 'RESOLVED',
      resolution: 'YES',
    });
    expect(m.rawEvent.id).toBe('e'.repeat(64));
    expect(m.state).toBe('resolved');
    expect(m.resolution).toBe('YES');
  });

  it('coerces non-finite prices to 0.5 and unknown types to binary', () => {
    const m = apiMarketToBaoMarket({
      ...baseApiMarket,
      type: 'weird',
      outcomes: [{ id: 'X', label: 'X', price: Number.NaN, volume: 0 }],
    });
    expect(m.type).toBe('binary');
    expect(m.outcomes[0].probability).toBe(0.5);
  });

  it('does not mark ₿AO Fund milestone markets as SMJ even when the API says so', () => {
    // Live check 2026-08-13: 18/18 `bao-fund` markets 404 the /smj/:id
    // endpoint while every other SMJ-flagged market returns 200 — the SMJ
    // service keeps no pool for milestone markets, so the API's smj flag
    // must not route them into parimutuel-odds lookups.
    const m = apiMarketToBaoMarket({
      ...baseApiMarket,
      smj: true,
      pool_model: 'smj',
    });
    expect(m.category).toBe('bao-fund');
    expect(m.poolModel).toBeUndefined();
  });

  it('maps other categories with an smj flag to poolModel smj', () => {
    const m = apiMarketToBaoMarket({
      ...baseApiMarket,
      category: 'sports',
      smj: true,
      pool_model: 'smj',
    });
    expect(m.poolModel).toBe('smj');
  });
});

describe('BAO markets API circuit breaker', () => {
  afterEach(() => {
    resetBaoApiCircuit();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Mock fetch so every call returns a JSON response with `status`. */
  function mockFetchStatus(status: number): void {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('fails fast without touching the network while the circuit is open', async () => {
    mockFetchStatus(502);

    // Three failures within the window trip the breaker.
    await expect(baoApiFetch('/markets/1')).rejects.toThrow();
    await expect(baoApiFetch('/markets/2')).rejects.toThrow();
    await expect(baoApiFetch('/markets/3')).rejects.toThrow();

    // Circuit is open — the next call must not issue a fetch at all.
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    await expect(baoApiFetch('/markets/4')).rejects.toThrow(/temporarily unavailable/);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Collection fetches degrade to an empty list while open.
    const responses = await baoApiFetchAll('/categories');
    expect(responses).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('recovers automatically after the cooldown via a half-open probe', async () => {
    vi.useFakeTimers();
    mockFetchStatus(502);

    await expect(baoApiFetch('/a')).rejects.toThrow();
    await expect(baoApiFetch('/b')).rejects.toThrow();
    await expect(baoApiFetch('/c')).rejects.toThrow();

    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    await expect(baoApiFetch('/d')).rejects.toThrow(/temporarily unavailable/);

    // Cooldown expires → one probe is allowed through; success closes the circuit.
    vi.advanceTimersByTime(61_000);
    mockFetchStatus(200);
    await expect(baoApiFetch('/ok')).resolves.toBeDefined();

    // Circuit is closed again — the very next call fetches immediately.
    fetchSpy.mockClear();
    await expect(baoApiFetch('/ok-again')).resolves.toBeDefined();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('re-trips the circuit when the half-open probe fails', async () => {
    vi.useFakeTimers();
    mockFetchStatus(502);

    await expect(baoApiFetch('/a')).rejects.toThrow();
    await expect(baoApiFetch('/b')).rejects.toThrow();
    await expect(baoApiFetch('/c')).rejects.toThrow();

    vi.advanceTimersByTime(61_000);
    // Half-open probe fails → breaker re-opens for another cooldown.
    await expect(baoApiFetch('/probe')).rejects.toThrow();

    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    await expect(baoApiFetch('/blocked')).rejects.toThrow(/temporarily unavailable/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a success resets the failure streak before it trips', async () => {
    let fail = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (fail) {
        return new Response(JSON.stringify({}), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(baoApiFetch('/a')).rejects.toThrow();
    await expect(baoApiFetch('/b')).rejects.toThrow();

    // One success between failures resets the counter — the next failure must
    // not trip the circuit on its own.
    fail = false;
    await expect(baoApiFetch('/recover')).resolves.toBeDefined();

    // One more failure after the reset is just a failed call, not a trip —
    // the following request still hits the network normally.
    fail = true;
    await expect(baoApiFetch('/c')).rejects.toThrow();
    fail = false;

    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    await expect(baoApiFetch('/still-going')).resolves.toBeDefined();
    expect(fetchSpy).toHaveBeenCalled();
  });
});
