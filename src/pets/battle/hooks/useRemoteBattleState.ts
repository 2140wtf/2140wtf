import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useNip17SendMessage } from '@/hooks/useNip17SendMessage';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { generateUUID } from '@/lib/uuid';
import { isNostrId } from '@/lib/nostrId';
import {
  BATTLE_INVITE_SUBJECT,
  BATTLE_SYNC_KIND,
  encryptBattleMessage,
  decryptBattleMessage,
  type BattleInvitePayload,
  type BattleAcceptPayload,
  type BattleDeclinePayload,
  type BattleCancelPayload,
  type BattleStatePayload,
  type BattleInputPayload,
  type BattleFinishedPayload,
  type BattleMessagePayload,
  type RemoteBattleStateSnapshot,
} from '../lib/battleMessages';
import { subscribeBattleMessages } from '../lib/battleNetwork';
import type { PlayerInput } from '../types/battle.types';
import type { PetsCompanion } from '@/pets/core/lib/pets';

export const INVITE_TIMEOUT_MS = 42_000;
const SYNC_TIMEOUT_MS = 3_000;

export type RemoteBattlePhase =
  | 'idle'
  | 'inviting'
  | 'pending_accept'
  | 'accepted'
  | 'fighting'
  | 'finished'
  | 'expired'
  | 'declined'
  | 'cancelled'
  | 'error';

export interface RemoteBattleMatchOptions {
  prizeAmount: number;
  roundDurationSeconds: number;
}

export interface RemoteBattleState {
  phase: RemoteBattlePhase;
  role: 'host' | 'guest' | null;
  battleId: string | null;
  opponentPubkey: string | null;
  opponentPet: PetsCompanion | null;
  localPet: PetsCompanion | null;
  matchOptions: RemoteBattleMatchOptions | null;
  error: string | null;
  timeLeftMs: number;
  /** Latest snapshot received from the host (guest only). */
  hostSnapshot: RemoteBattleStateSnapshot | null;
  /** Latest input received from the guest (host only). */
  guestInput: PlayerInput | null;
  winner: 0 | 1 | null;
}

export interface UseRemoteBattleReturn extends RemoteBattleState {
  sendInvite: (
    opponentPubkey: string,
    localPet: PetsCompanion,
    matchOptions: RemoteBattleMatchOptions,
  ) => Promise<void>;
  acceptInvite: (invite: BattleInvitePayload, localPet: PetsCompanion) => Promise<void>;
  declineInvite: (invite: BattleInvitePayload) => Promise<void>;
  cancelInvite: () => Promise<void>;
  startFight: () => void;
  sendHostSnapshot: (snapshot: RemoteBattleStateSnapshot) => void;
  sendGuestInput: (input: PlayerInput) => void;
  sendFinished: (winner: 0 | 1 | null) => void;
  reset: () => void;
  /** Mutable ref to the latest guest input (for the host battle loop). */
  guestInputRef: React.MutableRefObject<PlayerInput>;
}

const DEFAULT_INPUT: PlayerInput = {
  left: false,
  right: false,
  jump: false,
  block: false,
  sword: false,
  fireball: false,
};

function nowMs(): number {
  return Date.now();
}

