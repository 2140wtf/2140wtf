import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LightningInvoice } from './LightningInvoice';

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
  // @ts-expect-error remove the per-test clipboard stub
  delete navigator.clipboard;
});

const INVOICE = `lnbc21u1p${'q'.repeat(80)}`;

async function render(props: React.ComponentProps<typeof LightningInvoice>) {
  await act(async () => root.render(<LightningInvoice {...props} />));
}

it('renders the bolt11 invoice as an SVG data-URL QR', async () => {
  await render({ invoice: INVOICE, amountSats: 21 });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=lightning-invoice-qr]')).toBeTruthy();
  }, { timeout: 5000 });
  const img = container.querySelector('[data-testid=lightning-invoice-qr]') as HTMLImageElement;
  expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  expect(container.textContent).toContain('Copy invoice');
});

it('offers copy and open-in-wallet for external wallets', async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await render({ invoice: INVOICE });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=lightning-invoice-qr]')).toBeTruthy();
  }, { timeout: 5000 });

  const link = container.querySelector('a[href^="lightning:"]') as HTMLAnchorElement;
  expect(link.getAttribute('href')).toBe(`lightning:${INVOICE}`);

  const copy = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Copy invoice'));
  await act(async () => copy?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(writeText).toHaveBeenCalledWith(INVOICE);
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Copied');
  });
});

it('shows status and error lines and degrades on an empty invoice', async () => {
  await render({ invoice: INVOICE, status: 'waiting for payment…' });
  expect(container.textContent).toContain('waiting for payment…');

  await render({ invoice: INVOICE, error: 'mint unreachable' });
  expect(container.textContent).toContain('mint unreachable');

  await render({ invoice: '' });
  expect(container.textContent).toContain('No invoice to show yet.');
});
