import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EscrowAddressQR } from './EscrowAddressQR';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const ADDRESS = 'tb1pcxtqgve9y3hnfkfs3cwrm02d48qaaetjsjl78tpem0rvxpxxyeuqtrg6t4';

async function render(props: React.ComponentProps<typeof EscrowAddressQR>) {
  await act(async () => root.render(<EscrowAddressQR {...props} />));
}

it('renders the escrow address as an SVG data-URL QR', async () => {
  await render({ address: ADDRESS });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=escrow-address-qr]')).toBeTruthy();
  }, { timeout: 5000 });
  const img = container.querySelector('[data-testid=escrow-address-qr]') as HTMLImageElement;
  expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  expect(img.getAttribute('alt')).toContain(ADDRESS);
});

it('shows the caption under the code', async () => {
  await render({ address: ADDRESS, caption: 'Scan with your testnet wallet' });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=escrow-address-qr]')).toBeTruthy();
  }, { timeout: 5000 });
  expect(container.textContent).toContain('Scan with your testnet wallet');
});

it('fails gracefully instead of throwing on an empty address', async () => {
  await render({ address: '' });
  await vi.waitFor(() => {
    expect(container.textContent).toContain('QR unavailable');
  }, { timeout: 5000 });
});
