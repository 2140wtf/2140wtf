import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MyCampaignsPanel, ownedCampaignRows } from './MyCampaignsPanel';
import type { CampaignCardDraft } from '../frames/FundingCampaignCard';

const OWNER = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

function card(over: Partial<CampaignCardDraft>): CampaignCardDraft {
  return {
    id: 'fr_1',
    title: 'Community Mesh',
    description: 'A mesh network for the neighborhood.',
    category: 'infra',
    pledgedSats: 0,
    goalSats: 0,
    endTimeSec: 1_900_000_000,
    ...over,
  };
}

it('excludes campaigns the identity does not own', () => {
  const cards = [
    card({ id: 'fr_1::m1', frId: 'fr_1', ownerPubkey: OWNER, title: 'Mesh - Milestone 1' }),
    card({ id: 'fr_2', frId: 'fr_2', ownerPubkey: OTHER, title: 'Someone else' }),
  ];
  const rows = ownedCampaignRows(cards, OWNER);
  expect(rows).toHaveLength(1);
  expect(rows[0].key).toBe('fr_1');
  expect(ownedCampaignRows(cards, null)).toEqual([]);
});

it('groups milestone cards into one campaign row and sums their amounts', () => {
  const cards = [
    card({ id: 'fr_1::m1', frId: 'fr_1', ownerPubkey: OWNER, title: 'Mesh - Milestone 1', pledgedSats: 1_000, goalSats: 2_000, status: 'released' }),
    card({ id: 'fr_1::m2', frId: 'fr_1', ownerPubkey: OWNER, title: 'Mesh - Milestone 2', pledgedSats: 500, goalSats: 3_000, status: 'unlocked' }),
    card({ id: 'fr_1::m3', frId: 'fr_1', ownerPubkey: OWNER, title: 'Mesh - Milestone 3', pledgedSats: 0, goalSats: 4_000, status: 'locked' }),
  ];
  const [row] = ownedCampaignRows(cards, OWNER);
  expect(row.title).toBe('Mesh');
  expect(row.pledgedSats).toBe(1_500);
  expect(row.goalSats).toBe(9_000);
  expect(row.milestones).toBe(3);
  expect(row.fundedMilestones).toBe(2);
  expect(row.frId).toBe('fr_1');
});

it('prefers the campaign-level card totals over summing milestone cards', () => {
  const cards = [
    card({ id: 'fr_1', frId: 'fr_1', ownerPubkey: OWNER, title: 'Community Mesh', pledgedSats: 8_000, goalSats: 10_000, frStatus: 'funded' }),
    card({ id: 'fr_1::m1', frId: 'fr_1', ownerPubkey: OWNER, title: 'Mesh - Milestone 1', pledgedSats: 4_000, goalSats: 5_000 }),
  ];
  const [row] = ownedCampaignRows(cards, OWNER);
  expect(row.pledgedSats).toBe(8_000);
  expect(row.goalSats).toBe(10_000);
  expect(row.status).toBe('funded');
});

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
});

it('renders owned rows with Manage/Chat/Ledger actions', async () => {
  const onManage = vi.fn();
  const onChat = vi.fn();
  const onLedger = vi.fn();
  const cards = [
    card({ id: 'fr_1::m1', frId: 'fr_1', ownerPubkey: OWNER, title: 'Mesh - Milestone 1', pledgedSats: 1_000, goalSats: 2_000, status: 'unlocked', roomAvailable: true }),
  ];
  await act(async () => root.render(
    <MyCampaignsPanel cards={cards} pubkey={OWNER} onCreate={vi.fn()} onManage={onManage} onChat={onChat} onLedger={onLedger} />,
  ));
  expect(container.querySelectorAll('[data-testid=my-campaign-row]')).toHaveLength(1);
  const buttons = [...container.querySelectorAll('button')];
  expect(buttons.some((b) => b.textContent === 'Manage')).toBe(true);
  await act(async () => { buttons.find((b) => b.textContent === 'Manage')!.click(); });
  expect(onManage).toHaveBeenCalledWith(expect.objectContaining({ key: 'fr_1', frId: 'fr_1' }));
  await act(async () => { buttons.find((b) => b.textContent === 'Chat')!.click(); });
  expect(onChat).toHaveBeenCalled();
  await act(async () => { buttons.find((b) => b.textContent === 'Ledger')!.click(); });
  expect(onLedger).toHaveBeenCalled();
});

it('shows the empty state with a create action when the founder owns nothing', async () => {
  const onCreate = vi.fn();
  await act(async () => root.render(
    <MyCampaignsPanel cards={[]} pubkey={OWNER} onCreate={onCreate} onManage={vi.fn()} onChat={vi.fn()} onLedger={vi.fn()} />,
  ));
  expect(container.textContent).toContain('No campaigns owned');
  await act(async () => { container.querySelector<HTMLButtonElement>('button')!.click(); });
  expect(onCreate).toHaveBeenCalled();
});

it('asks signed-out viewers to sign in', async () => {
  await act(async () => root.render(
    <MyCampaignsPanel cards={[]} pubkey={null} onCreate={vi.fn()} onManage={vi.fn()} onChat={vi.fn()} onLedger={vi.fn()} />,
  ));
  expect(container.textContent).toContain('Sign in to manage your campaigns');
});
