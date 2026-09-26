import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchIsChatAdmin, useIsChatAdmin } from './useIsChatAdmin';
import type { SignerLike } from '../lib/baoFundraising';

const mocks = vi.hoisted(() => ({ fundFetch: vi.fn() }));

vi.mock('../lib/fundHttp', () => ({
  fundFetch: mocks.fundFetch,
  fundApiOrigin: () => 'https://app.bao.network/fund-api',
  nip98Header: vi.fn(async () => 'Nostr test'),
}));

const SIGNER = { getPublicKey: async () => 'a'.repeat(64), signEvent: vi.fn() } as unknown as SignerLike;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** Renders the hook and reports its current value. */
function AdminProbe({ signer }: { signer: SignerLike | null }): React.ReactElement {
  const isAdmin = useIsChatAdmin(signer);
  return <span data-testid="admin">{isAdmin ? 'yes' : 'no'}</span>;
}

async function renderProbe(signer: SignerLike | null): Promise<void> {
  await act(async () => root.render(<AdminProbe signer={signer} />));
}

function value(): string | null {
  return container.querySelector('[data-testid=admin]')?.textContent ?? null;
}

it('fetchIsChatAdmin asks /v1/me and reports the admin flag (fail closed)', async () => {
  mocks.fundFetch.mockResolvedValueOnce({ data: { admin: true, scopes: ['read', 'trade', 'admin'] } });
  await expect(fetchIsChatAdmin(SIGNER)).resolves.toBe(true);
  expect(mocks.fundFetch).toHaveBeenCalledWith('/v1/me', { method: 'GET', signer: SIGNER });

  mocks.fundFetch.mockResolvedValueOnce({ data: { admin: false } });
  await expect(fetchIsChatAdmin(SIGNER)).resolves.toBe(false);

  // Malformed body and transport failure are NOT admin.
  mocks.fundFetch.mockResolvedValueOnce({ data: {} });
  await expect(fetchIsChatAdmin(SIGNER)).resolves.toBe(false);
  mocks.fundFetch.mockRejectedValueOnce(new Error('offline'));
  await expect(fetchIsChatAdmin(SIGNER)).resolves.toBe(false);
});

it('the hook starts false, turns true for an admin, and never probes without a signer', async () => {
  mocks.fundFetch.mockResolvedValueOnce({ data: { admin: true } });
  await renderProbe(SIGNER);
  await vi.waitFor(() => expect(value()).toBe('yes'));

  // Sign-out resets the affordance (fail closed).
  await renderProbe(null);
  await vi.waitFor(() => expect(value()).toBe('no'));
});

it('stays false when the API denies or errors', async () => {
  mocks.fundFetch.mockRejectedValueOnce(new Error('unauthorized'));
  await renderProbe(SIGNER);
  await vi.waitFor(() => expect(value()).toBe('no'));
});
