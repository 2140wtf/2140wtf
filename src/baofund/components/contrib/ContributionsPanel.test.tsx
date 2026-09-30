// src/components/contrib/ContributionsPanel.test.tsx
//
// Render-safety tests for the contribution book. The API boundary is mocked:
// a 200 carrying a non-array payload must render an error state, never throw
// during render (the old `rows.reduce` crash).

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchContributions: vi.fn(), fetchFundraiser: vi.fn() }));

vi.mock('../../lib/baoFundraising', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/baoFundraising')>();
  return {
    ...actual,
    fetchContributions: (...args: unknown[]) => mocks.fetchContributions(...args),
    fetchFundraiser: (...args: unknown[]) => mocks.fetchFundraiser(...args),
  };
});

import { ContributionsPanel } from './ContributionsPanel';

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

it('renders an error state (never crashes) when the 200 payload is not an array', async () => {
  mocks.fetchContributions.mockResolvedValue({ rows: [], total: 3 });
  mocks.fetchFundraiser.mockRejectedValue(new Error('title lookup down'));

  await act(async () => root.render(<ContributionsPanel campaignIds={['fr_1']} />));
  // Flush the fetch microtask chain.
  await act(async () => {
    await Promise.resolve();
  });

  expect(container.textContent).toContain('Failed to load');
  expect(container.textContent).not.toContain('No contributions yet');
});

it('renders valid rows and totals', async () => {
  mocks.fetchContributions.mockResolvedValue([
    {
      id: 1,
      fundraiser_id: 'fr_1',
      contributor_pubkey: 'ab'.repeat(32),
      amount_sats: 21,
      rail: 'l1',
      reference: null,
      created_at: '2026-01-01T00:00:00Z',
      status: 'confirmed',
    },
  ]);
  mocks.fetchFundraiser.mockResolvedValue({ fundraiser: { title: 'Test campaign' }, milestones: [] });

  await act(async () => root.render(<ContributionsPanel campaignIds={['fr_1']} />));
  await act(async () => {
    await Promise.resolve();
  });

  expect(container.textContent).toContain('Test campaign');
  expect(container.textContent).toContain('21');
  expect(container.textContent).toContain('confirmed');
});

it('flips the row state for refunded and refund-pending contributions', async () => {
  mocks.fetchContributions.mockResolvedValue([
    {
      id: 1,
      fundraiser_id: 'fr_1',
      contributor_pubkey: 'ab'.repeat(32),
      amount_sats: 21,
      rail: 'cashu',
      reference: null,
      created_at: '2026-01-01T00:00:00Z',
      status: 'escrowed',
      refunded_at: '2026-01-02T00:00:00Z',
      refund_initiated_at: '2026-01-01T12:00:00Z',
    },
    {
      id: 2,
      fundraiser_id: 'fr_1',
      contributor_pubkey: 'cd'.repeat(32),
      amount_sats: 5,
      rail: 'cashu',
      reference: null,
      created_at: '2026-01-01T00:00:00Z',
      status: 'escrowed',
      refunded_at: null,
      refund_initiated_at: '2026-01-01T12:00:00Z',
    },
  ]);
  mocks.fetchFundraiser.mockResolvedValue({ fundraiser: { title: 'Refunded campaign' }, milestones: [] });

  await act(async () => root.render(<ContributionsPanel campaignIds={['fr_1']} />));
  await act(async () => {
    await Promise.resolve();
  });

  // The row status never flips server-side; the refund markers must.
  expect(container.textContent).toContain('refunded');
  expect(container.textContent).toContain('refund pending');
  expect(container.textContent).not.toContain('escrowed ✓');
  // Gross total keeps the refunded row (matching the API's raised_sats) and
  // breaks the refunded slice out.
  expect(container.textContent).toContain('(21 refunded)');
  expect(container.textContent).toContain('26 sats');
});
