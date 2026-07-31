import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import PetsBattlePage from './PetsBattlePage';
import { loadPendingEscrowClaims } from '@/pets/battle/lib/cashuEscrow';

const LOCAL_ESCROW_PUBKEY = 'aa'.repeat(32);
const OPPONENT_NOSTR_PUBKEY = '77'.repeat(32);
const OWN_ATTESTATION = {
  id: '11'.repeat(32),
  pubkey: 'dd'.repeat(32),
  kind: 11124,
  created_at: 1_700_000_000,
  tags: [['e', 'battle-1'], ['t', 'battle-attestation']],
  content: 'enc-own',
  sig: 'ee'.repeat(64),
};
const OPPONENT_ATTESTATION = {
  id: '22'.repeat(32),
  pubkey: OPPONENT_NOSTR_PUBKEY,
  kind: 11124,
  created_at: 1_700_000_001,
  tags: [['e', 'battle-1'], ['t', 'battle-attestation']],
  content: 'enc-opponent',
  sig: 'ff'.repeat(64),
};

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  requestEscrowRelease: vi.fn(),
  receiveLockedToken: vi.fn(),
  sendFinished: vi.fn(),
  sendAttestation: vi.fn(),
  nostr: {
    query: vi.fn(),
    relay: vi.fn(() => ({ query: vi.fn(async () => []), event: vi.fn(async () => ({})) })),
  },
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

vi.mock('@nostrify/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nostrify/react')>();
  return { ...actual, useNostr: () => ({ nostr: mocks.nostr }) };
});

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
    opponentPubkey: OPPONENT_NOSTR_PUBKEY,
    guestInputRef: { current: null },
    sendFinished: mocks.sendFinished,
    sendAttestation: mocks.sendAttestation,
    sendHostSnapshot: vi.fn(),
    sendGuestInput: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

