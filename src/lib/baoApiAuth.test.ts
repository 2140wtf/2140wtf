import { describe, expect, it, vi } from 'vitest';

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
});
