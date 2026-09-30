import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SupportZap } from './SupportZap';

vi.mock('qrcode', () => ({
  default: {
    toCanvas: (_canvas: unknown, _text: string, _opts: unknown, cb?: (err: unknown) => void) => cb?.(null),
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(props: Partial<React.ComponentProps<typeof SupportZap>> = {}) {
  await act(async () => root.render(
    <SupportZap address="bao@rizful.com" title="Support BAO" blurb="Zaps keep the relay running." {...props} />,
  ));
}

it('shows the address, heading and suggested amounts', async () => {
  await render();
  const text = container.textContent ?? '';
  expect(text).toContain('Support BAO');
  expect(text).toContain('bao@rizful.com');
  expect(text).toContain('2,140');
});

it('creates a fresh invoice through the fund API LNURL proxy', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ callback: 'https://rizful.com/lnurl_two/bao/get_invoice' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ pr: 'lnbc1testinvoice' }) });
  vi.stubGlobal('fetch', fetchMock);
  await render();
  const amount = [...container.querySelectorAll('button')].find((b) => b.textContent === '2,140') as HTMLButtonElement;
  await act(async () => amount.click());
  await act(async () => {});
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(String(fetchMock.mock.calls[0]![0])).toContain('/v1/lnurl/resolve');
  expect(String(fetchMock.mock.calls[1]![0])).toContain('/v1/lnurl/invoice');
  const invoiceCall = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body)) as { callbackUrl: string; amountMsats: number };
  expect(invoiceCall.callbackUrl).toBe('https://rizful.com/lnurl_two/bao/get_invoice');
  expect(invoiceCall.amountMsats).toBe(2_140_000);
  expect(container.innerHTML).toContain('lightning:lnbc1testinvoice');
});

it('surfaces a resolve failure without crashing', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: 'Could not resolve bao@rizful.com.' } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  await render();
  const amount = [...container.querySelectorAll('button')].find((b) => b.textContent === '214') as HTMLButtonElement;
  await act(async () => amount.click());
  await act(async () => {});
  expect(container.textContent).toContain('Could not resolve bao@rizful.com.');
});
