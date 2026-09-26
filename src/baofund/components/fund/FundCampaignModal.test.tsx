import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FundCampaignModal } from './FundCampaignModal';
import type { CampaignBreakdown } from './campaignBreakdown';

let container: HTMLDivElement;
let root: Root;

const breakdown = (over: Partial<CampaignBreakdown> = {}): CampaignBreakdown => ({
  key: 'fr_1',
  frId: 'fr_1',
  title: 'Agent Memory Vault',
  description: 'Portable encrypted memory for agents.',
  goalSats: 600_000,
  raisedSats: 150_000,
  runner: 'Agent + Human',
  rail: 'cashu',
  frStatus: 'open',
  ownerPubkey: 'ab'.repeat(32),
  milestones: [
    { id: 'm1', title: 'Vault format + reference server', description: 'Versioned records.', criteria: 'Byte-identical recall.', amountSats: 150_000, status: 'unlocked', deadlineAt: 1_800_000_000, marketId: 'mk_1' },
    { id: 'm2', title: 'Nostr sync + conflict resolution', description: 'Giftwrapped deltas.', criteria: null, amountSats: 200_000, status: 'locked', deadlineAt: 1_800_000_000, marketId: null },
  ],
  ...over,
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

async function render(campaign: CampaignBreakdown, props: Record<string, unknown> = {}) {
  await act(async () => root.render(
    <FundCampaignModal campaign={campaign} nowSec={1_700_000_000} onClose={() => {}} {...props} />,
  ));
}

it('renders every milestone with its description, criteria, amount and status', async () => {
  await render(breakdown());
  const rows = container.querySelectorAll('[data-testid=milestone-breakdown] li');
  expect(rows).toHaveLength(2);
  const text = container.textContent ?? '';
  expect(text).toContain('Vault format + reference server');
  expect(text).toContain('Byte-identical recall.');
  expect(text).toContain('150,000');
  expect(text).toContain('Funded');
  expect(text).toContain('Awaiting funds');
});

it('reserves the dispute slot to donors only', async () => {
  const slot = vi.fn(() => <span data-testid="court-slot">court</span>);
  await render(breakdown({ isContributor: false }), { disputeSlot: slot });
  expect(container.querySelector('[data-testid=court-slot]')).toBeNull();
  expect(slot).not.toHaveBeenCalled();

  await render(breakdown({ isContributor: true }), { disputeSlot: slot });
  expect(container.querySelectorAll('[data-testid=court-slot]')).toHaveLength(2);
});

it('funds milestones through the campaign id, never the composite card id', async () => {
  const onFund = vi.fn();
  await render(breakdown(), { onFund });
  const fund = [...container.querySelectorAll('button')].find((b) => /Fund this project/i.test(b.textContent) && !/\(testnet\)/i.test(b.textContent));
  await act(async () => fund?.click());
  expect(onFund).toHaveBeenCalledWith('fr_1');
});

it('offers the campaign-level fund action at the bottom of the breakdown', async () => {
  const onFund = vi.fn();
  await render(breakdown(), { onFund, fundLabel: 'Fund this project (testnet)' });
  const bottom = [...container.querySelectorAll('button')].find((b) => /Fund this project \(testnet\)/i.test(b.textContent));
  expect(bottom).toBeTruthy();
  await act(async () => bottom?.click());
  expect(onFund).toHaveBeenCalledWith('fr_1');
});