export function useRemoteBattleState(): UseRemoteBattleReturn {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { sendMessage } = useNip17SendMessage();

  const [state, setState] = useState<RemoteBattleState>({
    phase: 'idle',
    role: null,
    battleId: null,
    opponentPubkey: null,
    opponentPet: null,
    localPet: null,
    matchOptions: null,
    error: null,
    timeLeftMs: 0,
    hostSnapshot: null,
    guestInput: null,
    winner: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const inviteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncCleanupRef = useRef<(() => void) | null>(null);
  const lastGuestInputRef = useRef<PlayerInput>(DEFAULT_INPUT);
  const guestInputRef = useRef<PlayerInput>(DEFAULT_INPUT);
  const lastHostSnapshotRef = useRef<RemoteBattleStateSnapshot | null>(null);
  const lastGuestInputSentRef = useRef<PlayerInput>(DEFAULT_INPUT);
  const lastGuestInputSentAtRef = useRef(0);
  const lastHostSnapshotSentRef = useRef<RemoteBattleStateSnapshot | null>(null);
  const lastHostSnapshotSentAtRef = useRef(0);

  const clearInviteTimer = useCallback(() => {
    if (inviteTimerRef.current) {
      clearTimeout(inviteTimerRef.current);
      inviteTimerRef.current = null;
    }
  }, []);

  const stopSync = useCallback(() => {
    if (syncCleanupRef.current) {
      syncCleanupRef.current();
      syncCleanupRef.current = null;
    }
  }, []);

  const setError = useCallback((message: string) => {
    setState((prev) => ({ ...prev, phase: 'error', error: message }));
  }, []);

  const publishSync = useCallback(
    async (payload: BattleMessagePayload) => {
      const current = stateRef.current;
      if (!user?.signer.nip44 || !current.opponentPubkey || !current.battleId) return;

      try {
        const content = await encryptBattleMessage(user.signer, current.opponentPubkey, payload);
        const event = await user.signer.signEvent({
          kind: BATTLE_SYNC_KIND,
          content,
          tags: [
            ['p', current.opponentPubkey],
            ['e', current.battleId],
            ['t', 'battle-sync'],
          ],
          created_at: Math.floor(Date.now() / 1000),
        });
        await nostr.event(event, { signal: AbortSignal.timeout(SYNC_TIMEOUT_MS) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync publish failed';
        console.error('[useRemoteBattle] publishSync error:', message);
      }
    },
    [nostr, user],
  );

  const startFight = useCallback(() => {
    const current = stateRef.current;
    if (current.role !== 'host' || !current.battleId || !current.opponentPubkey) return;

    setState((prev) => ({ ...prev, phase: 'fighting' }));
  }, []);

  const startSyncListener = useCallback(
    (battleId: string, opponentPubkey: string, role: 'host' | 'guest') => {
      stopSync();

      const since = Math.floor(Date.now() / 1000) - 10;
      syncCleanupRef.current = subscribeBattleMessages({
        nostr,
        battleId,
        opponentPubkey,
        since,
        onMessage: async (event) => {
          if (!user?.signer.nip44) return;
          const payload = await decryptBattleMessage(user.signer, opponentPubkey, event.content);
          if (!payload || payload.battleId !== battleId) return;

          if (role === 'host') {
            if (payload.type === 'battle-accept') {
              setState((prev) => ({
                ...prev,
                phase: 'accepted',
                opponentPet: payload.guestPet,
              }));
              // Give both clients a moment to render the accepted state, then
              // the host automatically starts the fight.
              setTimeout(() => {
                if (stateRef.current.phase === 'accepted') {
                  startFight();
                }
              }, 800);
            } else if (payload.type === 'battle-input') {
              lastGuestInputRef.current = payload.input;
              guestInputRef.current = payload.input;
              setState((prev) => ({ ...prev, guestInput: payload.input }));
            } else if (payload.type === 'battle-cancel') {
              setState((prev) => ({ ...prev, phase: 'cancelled' }));
              stopSync();
            }
          } else {
            if (payload.type === 'battle-state') {
              lastHostSnapshotRef.current = payload.state;
              setState((prev) => ({ ...prev, hostSnapshot: payload.state }));
            } else if (payload.type === 'battle-finished') {
              setState((prev) => ({ ...prev, phase: 'finished', winner: payload.winner }));
              stopSync();
            } else if (payload.type === 'battle-cancel') {
              setState((prev) => ({ ...prev, phase: 'cancelled' }));
              stopSync();
            }
          }
        },
      });
    },
    [nostr, stopSync, user?.signer, startFight],
  );

  const sendInvite = useCallback(
    async (
      opponentPubkey: string,
      localPet: PetsCompanion,
      matchOptions: RemoteBattleMatchOptions,
    ) => {
      if (!user) {
        setError('You must be logged in to challenge someone.');
        return;
      }
      if (!isNostrId(opponentPubkey)) {
        setError('Invalid opponent pubkey.');
        return;
      }
      if (opponentPubkey === user.pubkey) {
        setError('You cannot battle yourself.');
        return;
      }

      const battleId = generateUUID();
      const sentAt = nowMs();

      setState({
        ...stateRef.current,
        phase: 'inviting',
        role: 'host',
        battleId,
        opponentPubkey,
        opponentPet: null,
        localPet,
        matchOptions,
        error: null,
        timeLeftMs: INVITE_TIMEOUT_MS,
        winner: null,
      });

      try {
        const payload: BattleInvitePayload = {
          type: 'battle-invite',
          battleId,
          inviterPubkey: user.pubkey,
          inviterPet: localPet,
          prizeAmount: matchOptions.prizeAmount,
          roundDurationSeconds: matchOptions.roundDurationSeconds,
          sentAt,
        };

        // Start listening for the guest's accept/decline/cancel on the sync
        // channel immediately so we can react as fast as possible.
        startSyncListener(battleId, opponentPubkey, 'host');

        await sendMessage({
          recipientPubkey: opponentPubkey,
          content: JSON.stringify(payload),
          subject: BATTLE_INVITE_SUBJECT,
        });

        // Countdown update interval.
        const start = nowMs();
        const interval = setInterval(() => {
          const elapsed = nowMs() - start;
          const remaining = Math.max(0, INVITE_TIMEOUT_MS - elapsed);
          setState((prev) => ({ ...prev, timeLeftMs: remaining }));
          if (remaining <= 0) clearInterval(interval);
        }, 250);

        inviteTimerRef.current = setTimeout(() => {
          clearInterval(interval);
          setState((prev) =>
            prev.phase === 'inviting' ? { ...prev, phase: 'expired', timeLeftMs: 0 } : prev,
          );
          stopSync();
        }, INVITE_TIMEOUT_MS);
      } catch (err) {
        clearInviteTimer();
        const message = err instanceof Error ? err.message : 'Failed to send invite';
        setError(message);
      }
    },
    [clearInviteTimer, sendMessage, setError, startSyncListener, stopSync, user],
  );

  const acceptInvite = useCallback(
    async (invite: BattleInvitePayload, localPet: PetsCompanion) => {
      if (!user) {
        setError('You must be logged in to accept a battle.');
        return;
      }

      clearInviteTimer();
      const elapsed = nowMs() - invite.sentAt;
      if (elapsed > INVITE_TIMEOUT_MS) {
        setError('This battle request has expired.');
        return;
      }

      setState({
        ...stateRef.current,
        phase: 'accepted',
        role: 'guest',
        battleId: invite.battleId,
        opponentPubkey: invite.inviterPubkey,
        opponentPet: invite.inviterPet,
        localPet,
        matchOptions: {
          prizeAmount: invite.prizeAmount,
          roundDurationSeconds: invite.roundDurationSeconds,
        },
        error: null,
        timeLeftMs: 0,
        winner: null,
      });

      try {
        const payload: BattleAcceptPayload = {
          type: 'battle-accept',
          battleId: invite.battleId,
          guestPet: localPet,
        };
        // Send both a formal NIP-17 DM and an ephemeral sync accept so the host
        // sees it immediately even if DM relays are slow.
        await Promise.all([
          sendMessage({
            recipientPubkey: invite.inviterPubkey,
            content: JSON.stringify(payload),
            subject: BATTLE_INVITE_SUBJECT,
          }),
          publishSync(payload),
        ]);
        startSyncListener(invite.battleId, invite.inviterPubkey, 'guest');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to accept invite';
        setError(message);
      }
    },
    [clearInviteTimer, sendMessage, publishSync, setError, startSyncListener, user],
  );

  const declineInvite = useCallback(
    async (invite: BattleInvitePayload) => {
      if (!user) return;
      try {
        const payload: BattleDeclinePayload = {
          type: 'battle-decline',
          battleId: invite.battleId,
        };
        await sendMessage({
          recipientPubkey: invite.inviterPubkey,
          content: JSON.stringify(payload),
          subject: BATTLE_INVITE_SUBJECT,
        });
        setState((prev) => ({ ...prev, phase: 'declined' }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to decline invite';
        setError(message);
      }
    },
    [sendMessage, setError, user],
  );

  const cancelInvite = useCallback(async () => {
    const current = stateRef.current;
    if (current.role !== 'host' || !current.battleId || !current.opponentPubkey) return;

    clearInviteTimer();
    try {
      const payload: BattleCancelPayload = {
        type: 'battle-cancel',
        battleId: current.battleId,
      };
      await sendMessage({
        recipientPubkey: current.opponentPubkey,
        content: JSON.stringify(payload),
        subject: BATTLE_INVITE_SUBJECT,
      });
      setState((prev) => ({ ...prev, phase: 'cancelled' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel invite';
      setError(message);
    }
  }, [clearInviteTimer, sendMessage, setError]);

  const sendHostSnapshot = useCallback(
    (snapshot: RemoteBattleStateSnapshot) => {
      const current = stateRef.current;
      if (current.role !== 'host' || !current.battleId) return;

      const now = Date.now();
      if (now - lastHostSnapshotSentAtRef.current < 50) return;
      if (
        lastHostSnapshotSentRef.current &&
        JSON.stringify(lastHostSnapshotSentRef.current) === JSON.stringify(snapshot)
      ) {
        return;
      }

      lastHostSnapshotSentRef.current = snapshot;
      lastHostSnapshotSentAtRef.current = now;

      const payload: BattleStatePayload = {
        type: 'battle-state',
        battleId: current.battleId,
        state: snapshot,
      };
      void publishSync(payload);
    },
    [publishSync],
  );

  const sendGuestInput = useCallback(
    (input: PlayerInput) => {
      const current = stateRef.current;
      if (current.role !== 'guest' || !current.battleId) return;

      const now = Date.now();
      if (now - lastGuestInputSentAtRef.current < 50) return;
      if (
        JSON.stringify(lastGuestInputSentRef.current) === JSON.stringify(input)
      ) {
        return;
      }

      lastGuestInputSentRef.current = input;
      lastGuestInputSentAtRef.current = now;

      const payload: BattleInputPayload = {
        type: 'battle-input',
        battleId: current.battleId,
        input,
      };
      void publishSync(payload);
    },
    [publishSync],
  );

  const sendFinished = useCallback(
    (winner: 0 | 1 | null) => {
      const current = stateRef.current;
      if (current.role !== 'host' || !current.battleId) return;
      const payload: BattleFinishedPayload = {
        type: 'battle-finished',
        battleId: current.battleId,
        winner,
      };
      void publishSync(payload);
      setState((prev) => ({ ...prev, phase: 'finished', winner }));
      stopSync();
    },
    [publishSync, stopSync],
  );

  const reset = useCallback(() => {
    clearInviteTimer();
    stopSync();
    setState({
      phase: 'idle',
      role: null,
      battleId: null,
      opponentPubkey: null,
      opponentPet: null,
      localPet: null,
      matchOptions: null,
      error: null,
      timeLeftMs: 0,
      hostSnapshot: null,
      guestInput: null,
      winner: null,
    });
  }, [clearInviteTimer, stopSync]);



  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      clearInviteTimer();
      stopSync();
    };
  }, [clearInviteTimer, stopSync]);

  return useMemo(
    () => ({
      ...state,
      sendInvite,
      acceptInvite,
      declineInvite,
      cancelInvite,
      startFight,
      sendHostSnapshot,
      sendGuestInput,
      sendFinished,
      reset,
      guestInputRef,
    }),
    [state, sendInvite, acceptInvite, declineInvite, cancelInvite, startFight, sendHostSnapshot, sendGuestInput, sendFinished, reset, guestInputRef],
  );
}
