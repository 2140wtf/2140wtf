import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import PetsBattlePage from './PetsBattlePage';
import { loadPendingEscrowClaims } from '@/pets/battle/lib/cashuEscrow';

const LOCAL_ESCROW_PUBKEY = 'aa'.repeat(32);
const FINISHED_EVENT = {
  id: 'ff'.repeat(32),
  pubkey: 'bb'.repeat(32),
  kind: 21124,
  created_at: 1_700_000_000,
  tags: [['e', 'battle-1']],
  content: 'encrypted',
  sig: 'cc'.repeat(64),
};

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  requestEscrowRelease: vi.fn(),
  receiveLockedToken: vi.fn(),
  sendFinished: vi.fn(),
  startMatch: vi.fn(),
  resetMatch: vi.fn(),
  applyHostSnapshot: vi.fn(),
  payoutMutateAsync: vi.fn(),
  publishEvent: vi.fn(),
  onFinishRef: { current: null as null | ((winner: 0 | 1 | null) => Promise<void>) },
  remote: {} as Record<string, unknown>,
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'dd'.repeat(32) } }),
}));

vi.mock('@/hooks/useNostrPetProfile', () => ({
  useNostrPetProfile: () => ({ updateProfileEvent: vi.fn() }),
}));

vi.mock('@/pets/core/hooks/usePetsWallet', () => ({
  usePetsWallet: () => ({
    wallet: { receiveLockedToken: mocks.receiveLockedToken },
    isBao: false,
  }),
}));

vi.mock('@/hooks/useCashuSeed', () => ({
  useCashuSeed: () => ({ seedPhrase: 'test seed phrase' }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: {
      petsBattleEscrowServiceUrl: 'https://escrow.test',
      petsBattleEscrowPubkey: 'ee'.repeat(32),
    },
  }),
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: mocks.publishEvent }),
}));

vi.mock('@/hooks/usePublishPreferences', () => ({
  usePublishPreferences: () => ({ isEnabled: () => false }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
  toast: mocks.toast,
}));

vi.mock('@/contexts/LayoutContext', () => ({
  useLayoutOptions: () => {},
}));

vi.mock('@unhead/react', () => ({
  useSeoMeta: () => {},
}));

vi.mock('@/pets/battle', () => ({
  BattleArena: () => null,
  BattleControlsHelp: () => null,
  BattleSetup: () => null,
  BattleResultOverlay: () => null,
  BattleInvitePending: () => null,
  useBattleGame: () => ({
    state: {
      status: 'setup',
      winner: null,
      fighters: [
        { health: 100, pet: { name: 'Pet1', d: 'pet-1' } },
        { health: 100, pet: { name: 'Pet2', d: 'pet-2' } },
      ],
    },
    inputRef: { current: null },
    startMatch: mocks.startMatch,
    resetMatch: mocks.resetMatch,
    onFinishRef: mocks.onFinishRef,
    applyHostSnapshot: mocks.applyHostSnapshot,
  }),
  useBattlePayout: () => ({ isPending: false, mutateAsync: mocks.payoutMutateAsync }),
  emitBattleInteractionEvent: vi.fn(),
  useRemoteBattle: () => mocks.remote,
}));

vi.mock('@/pets/battle/lib/cashuEscrow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pets/battle/lib/cashuEscrow')>();
  return {
    ...actual,
    deriveBattleEscrowKeypair: () => ({ pubkey: LOCAL_ESCROW_PUBKEY, privkey: '11'.repeat(32) }),
    normalizeEscrowPubkey: (pk: string | null | undefined) => pk ?? null,
    requestEscrowRelease: mocks.requestEscrowRelease,
  };
});

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function arrangeRemote(overrides: Record<string, unknown> = {}) {
  mocks.remote = {
    role: 'host',
    phase: 'accepted',
    battleId: 'battle-1',
    localPet: { d: 'pet-1', name: 'Pet1' },
    opponentPet: { d: 'pet-2', name: 'Pet2' },
    matchOptions: { prizeAmount: 100, roundDurationSeconds: 60 },
    escrow: {
      mode: 'real-sats',
      phase: 'ready',
      hostEscrowPubkey: LOCAL_ESCROW_PUBKEY,
      guestEscrowPubkey: '99'.repeat(32),
      hostDepositToken: 'host-deposit-token',
      guestDepositToken: 'guest-deposit-token',
    },
    hostFinishedEvent: null,
    hostSnapshot: null,
    guestInputRef: { current: null },
    sendFinished: mocks.sendFinished,
    sendHostSnapshot: vi.fn(),
    sendGuestInput: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

async function renderAndFinish(winner: 0 | 1) {
  render(<PetsBattlePage />, { wrapper });
  await waitFor(() => expect(mocks.onFinishRef.current).toBeTruthy());
  await act(async () => {
    await mocks.onFinishRef.current!(winner);
  });
}

describe('PetsBattlePage escrow claim journaling (hunt regressions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.onFinishRef.current = null;
    mocks.requestEscrowRelease.mockResolvedValue({ token: 'release-token' });
    mocks.receiveLockedToken.mockResolvedValue(200);
    mocks.sendFinished.mockResolvedValue(FINISHED_EVENT);
  });

  it('keeps the journaled releaseToken when the wallet receive fails after a successful /release', async () => {
    // Regression: the onFinish catch used to re-save the stale pre-release
    // claim object, clobbering the releaseToken the operator had already
    // delivered — forcing a second /release the operator refuses.
    arrangeRemote();
    mocks.receiveLockedToken.mockResolvedValue(0);

    await renderAndFinish(0);

    expect(mocks.requestEscrowRelease).toHaveBeenCalledTimes(1);
    const claims = loadPendingEscrowClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].battleId).toBe('battle-1');
    expect(claims[0].releaseToken).toBe('release-token');
    expect(claims[0].attempts).toBe(1);
  });

  it('refuses to journal a claim when the host battle-finished publish failed', async () => {
    // Regression: a silent publishSync failure left finishedEvent undefined,
    // and the claim was journaled with finishedEvent: {} — an unverifiable
    // proof every retry would replay identically until attempts exhausted.
    arrangeRemote();
    mocks.sendFinished.mockResolvedValue(undefined);

    await renderAndFinish(0);

    expect(mocks.requestEscrowRelease).not.toHaveBeenCalled();
    expect(loadPendingEscrowClaims()).toHaveLength(0);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Battle result proof missing', variant: 'destructive' }),
    );
  });

  it('refuses to journal a claim when the guest never received the host finished event', async () => {
    arrangeRemote({ role: 'guest', hostFinishedEvent: null });

    await renderAndFinish(1);

    expect(mocks.requestEscrowRelease).not.toHaveBeenCalled();
    expect(loadPendingEscrowClaims()).toHaveLength(0);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Battle result proof missing', variant: 'destructive' }),
    );
  });

  it('guest winner forwards the host-signed finished event and clears the journal on success', async () => {
    arrangeRemote({ role: 'guest', hostFinishedEvent: FINISHED_EVENT });

    await renderAndFinish(1);

    expect(mocks.sendFinished).not.toHaveBeenCalled();
    expect(mocks.requestEscrowRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        battleId: 'battle-1',
        finishedEvent: expect.objectContaining({ id: FINISHED_EVENT.id, sig: FINISHED_EVENT.sig }),
      }),
    );
    expect(loadPendingEscrowClaims()).toHaveLength(0);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Battle prize claimed!' }),
    );
  });
});
