import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useRemoteBattleState } from './useRemoteBattleState';
import type { BattleInvitePayload } from '../lib/battleMessages';
import type { NostrEvent } from '@nostrify/nostrify';
import type { PetsCompanion } from '@/pets/core/lib/pets';

const HOST_PUBKEY = 'a'.repeat(64);
const GUEST_PUBKEY = 'b'.repeat(64);
const ESCROW_PUBKEY = 'c'.repeat(64);

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  publishEvent: vi.fn(),
  subscribeBattleMessages: vi.fn(),
  encryptBattleMessage: vi.fn(),
  decryptBattleMessage: vi.fn(),
  checkSpentState: vi.fn(),
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: {} }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { pubkey: GUEST_PUBKEY, signer: { nip44: {} } },
  }),
}));

vi.mock('@/hooks/useNip17SendMessage', () => ({
  useNip17SendMessage: () => ({ sendMessage: mocks.sendMessage }),
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: mocks.publishEvent }),
}));

vi.mock('../lib/battleNetwork', () => ({
  subscribeBattleMessages: mocks.subscribeBattleMessages,
}));

vi.mock('../lib/battleMessages', async (importActual) => {
  const actual = await importActual<typeof import('../lib/battleMessages')>();
  return {
    ...actual,
    encryptBattleMessage: mocks.encryptBattleMessage,
    decryptBattleMessage: mocks.decryptBattleMessage,
  };
});

vi.mock('../lib/cashuEscrow', async (importActual) => {
  const actual = await importActual<typeof import('../lib/cashuEscrow')>();
  return {
    ...actual,
    checkEscrowDepositSpentState: mocks.checkSpentState,
  };
});

const localPet = { d: 'pet-1', name: 'Fighter', stage: 'adult' } as unknown as PetsCompanion;

function makeInvite(overrides: Partial<BattleInvitePayload> = {}): BattleInvitePayload {
  return {
    type: 'battle-invite',
    battleId: 'battle-1',
    inviterPubkey: HOST_PUBKEY,
    inviterPet: localPet,
    prizeAmount: 21,
    roundDurationSeconds: 60,
    sentAt: Date.now(),
    mode: 'demo-sats',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendMessage.mockResolvedValue(undefined);
  mocks.publishEvent.mockResolvedValue({ id: 'ev-1', kind: 21124 });
  mocks.encryptBattleMessage.mockResolvedValue('encrypted-content');
  mocks.subscribeBattleMessages.mockReturnValue(() => {});
  mocks.checkSpentState.mockResolvedValue(null);
});

describe('acceptInvite sync publish (hunt regression)', () => {
  it('publishes the battle-accept sync event with the invite route even before a re-render', async () => {
    const { result } = renderHook(() => useRemoteBattleState());

    // acceptInvite setStates phase 'accepted' and publishes in the SAME
    // synchronous run — stateRef still holds the pre-accept 'idle' state
    // (battleId/opponentPubkey null), so a publishSync that reads only the
    // ref silently drops the accept and the host never learns of it.
    await act(async () => {
      await result.current.acceptInvite(makeInvite(), localPet);
    });

    expect(result.current.phase).toBe('accepted');
    expect(mocks.encryptBattleMessage).toHaveBeenCalledWith(
      expect.anything(),
      HOST_PUBKEY,
      expect.objectContaining({ type: 'battle-accept', battleId: 'battle-1' }),
    );
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [
          ['p', HOST_PUBKEY],
          ['e', 'battle-1'],
          ['t', 'battle-sync'],
        ],
      }),
    );
  });
});

describe('escrow deposit spent-state check (hunt regression)', () => {
  async function setupHostWithListener() {
    const captured: { battleId?: string; onMessage?: (event: NostrEvent) => Promise<void> } = {};
    mocks.subscribeBattleMessages.mockImplementation((options: { battleId: string; onMessage: (event: NostrEvent) => Promise<void> }) => {
      captured.battleId = options.battleId;
      captured.onMessage = options.onMessage;
      return () => {};
    });

    const { result } = renderHook(() =>
      useRemoteBattleState({ validateEscrowDeposit: () => null }),
    );
    await act(async () => {
      await result.current.sendInvite(HOST_PUBKEY, localPet, {
        prizeAmount: 21,
        roundDurationSeconds: 60,
        mode: 'real-sats',
      }, ESCROW_PUBKEY);
    });
    expect(captured.onMessage).toBeDefined();
    return { result, captured };
  }

  function depositEvent(battleId: string): NostrEvent {
    mocks.decryptBattleMessage.mockResolvedValue({
      type: 'battle-escrow-deposit',
      battleId,
      playerIndex: 1,
      token: 'cashuAdeposit',
      amount: 21,
    });
    return { pubkey: GUEST_PUBKEY, content: 'encrypted' } as NostrEvent;
  }

  it('drops a deposit whose proofs fail the mint spent-state check', async () => {
    const { result, captured } = await setupHostWithListener();
    mocks.checkSpentState.mockResolvedValue('Deposit proofs are already spent at the mint');

    await act(async () => {
      await captured.onMessage!(depositEvent(captured.battleId!));
    });

    expect(result.current.escrow.guestDepositToken).toBeUndefined();
  });

  it('records the deposit when the spent-state check passes', async () => {
    const { result, captured } = await setupHostWithListener();

    await act(async () => {
      await captured.onMessage!(depositEvent(captured.battleId!));
    });

    expect(result.current.escrow.guestDepositToken).toBe('cashuAdeposit');
  });
});
