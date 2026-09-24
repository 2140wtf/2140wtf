// src/components/fund/PledgeModal.mainnetAuth.test.tsx
//
// Real-money guard: issuing a mainnet Cashu token requires a signed-in
// identity - the per-browser guest key must never stand in for it. The
// pledgeSigner() guard was unreachable from the mainnet branch (which never
// calls it), so a signed-out visitor with a funded local wallet could mint
// and deliver a real token.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PledgeModal } from './PledgeModal';

const mocks = vi.hoisted(() => ({
  spend: vi.fn(),
  auth: {
    status: 'signed-out' as string,
    signer: null as { signEvent: (e: unknown) => Promise<unknown> } | null,
    pubkey: null as string | null,
  },
}));

vi.mock('../../lib/baoFundraising', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/baoFundraising')>()),
  fetchVerificationModels: vi.fn(async () => ({ models: [], defaultModel: '' })),
  baoRelayUrl: () => 'wss://example.invalid',
}));
vi.mock('./pledgeFlow', () => ({ submitPledge: vi.fn() }));
vi.mock('../../relay/guestIdentity', () => ({
  createGuestSigner: vi.fn(() => ({ signEvent: vi.fn() })),
  getGuestPubkeyHex: () => 'guest',
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../wallet/nip61', () => ({ sendNutzap: vi.fn() }));
vi.mock('../../wallet/cashuWallet', () => ({
  loadStoredWallet: () => ({ proofs: [{ secret: 's', amount: 100_000 }] }),
  sumProofs: () => 100_000,
  spendFromStoredWallet: mocks.spend,
  loadPendingTopUp: () => null,
  createLightningTopUp: vi.fn(),
  completeLightningTopUp: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.auth.signer = null;
  mocks.auth.pubkey = null;
  mocks.spend.mockResolvedValue({ token: 'cashuBfake', mintUrl: 'https://mint.example.com' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('refuses to issue a real (mainnet) token while signed out', async () => {
  await act(async () => {
    root.render(
      <PledgeModal
        fundraiserId="test-campaign"
        title="Test project"
        mainnetCashu
        ownerPubkey={'ab'.repeat(32)}
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );
  });
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(mocks.spend).not.toHaveBeenCalled();
  expect(container.textContent).toMatch(/Sign in to pledge real sats/);
});

it('still issues the token when a signed-in identity is present', async () => {
  mocks.auth.status = 'ready';
  mocks.auth.pubkey = 'cd'.repeat(32);
  mocks.auth.signer = { signEvent: vi.fn(async (e) => e) };
  await act(async () => {
    root.render(
      <PledgeModal
        fundraiserId="test-campaign"
        title="Test project"
        mainnetCashu
        ownerPubkey={'ab'.repeat(32)}
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );
  });
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(mocks.spend).toHaveBeenCalledWith(1000);
  expect(container.textContent).toContain('cashuBfake');
});
