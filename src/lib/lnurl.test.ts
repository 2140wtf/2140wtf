import { describe, expect, it, vi } from 'vitest';

import { fetchLnurlInvoice, resolveLnurlPay } from '@/lib/lnurl';

describe('LNURL public endpoint validation', () => {
  it('rejects a private HTTPS lud16 host before fetching', async () => {
    const fetchMock = vi.fn();

    await expect(resolveLnurlPay({ lud16: 'alice@localhost' }, fetchMock as typeof fetch))
      .rejects.toThrow('no lightning address');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a wallet callback that targets the local network', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag: 'payRequest',
      callback: 'https://127.0.0.1/pay',
      minSendable: 1_000,
      maxSendable: 100_000,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(resolveLnurlPay({ lud16: 'alice@example.com' }, fetchMock as typeof fetch))
      .rejects.toThrow("doesn't accept payments");
  });

  it('rejects an unsafe callback supplied to invoice fetching', async () => {
    const fetchMock = vi.fn();
    const params = {
      callback: 'https://localhost/pay',
      minSendable: 1_000,
      maxSendable: 100_000,
      commentAllowed: 0,
      allowsNostr: false,
    };

    await expect(fetchLnurlInvoice(params, { amountMsats: 1_000 }, fetchMock as typeof fetch))
      .rejects.toThrow('public HTTPS URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
