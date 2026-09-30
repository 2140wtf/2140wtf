import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { AttestModal } from './AttestModal';

const mocks = vi.hoisted(() => ({
  score: vi.fn(),
  release: vi.fn(),
  verdicts: vi.fn(),
  verifier: vi.fn(),
  seed: vi.fn<() => string | null>(),
  signer: { getPublicKey: async () => 'test-pubkey' },
}));

vi.mock('../../lib/baoFundraising', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/baoFundraising')>()),
  scoreMilestone: mocks.score,
  releaseMilestone: mocks.release,
  baoRelayUrl: () => 'wss://example.invalid',
}));
vi.mock('../../relay/verdictFeed', () => ({
  fetchMilestoneVerdicts: mocks.verdicts,
  verdictVerifierPubkey: mocks.verifier,
}));
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    signer: mocks.signer,
    pubkey: 'ab'.repeat(32),
    seedIdentityHex: () => mocks.seed(),
  }),
}));

let container: HTMLDivElement;
let root: Root;
let onDone = vi.fn<(msg: string) => void>();
let onClose = vi.fn<() => void>();

const candidates = [{ frId: 'fr_1', milestoneId: 'm1', label: 'Milestone one' }];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.verifier.mockReturnValue(null);
  mocks.seed.mockReturnValue(null);
  mocks.verdicts.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onDone = vi.fn();
  onClose = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<AttestModal candidates={candidates} onDone={onDone} onClose={onClose} />);
  });
}

async function release() {
  const button = [...container.querySelectorAll('button')].find((b) => /Attest & release/i.test(b.textContent ?? ''));
  await act(async () => { button!.click(); });
}

function escrowInitiate() {
  return {
    escrow_release: {
      swap: {},
      awaiting: ['project'],
      verifier_pubkey: 'cd'.repeat(32),
      project_output_sats: 10_000,
      fee_sats: 100,
      mint_fee_sats: 0,
    },
  };
}

it('never reports an escrow release initiate as released (no seed identity)', async () => {
  mocks.release.mockResolvedValue(escrowInitiate());
  await render();
  await release();
  expect(onDone).not.toHaveBeenCalled();
  expect(container.textContent).toContain('awaiting');
  expect(container.textContent).toContain('NOT settled');
});

it('never reports an escrow release initiate as released (malformed swap, seed identity)', async () => {
  mocks.seed.mockReturnValue('11'.repeat(32));
  mocks.release.mockResolvedValue(escrowInitiate());
  await render();
  await release();
  expect(onDone).not.toHaveBeenCalled();
  expect(container.textContent).toContain('NOT settled');
});

it('still reports a recorded release from the API', async () => {
  mocks.release.mockResolvedValue({
    milestone: { title: 'Deliverable one', status: 'released' },
    fundraiser: { id: 'fr_1' },
  });
  await render();
  await release();
  expect(onDone).toHaveBeenCalledWith('Attested & released: Deliverable one → released');
});
