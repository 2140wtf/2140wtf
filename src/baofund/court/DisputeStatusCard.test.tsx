import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DisputeStatusCard } from './DisputeStatusCard';
import type { DisputeStatusView } from '../lib/court/disputeStatus';

const NOW = 1_800_000_000;
const ME = 'b'.repeat(64);
const OTHER = 'c'.repeat(64);
const DISPUTE_ID = 'd'.repeat(64);
const WINNER = 'e'.repeat(64);

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

function status(terminal: DisputeStatusView['terminal']): DisputeStatusView {
  return {
    dispute: {
      disputeId: DISPUTE_ID,
      author: ME,
      marketId: 'escrow:fr_probe::m1',
      escrowId: 'fr_probe',
      challengerPubkey: ME,
      respondentPubkey: OTHER,
      proposedOutcome: ME,
      originalOutcome: 'refund',
      evidenceHashes: [],
      openedAt: NOW - 100,
      deadline: NOW + 100,
    },
    phases: [
      { phase: 'dispute', startsAt: NOW - 100, endsAt: NOW + 100 },
      { phase: 'vote-commit', startsAt: NOW + 100, endsAt: NOW + 200 },
    ],
    activePhase: 'dispute',
    canStillResolveInTime: false,
    terminal,
  };
}

async function render(view: DisputeStatusView, viewerRole: 'donor' | 'founder', myPubkey: string | null = ME, onExecute?: () => void) {
  await act(async () => root.render(
    <DisputeStatusCard status={view} now={NOW} myPubkey={myPubkey} viewerRole={viewerRole} onExecute={onExecute} />,
  ));
}

it('uses the VIEWER role for the refund-race copy (not the challenger side)', async () => {
  // The founder filed the dispute: donor copy would be a lie to them.
  await render(status({ kind: 'active' }), 'founder');
  const founderText = container.textContent ?? '';
  expect(founderText).toContain('the refund wins and the escrow closes');
  expect(founderText).not.toContain('your pledge refunds automatically');

  await act(async () => root.unmount());
  root = createRoot(container);
  await render(status({ kind: 'active' }), 'donor');
  const donorText = container.textContent ?? '';
  expect(donorText).toContain('your pledge refunds automatically');
});

it('renders parties as words; raw ids stay in attributes only', async () => {
  await render(status({ kind: 'active' }), 'donor');
  const text = container.textContent ?? '';
  expect(text).toContain('filed by you');
  expect(text).toContain('proposed winner you');
  expect(text).not.toContain(DISPUTE_ID);
  expect(text).not.toContain(DISPUTE_ID.slice(0, 10));
  expect(text).not.toContain(ME);
  expect(text).not.toContain(OTHER);
  // The ids survive in tooltips/data attributes for support workflows.
  expect(container.querySelector('[data-dispute]')?.getAttribute('data-dispute')).toBe(DISPUTE_ID.slice(0, 12));
  expect(container.querySelector('[data-dispute]')?.getAttribute('title')).toContain(DISPUTE_ID);
});

it('shows the verified winner as a party and gates Execute to the winner', async () => {
  let executed = 0;
  await render(status({ kind: 'verdict', winnerPubkey: ME, attestationEventId: 'f'.repeat(64) }), 'donor', ME, () => { executed += 1; });
  expect(container.textContent).toContain('winner you');
  expect(container.textContent).not.toContain(ME);
  const button = container.querySelector('.dispute-execute') as HTMLButtonElement | null;
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  expect(executed).toBe(1);

  await act(async () => root.unmount());
  root = createRoot(container);
  await render(status({ kind: 'verdict', winnerPubkey: WINNER, attestationEventId: 'f'.repeat(64) }), 'donor', ME, () => { executed += 1; });
  expect(container.textContent).toContain('winner the counterparty');
  expect(container.querySelector('.dispute-execute')).toBeNull();
});