describe('PetsBattlePage escrow claim journaling (mutual attestation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.onFinishRef.current = null;
    mocks.requestEscrowRelease.mockResolvedValue({ token: 'release-token' });
    mocks.receiveLockedToken.mockResolvedValue(200);
    mocks.sendFinished.mockResolvedValue({ id: 'finished' });
    mocks.sendAttestation.mockResolvedValue(OWN_ATTESTATION);
    mocks.nostr.query.mockResolvedValue([OPPONENT_ATTESTATION]);
  });

  async function renderFinishAndUnmount(winner: 0 | 1) {
    const { unmount } = render(<PetsBattlePage />, { wrapper });
    await waitFor(() => expect(mocks.onFinishRef.current).toBeTruthy());
    await act(async () => {
      await mocks.onFinishRef.current!(winner);
    });
    unmount();
  }

  it('keeps the journaled releaseToken when the wallet receive fails after a successful /release', async () => {
    // Regression: the catch used to re-save the stale pre-release claim object,
    // clobbering the releaseToken the operator had already delivered — forcing
    // a second /release the operator refuses.
    arrangeRemote();
    mocks.receiveLockedToken.mockResolvedValue(0);

    await renderFinishAndUnmount(0);

    // The claim defers until the opponent's attestation is found.
    expect(mocks.requestEscrowRelease).not.toHaveBeenCalled();
    expect(loadPendingEscrowClaims()[0]?.ownAttestation?.id).toBe(OWN_ATTESTATION.id);

    // Remount → hydration finds the opponent's attestation and fires.
    render(<PetsBattlePage />, { wrapper });
    await waitFor(() => expect(mocks.requestEscrowRelease).toHaveBeenCalledTimes(1));
    expect(mocks.requestEscrowRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        battleId: 'battle-1',
        hostAttestation: expect.objectContaining({ id: OWN_ATTESTATION.id }),
        guestAttestation: expect.objectContaining({ id: OPPONENT_ATTESTATION.id }),
      }),
    );

    await waitFor(() => expect(loadPendingEscrowClaims()[0]?.releaseToken).toBe('release-token'));
    const claims = loadPendingEscrowClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].battleId).toBe('battle-1');
    // attempts: 1 (deferred at finish) + 1 (receive failure during hydration)
    expect(claims[0].attempts).toBe(2);
  });

  it('re-publishes a missing own attestation during hydration instead of dropping the claim', async () => {
    // The attestation publish can race a closed tab; the journaled route lets
    // hydration re-publish it later instead of stranding both locked stakes.
    arrangeRemote();
    mocks.sendAttestation.mockResolvedValueOnce(undefined);
    mocks.nostr.query.mockResolvedValue([]);

    await renderFinishAndUnmount(0);

    expect(mocks.requestEscrowRelease).not.toHaveBeenCalled();
    const deferred = loadPendingEscrowClaims();
    expect(deferred).toHaveLength(1);
    expect(deferred[0].ownAttestation).toBeUndefined();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Prize claim saved — awaiting opponent confirmation' }),
    );

    mocks.nostr.query.mockResolvedValue([OPPONENT_ATTESTATION]);
    render(<PetsBattlePage />, { wrapper });
    await waitFor(() => expect(mocks.requestEscrowRelease).toHaveBeenCalledTimes(1));
    // (Re-renders re-fire the hydration effect in this mock environment, so an
    // extra idempotent republish is fine — what matters is the journaled route
    // was used for the republish.)
    expect(mocks.sendAttestation).toHaveBeenNthCalledWith(
      2,
      0,
      '11'.repeat(32),
      'ee'.repeat(32),
      { battleId: 'battle-1', opponentPubkey: OPPONENT_NOSTR_PUBKEY },
    );
    await waitFor(() => expect(loadPendingEscrowClaims()).toHaveLength(0));
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Battle prize claimed!' }),
    );
  });

  it('guest winner journals a deferred claim and fires it once the host attestation is found', async () => {
    // The guest's onFinish fires from the final battle-state snapshot, which
    // can arrive BEFORE the host's attestation — the claim must be journaled
    // deferred and hydrated the moment the host's attestation is found.
    arrangeRemote({ role: 'guest' });
    mocks.nostr.query.mockResolvedValue([]);

    await renderFinishAndUnmount(1);

    expect(mocks.sendFinished).not.toHaveBeenCalled(); // only the host announces UI-finished
    expect(mocks.sendAttestation).toHaveBeenCalledWith(1, '11'.repeat(32), 'ee'.repeat(32));
    expect(mocks.requestEscrowRelease).not.toHaveBeenCalled();
    const deferred = loadPendingEscrowClaims();
    expect(deferred).toHaveLength(1);
    expect(deferred[0].localRole).toBe('guest');
    expect(deferred[0].ownAttestation?.id).toBe(OWN_ATTESTATION.id);
    expect(deferred[0].opponentAttestation).toBeUndefined();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Prize claim saved — awaiting opponent confirmation' }),
    );

    // The host's attestation lands → hydration maps it to hostAttestation and fires.
    mocks.nostr.query.mockResolvedValue([OPPONENT_ATTESTATION]);
    render(<PetsBattlePage />, { wrapper });
    await waitFor(() => expect(mocks.requestEscrowRelease).toHaveBeenCalledTimes(1));
    expect(mocks.requestEscrowRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        battleId: 'battle-1',
        hostAttestation: expect.objectContaining({ id: OPPONENT_ATTESTATION.id }),
        guestAttestation: expect.objectContaining({ id: OWN_ATTESTATION.id }),
      }),
    );
    await waitFor(() => expect(loadPendingEscrowClaims()).toHaveLength(0));
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Battle prize claimed!' }),
    );
  });

  it('discards a conflicting opponent attestation when the operator rejects a disagreement', async () => {
    // A losing opponent may publish several conflicting attestations
    // (griefing). On a disagreement rejection the claimer discards THAT event,
    // remembers it as tried, and hydration picks another from the same author.
    arrangeRemote();
    mocks.requestEscrowRelease.mockRejectedValueOnce(new Error('Attestations disagree on the winner'));

    await renderFinishAndUnmount(0);
    render(<PetsBattlePage />, { wrapper });
    await waitFor(() => expect(mocks.requestEscrowRelease).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const claims = loadPendingEscrowClaims();
      expect(claims[0]?.opponentAttestation).toBeUndefined();
      expect(claims[0]?.triedAttestationIds).toContain(OPPONENT_ATTESTATION.id);
    });

    const honest = { ...OPPONENT_ATTESTATION, id: '33'.repeat(32) };
    mocks.nostr.query.mockResolvedValue([OPPONENT_ATTESTATION, honest]);
    render(<PetsBattlePage />, { wrapper });
    await waitFor(() => expect(mocks.requestEscrowRelease).toHaveBeenCalledTimes(2));
    expect(mocks.requestEscrowRelease).toHaveBeenLastCalledWith(
      expect.objectContaining({
        guestAttestation: expect.objectContaining({ id: honest.id }),
      }),
    );
    await waitFor(() => expect(loadPendingEscrowClaims()).toHaveLength(0));
  });
});
