import { afterEach, describe, expect, it, vi } from 'vitest';

import { baoNip98Header, type BaoApiSigner } from './baoApiAuth';

function signer() {
  return {
    signEvent: vi.fn(async (event) => ({
      ...event,
      id: '1'.repeat(64),
      pubkey: '2'.repeat(64),
      sig: '3'.repeat(128),
    })),
  } satisfies BaoApiSigner;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('baoNip98Header', () => {
  it('binds POST authorization to the exact JSON payload', async () => {
    const testSigner = signer();
    await baoNip98Header(testSigner, 'https://bao.example/v1/contribute', 'POST', '{"rail":"cashu"}');

    const event = testSigner.signEvent.mock.calls[0][0];
    expect(event.tags).toContainEqual(['method', 'POST']);
    expect(event.tags).toContainEqual([
      'payload',
      '88834cdbd61ad85fc95839f7c0c01e1b84ff431c15cdb91c1899238b1fbb38e9',
    ]);
  });

  it('does not reuse authorization across different contribution bodies', async () => {
    const testSigner = signer();
    const url = 'https://bao.example/v1/contribute';
    await baoNip98Header(testSigner, url, 'POST', '{"amount_sats":1000}');
    await baoNip98Header(testSigner, url, 'POST', '{"amount_sats":2000}');

    expect(testSigner.signEvent).toHaveBeenCalledTimes(2);
  });

  it('signs every repeated request because the server consumes each event ID', async () => {
    const testSigner = signer();
    const url = 'https://bao.example/v1/wallet/balance';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00Z'));

    const firstHeader = await baoNip98Header(testSigner, url, 'GET');
    const secondHeader = await baoNip98Header(testSigner, url, 'GET');

    expect(testSigner.signEvent).toHaveBeenCalledTimes(2);
    const firstNonce = testSigner.signEvent.mock.calls[0][0].tags.find(([name]) => name === 'nonce');
    const secondNonce = testSigner.signEvent.mock.calls[1][0].tags.find(([name]) => name === 'nonce');
    expect(firstNonce?.[1]).toBeTruthy();
    expect(secondNonce?.[1]).toBeTruthy();
    expect(secondNonce?.[1]).not.toBe(firstNonce?.[1]);
    expect(secondHeader).not.toBe(firstHeader);
  });
});
