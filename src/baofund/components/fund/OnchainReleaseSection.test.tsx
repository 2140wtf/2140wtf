import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { OnchainReleaseSection } from './OnchainReleaseSection';

const mocks = vi.hoisted(() => ({ release: vi.fn() }));
vi.mock('../../lib/baoFundraising', () => ({
  releaseOnchainMilestone: (...args: unknown[]) => mocks.release(...args),
}));

let container: HTMLDivElement;
let root: Root;

const PLAN = {
  rail: 'l1' as const,
  payout_address: 'tb1ppayout',
  total_in_sats: 10_000,
  payout_sats: 9_500,
  fee_sats: 500,
  inputs: [
    { txid: 'aa'.repeat(32), vout: 0, value_sats: 10_000, address: 'tb1pescrow', sighash: '11'.repeat(32), oracle_signature: 'cc'.repeat(64), judge_leaf: 'dd', control_block: 'ee' },
    { txid: 'bb'.repeat(32), vout: 1, value_sats: 5_000, address: 'tb1pescrow2', sighash: '22'.repeat(32), oracle_signature: 'cc'.repeat(64), judge_leaf: 'dd', control_block: 'ee' },
  ],
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function signerWithSchnorr() {
  const signSchnorr = vi.fn(async (hash: string) => `sig-${hash.slice(0, 4)}`);
  return { signEvent: vi.fn(), signSchnorr };
}

it('prepares, schnorr-signs every input, and shows the assembled raw tx', async () => {
  const signer = signerWithSchnorr();
  mocks.release
    .mockResolvedValueOnce(PLAN)
    .mockResolvedValueOnce({ ...PLAN, txid: 'ff'.repeat(32), raw_tx: '02000000aabb', explorer_tx_url: 'https://explorer/tx/ff' });
  await act(async () => root.render(
    <OnchainReleaseSection fundraiserId="fr_1" milestoneId="frm_1" signer={signer} />,
  ));
  const button = [...container.querySelectorAll('button')].find((b) => /Release \(on-chain\)/i.test(b.textContent ?? ''));
  await act(async () => button!.click());
  expect(container.querySelector('[data-testid=onchain-release-plan]')).toBeTruthy();
  expect(container.textContent).toContain('2 inputs');
  expect(container.textContent).toContain('9,500');

  const assemble = [...container.querySelectorAll('button')].find((b) => /Sign & assemble/i.test(b.textContent ?? ''));
  await act(async () => assemble!.click());
  expect(signer.signSchnorr).toHaveBeenCalledTimes(2);
  expect(signer.signSchnorr).toHaveBeenCalledWith(PLAN.inputs[0].sighash);
  expect(signer.signSchnorr).toHaveBeenCalledWith(PLAN.inputs[1].sighash);
  expect(mocks.release).toHaveBeenLastCalledWith(
    signer, 'fr_1', 'frm_1', ['sig-1111', 'sig-2222'],
  );
  expect(container.querySelector('[data-testid=onchain-release-tx]')).toBeTruthy();
  expect(container.textContent).toContain('ff'.repeat(6));
});

it('posts the campaign-room note after assembling and shows the confirmation chip', async () => {
  const signer = signerWithSchnorr();
  const onRoomNote = vi.fn(async (_text: string) => true);
  mocks.release
    .mockResolvedValueOnce(PLAN)
    .mockResolvedValueOnce({ ...PLAN, txid: 'fe'.repeat(32), raw_tx: '02000000ff', explorer_tx_url: 'https://explorer/tx/fe' });
  await act(async () => root.render(
    <OnchainReleaseSection fundraiserId="fr_1" milestoneId="frm_1" signer={signer} milestoneLabel="Stage 2" onRoomNote={onRoomNote} />,
  ));
  await act(async () => [...container.querySelectorAll('button')].find((b) => /Release \(on-chain\)/i.test(b.textContent ?? ''))!.click());
  await act(async () => [...container.querySelectorAll('button')].find((b) => /Sign & assemble/i.test(b.textContent ?? ''))!.click());
  expect(onRoomNote).toHaveBeenCalledTimes(1);
  const note = String(onRoomNote.mock.calls[0]?.[0] ?? '');
  expect(note).toContain('Stage 2');
  expect(note).toContain('fe'.repeat(32).slice(0, 12));
  expect(container.querySelector('[data-testid=release-room-note]')).toBeTruthy();
  expect(container.textContent).toContain('Noted in the campaign room.');
});

it('a failing room note never breaks the money flow: tx still shown, no error, no chip', async () => {
  const signer = signerWithSchnorr();
  const onRoomNote = vi.fn(async (_text: string) => false);
  mocks.release
    .mockResolvedValueOnce(PLAN)
    .mockResolvedValueOnce({ ...PLAN, txid: 'fd'.repeat(32), raw_tx: '02000000ee', explorer_tx_url: 'https://explorer/tx/fd' });
  await act(async () => root.render(
    <OnchainReleaseSection fundraiserId="fr_1" milestoneId="frm_1" signer={signer} onRoomNote={onRoomNote} />,
  ));
  await act(async () => [...container.querySelectorAll('button')].find((b) => /Release \(on-chain\)/i.test(b.textContent ?? ''))!.click());
  await act(async () => [...container.querySelectorAll('button')].find((b) => /Sign & assemble/i.test(b.textContent ?? ''))!.click());
  expect(container.querySelector('[data-testid=onchain-release-tx]')).toBeTruthy();
  expect(container.textContent).toContain('fd'.repeat(32).slice(0, 12));
  expect(container.querySelector('[data-testid=release-room-note]')).toBeNull();
  expect(container.textContent).not.toMatch(/error/i);
});

it('disables the action when the signer cannot schnorr-sign raw hashes', async () => {
  const signer = { signEvent: vi.fn() } as unknown as Parameters<typeof OnchainReleaseSection>[0]['signer'];
  await act(async () => root.render(
    <OnchainReleaseSection fundraiserId="fr_1" milestoneId="frm_1" signer={signer} />,
  ));
  const button = [...container.querySelectorAll('button')].find((b) => /Release \(on-chain\)/i.test(b.textContent ?? ''));
  expect(button?.disabled).toBe(true);
  await act(async () => button!.click());
  expect(mocks.release).not.toHaveBeenCalled();
});
