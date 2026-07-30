import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useNip17SendMessage } from '@/hooks/useNip17SendMessage';
import { useNostrPublish } from '@/hooks/useNostrPublish';
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
  type BattleEscrowDepositPayload,
  type BattleDepositAckPayload,
  type BattleDepositRejectPayload,
  type BattleMessagePayload,
  type RemoteBattleStateSnapshot,
  type BattleMode,
} from '../lib/battleMessages';
import { subscribeBattleMessages } from '../lib/battleNetwork';
import { checkEscrowDepositSpentState, normalizeEscrowPubkey } from '../lib/cashuEscrow';
import { safeNormalizeMintUrl } from '@/lib/cashu/cashu';
import type { NostrEvent } from '@nostrify/nostrify';
import type { PlayerInput } from '../types/battle.types';
import type { PetsCompanion } from '@/pets/core/lib/pets';

export const INVITE_TIMEOUT_MS = 42_000;

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
  mode: BattleMode;
}

export interface BattleEscrowState {
  mode: BattleMode;
  hostEscrowPubkey?: string;
  guestEscrowPubkey?: string;
  hostDepositToken?: string;
  guestDepositToken?: string;
  /**
   * The mint BOTH players stake from (real-sats). Chosen by the host and
   * advertised in the invite — the escrow operator rejects mixed-mint
   * releases, so deposits from any other mint are refused.
   */
  agreedMint?: string;
  /**
   * The opponent confirmed (battle-deposit-ack) that they received and
   * recorded OUR deposit. A relay ack alone proves nothing about end-to-end
   * delivery of the ephemeral sync event.
   */
  myDepositAcked?: boolean;
  /** Why the opponent rejected our deposit (battle-deposit-reject). */
  depositRejectReason?: string;
  phase: 'none' | 'awaiting_pubkeys' | 'locking' | 'awaiting_deposits' | 'ready';
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
  escrow: BattleEscrowState;
  /** Raw host-signed battle-finished sync event (guest only) — forwarded to
   *  the escrow operator as proof of outcome when claiming the prize. */
  hostFinishedEvent: NostrEvent | null;
}

export interface UseRemoteBattleOptions {
  /**
   * Validate an incoming escrow deposit token. Return an error message if
   * invalid. `expectedMint` is the battle's agreed mint when one was
   * negotiated — the deposit must come from exactly that mint, not merely
   * one the receiver also uses.
   */
  validateEscrowDeposit?: (
    token: string,
    playerIndex: 0 | 1,
    amount: number,
    expectedMint?: string,
    lockContext?: { hostEscrowPubkey?: string; guestEscrowPubkey?: string },
  ) => string | null;
}

export interface UseRemoteBattleReturn extends RemoteBattleState {
  sendInvite: (
    opponentPubkey: string,
    localPet: PetsCompanion,
    matchOptions: RemoteBattleMatchOptions,
    hostEscrowPubkey?: string,
    hostDepositMint?: string,
  ) => Promise<void>;
  acceptInvite: (invite: BattleInvitePayload, localPet: PetsCompanion, guestEscrowPubkey?: string) => Promise<void>;
  declineInvite: (invite: BattleInvitePayload) => Promise<void>;
  cancelInvite: () => Promise<void>;
  sendEscrowDeposit: (token: string) => Promise<boolean>;
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

export function useRemoteBattleState(options: UseRemoteBattleOptions = {}): UseRemoteBattleReturn {
  const { validateEscrowDeposit } = options;
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { sendMessage } = useNip17SendMessage();
  const { mutateAsync: publishEvent } = useNostrPublish();

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
    escrow: { mode: 'demo-sats', phase: 'none' },
    hostFinishedEvent: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const inviteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inviteIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncCleanupRef = useRef<(() => void) | null>(null);
  const autoStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (inviteIntervalRef.current) {
      clearInterval(inviteIntervalRef.current);
      inviteIntervalRef.current = null;
    }
  }, []);

  const stopSync = useCallback(() => {
    if (syncCleanupRef.current) {
      syncCleanupRef.current();
      syncCleanupRef.current = null;
    }
    if (autoStartTimerRef.current) {
      clearTimeout(autoStartTimerRef.current);
      autoStartTimerRef.current = null;
    }
  }, []);

  const setError = useCallback((message: string) => {
    setState((prev) => ({ ...prev, phase: 'error', error: message }));
  }, []);

  const updateEscrow = useCallback((update: Partial<BattleEscrowState>) => {
    setState((prev) => {
      const nextEscrow = { ...prev.escrow, ...update };
      const ready =
        nextEscrow.mode === 'demo-sats' ||
        (!!nextEscrow.hostDepositToken &&
          !!nextEscrow.guestDepositToken &&
          // The winner needs BOTH deposit tokens to claim from the operator,
          // and each side records its OWN deposit locally at publish time —
          // a relay ack proves nothing about end-to-end delivery. The host in
          // particular must not start the fight until the guest has confirmed
          // (battle-deposit-ack) it received the host's deposit, or a guest
          // win would be unclaimable and both stakes stranded.
          (prev.role !== 'host' || !!nextEscrow.myDepositAcked));
      return {
        ...prev,
        escrow: {
          ...nextEscrow,
          phase: ready ? 'ready' : nextEscrow.phase,
        },
      };
    });
  }, []);

  const resetEscrow = useCallback((): BattleEscrowState => {
    return { mode: 'demo-sats', phase: 'none' };
  }, []);

  const publishSync = useCallback(
    async (
      payload: BattleMessagePayload,
      // Callers that publish in the same synchronous run as a setState (e.g.
      // acceptInvite) must pass the route explicitly: stateRef is only
      // refreshed at render time, so it still holds the PRE-transition state
      // (battleId/opponentPubkey null) and the guard below would silently
      // drop the event.
      route?: { battleId: string; opponentPubkey: string },
    ) => {
      const current = stateRef.current;
      const battleId = route?.battleId ?? current.battleId;
      const opponentPubkey = route?.opponentPubkey ?? current.opponentPubkey;
      if (!user?.signer.nip44 || !opponentPubkey || !battleId) return undefined;

      try {
        const content = await encryptBattleMessage(user.signer, opponentPubkey, payload);
        const event = await publishEvent({
          kind: BATTLE_SYNC_KIND,
          content,
          tags: [
            ['p', opponentPubkey],
            ['e', battleId],
            ['t', 'battle-sync'],
          ],
        });
        return event;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync publish failed';
        console.error('[useRemoteBattle] publishSync error:', message);
        return undefined;
      }
    },
    [publishEvent, user],
  );

  const startFight = useCallback(() => {
    const current = stateRef.current;
    if (current.role !== 'host' || !current.battleId || !current.opponentPubkey) return;
    if (current.escrow.mode === 'real-sats' && current.escrow.phase !== 'ready') return;

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
                escrow: {
                  ...prev.escrow,
                  guestEscrowPubkey: payload.guestEscrowPubkey,
                  phase: prev.escrow.mode === 'real-sats' ? 'locking' : 'none',
                },
              }));
              // Give both clients a moment to render the accepted state, then
              // the host automatically starts the fight.
              autoStartTimerRef.current = setTimeout(() => {
                if (stateRef.current.phase === 'accepted') {
                  startFight();
                }
                autoStartTimerRef.current = null;
              }, 800);
            } else if (payload.type === 'battle-input') {
              lastGuestInputRef.current = payload.input;
              guestInputRef.current = payload.input;
              setState((prev) => ({ ...prev, guestInput: payload.input }));
            } else if (payload.type === 'battle-decline') {
              setState((prev) => ({ ...prev, phase: 'declined' }));
              stopSync();
            } else if (payload.type === 'battle-cancel') {
              setState((prev) => ({ ...prev, phase: 'cancelled' }));
              stopSync();
            } else if (payload.type === 'battle-escrow-deposit') {
              const deposit = payload as BattleEscrowDepositPayload;
              const expectedAmount = stateRef.current.matchOptions?.prizeAmount ?? 0;
              const agreedMint = stateRef.current.escrow.agreedMint;
              const error = validateEscrowDeposit?.(deposit.token, 1, expectedAmount, agreedMint, {
                hostEscrowPubkey: stateRef.current.escrow.hostEscrowPubkey,
                guestEscrowPubkey: stateRef.current.escrow.guestEscrowPubkey,
              });
              if (error) {
                console.warn('[useRemoteBattle] invalid escrow deposit:', error);
                // Tell the depositor WHY their stake was refused — a silent
                // drop leaves them waiting on escrow forever with real sats
                // already locked to the operator.
                const reject: BattleDepositRejectPayload = { type: 'battle-deposit-reject', battleId, reason: error };
                void publishSync(reject, { battleId, opponentPubkey });
                return;
              }
              // Static validation (amount/lock/mint) cannot tell a fresh stake
              // from a re-sent deposit whose proofs were already redeemed —
              // ask the mint before trusting the opponent's stake.
              const spentReason = await checkEscrowDepositSpentState(deposit.token);
              if (spentReason) {
                console.warn('[useRemoteBattle] escrow deposit failed spent-state check:', spentReason);
                const reject: BattleDepositRejectPayload = { type: 'battle-deposit-reject', battleId, reason: spentReason };
                void publishSync(reject, { battleId, opponentPubkey });
                return;
              }
              // The sync channel only carries messages from the opponent — in
              // the host role that is always the guest. Derive the slot from
              // OUR role instead of trusting the payload's claimed
              // playerIndex, which a malicious peer could use to overwrite
              // our own deposit slot with their (invalid) token.
              updateEscrow({ guestDepositToken: deposit.token });
              // End-to-end receipt confirmation: the depositor keeps its
              // journaled deposit token (and retransmits) until this arrives.
              const ack: BattleDepositAckPayload = { type: 'battle-deposit-ack', battleId };
              void publishSync(ack, { battleId, opponentPubkey });
            } else if (payload.type === 'battle-deposit-ack') {
              updateEscrow({ myDepositAcked: true });
            } else if (payload.type === 'battle-deposit-reject') {
              const reason = (payload as BattleDepositRejectPayload).reason;
              console.warn('[useRemoteBattle] opponent rejected our escrow deposit:', reason);
              updateEscrow({ depositRejectReason: reason });
            }
          } else {
            if (payload.type === 'battle-state') {
              lastHostSnapshotRef.current = payload.state;
              setState((prev) => ({ ...prev, hostSnapshot: payload.state }));
            } else if (payload.type === 'battle-finished') {
              // Keep the raw host-signed event: the escrow operator verifies
              // it as the outcome proof when the guest claims the prize.
              setState((prev) => ({ ...prev, phase: 'finished', winner: payload.winner, hostFinishedEvent: event }));
              stopSync();
            } else if (payload.type === 'battle-cancel') {
              setState((prev) => ({ ...prev, phase: 'cancelled' }));
              stopSync();
            } else if (payload.type === 'battle-escrow-deposit') {
              const deposit = payload as BattleEscrowDepositPayload;
              const expectedAmount = stateRef.current.matchOptions?.prizeAmount ?? 0;
              const agreedMint = stateRef.current.escrow.agreedMint;
              const error = validateEscrowDeposit?.(deposit.token, 0, expectedAmount, agreedMint, {
                hostEscrowPubkey: stateRef.current.escrow.hostEscrowPubkey,
                guestEscrowPubkey: stateRef.current.escrow.guestEscrowPubkey,
              });
              if (error) {
                console.warn('[useRemoteBattle] invalid escrow deposit:', error);
                const reject: BattleDepositRejectPayload = { type: 'battle-deposit-reject', battleId, reason: error };
                void publishSync(reject, { battleId, opponentPubkey });
                return;
              }
              // Same spent-state check as the host branch above.
              const spentReason = await checkEscrowDepositSpentState(deposit.token);
              if (spentReason) {
                console.warn('[useRemoteBattle] escrow deposit failed spent-state check:', spentReason);
                const reject: BattleDepositRejectPayload = { type: 'battle-deposit-reject', battleId, reason: spentReason };
                void publishSync(reject, { battleId, opponentPubkey });
                return;
              }
              // Guest role: the opponent on this channel is always the host
              // (see the host-branch comment above).
              updateEscrow({ hostDepositToken: deposit.token });
              const ack: BattleDepositAckPayload = { type: 'battle-deposit-ack', battleId };
              void publishSync(ack, { battleId, opponentPubkey });
            } else if (payload.type === 'battle-deposit-ack') {
              updateEscrow({ myDepositAcked: true });
            } else if (payload.type === 'battle-deposit-reject') {
              const reason = (payload as BattleDepositRejectPayload).reason;
              console.warn('[useRemoteBattle] opponent rejected our escrow deposit:', reason);
              updateEscrow({ depositRejectReason: reason });
            }
          }
        },
      });
    },
    [nostr, stopSync, user?.signer, startFight, validateEscrowDeposit, updateEscrow, publishSync],
  );

  const sendInvite = useCallback(
    async (
      opponentPubkey: string,
      localPet: PetsCompanion,
      matchOptions: RemoteBattleMatchOptions,
      hostEscrowPubkey?: string,
      hostDepositMint?: string,
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
      if (matchOptions.mode === 'real-sats' && !normalizeEscrowPubkey(hostEscrowPubkey)) {
        setError('Real-sats battles require a valid escrow pubkey.');
        return;
      }
      // Store/send the x-only form so both sides and the escrow operator
      // compare the same representation (derived keys are 66-char compressed).
      const normalizedHostEscrowPubkey = normalizeEscrowPubkey(hostEscrowPubkey) ?? hostEscrowPubkey;
      // The host leads mint coordination: both deposits must come from this
      // mint or the escrow operator's release fails on a mixed-mint pair.
      const agreedMint =
        matchOptions.mode === 'real-sats' && hostDepositMint
          ? safeNormalizeMintUrl(hostDepositMint) || undefined
          : undefined;

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
        escrow: {
          mode: matchOptions.mode,
          phase: matchOptions.mode === 'real-sats' ? 'awaiting_pubkeys' : 'none',
          hostEscrowPubkey: normalizedHostEscrowPubkey,
          agreedMint,
        },
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
          mode: matchOptions.mode,
          hostEscrowPubkey: normalizedHostEscrowPubkey,
          hostDepositMint: agreedMint,
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
        inviteIntervalRef.current = setInterval(() => {
          const elapsed = nowMs() - start;
          const remaining = Math.max(0, INVITE_TIMEOUT_MS - elapsed);
          setState((prev) => ({ ...prev, timeLeftMs: remaining }));
          if (remaining <= 0 && inviteIntervalRef.current) {
            clearInterval(inviteIntervalRef.current);
            inviteIntervalRef.current = null;
          }
        }, 250);

        inviteTimerRef.current = setTimeout(() => {
          if (inviteIntervalRef.current) {
            clearInterval(inviteIntervalRef.current);
            inviteIntervalRef.current = null;
          }
          setState((prev) =>
            prev.phase === 'inviting' ? { ...prev, phase: 'expired', timeLeftMs: 0 } : prev,
          );
          stopSync();
        }, INVITE_TIMEOUT_MS);
      } catch (err) {
        clearInviteTimer();
        stopSync();
        const message = err instanceof Error ? err.message : 'Failed to send invite';
        setError(message);
      }
    },
    [clearInviteTimer, sendMessage, setError, startSyncListener, stopSync, user],
  );

  const acceptInvite = useCallback(
    async (invite: BattleInvitePayload, localPet: PetsCompanion, guestEscrowPubkey?: string) => {
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
      if (invite.mode === 'real-sats' && !normalizeEscrowPubkey(guestEscrowPubkey)) {
        setError('Real-sats battles require a valid escrow pubkey.');
        return;
      }
      // Self-battles are nonsense (sendInvite guards this too, but the invite
      // itself is attacker-controlled DM content).
      if (invite.inviterPubkey === user.pubkey) {
        setError('This battle request came from your own key.');
        return;
      }
      // Stake sanity: the invite's prizeAmount is attacker-controlled and the
      // accepted match auto-deposits it. Reject non-positive, fractional or
      // absurd stakes before the wallet is ever touched.
      if (invite.mode === 'real-sats') {
        const prize = invite.prizeAmount;
        if (!Number.isInteger(prize) || prize <= 0 || prize > 1_000_000) {
          setError('This battle request has an invalid stake amount.');
          return;
        }
      }
      // Round duration is attacker-controlled too: an absurd value (e.g. an
      // hour) stretches the battle past the escrow deposit's refund locktime,
      // letting a losing host reclaim their stake via the refund path and
      // break the operator's release. Battles are short — cap hard.
      if (
        !Number.isInteger(invite.roundDurationSeconds) ||
        invite.roundDurationSeconds < 10 ||
        invite.roundDurationSeconds > 600
      ) {
        setError('This battle request has an invalid round duration.');
        return;
      }

      // Store/send x-only forms on both sides: the guest's own derived key is
      // 66-char compressed, and the host's key arrives attacker-controlled in
      // the invite, so normalize before it reaches the escrow operator.
      const normalizedGuestEscrowPubkey = normalizeEscrowPubkey(guestEscrowPubkey) ?? guestEscrowPubkey;
      const normalizedHostEscrowPubkey = normalizeEscrowPubkey(invite.hostEscrowPubkey) ?? invite.hostEscrowPubkey;

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
          mode: invite.mode,
        },
        error: null,
        timeLeftMs: 0,
        winner: null,
        escrow: {
          mode: invite.mode,
          phase: invite.mode === 'real-sats' ? 'locking' : 'none',
          hostEscrowPubkey: normalizedHostEscrowPubkey,
          guestEscrowPubkey: normalizedGuestEscrowPubkey,
          // Lock to the host's advertised deposit mint — the operator rejects
          // mixed-mint releases, so matching it is the only way either stake
          // can ever be paid out.
          agreedMint: invite.mode === 'real-sats' && invite.hostDepositMint
            ? safeNormalizeMintUrl(invite.hostDepositMint) || undefined
            : undefined,
        },
      });

      try {
        const payload: BattleAcceptPayload = {
          type: 'battle-accept',
          battleId: invite.battleId,
          guestPet: localPet,
          mode: invite.mode,
          guestEscrowPubkey: normalizedGuestEscrowPubkey,
        };
        // Send both a formal NIP-17 DM and an ephemeral sync accept so the host
        // sees it immediately even if DM relays are slow. The sync publish gets
        // the route explicitly — stateRef still holds the pre-accept 'idle'
        // state (battleId/opponentPubkey null) until the next render, so
        // relying on it would silently drop the accept.
        await Promise.all([
          sendMessage({
            recipientPubkey: invite.inviterPubkey,
            content: JSON.stringify(payload),
            subject: BATTLE_INVITE_SUBJECT,
          }),
          publishSync(payload, { battleId: invite.battleId, opponentPubkey: invite.inviterPubkey }),
        ]);
        startSyncListener(invite.battleId, invite.inviterPubkey, 'guest');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to accept invite';
        setError(message);
        stopSync();
      }
    },
    [clearInviteTimer, sendMessage, publishSync, setError, startSyncListener, stopSync, user],
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
      // Send both a DM and an ephemeral sync cancel so the guest sees it
      // immediately even if DM relays are slow.
      await Promise.all([
        sendMessage({
          recipientPubkey: current.opponentPubkey,
          content: JSON.stringify(payload),
          subject: BATTLE_INVITE_SUBJECT,
        }),
        publishSync(payload, { battleId: current.battleId, opponentPubkey: current.opponentPubkey }),
      ]);
      setState((prev) => ({ ...prev, phase: 'cancelled' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel invite';
      setError(message);
    } finally {
      stopSync();
    }
  }, [clearInviteTimer, publishSync, sendMessage, setError, stopSync]);

  const sendEscrowDeposit = useCallback(
    async (token: string): Promise<boolean> => {
      const current = stateRef.current;
      if (!current.battleId || !current.opponentPubkey) return false;
      if (current.escrow.mode !== 'real-sats') return false;
      if (typeof token !== 'string' || token.length === 0) return false;

      const playerIndex = current.role === 'host' ? 0 : 1;
      const payload: BattleEscrowDepositPayload = {
        type: 'battle-escrow-deposit',
        battleId: current.battleId,
        playerIndex,
        token,
        amount: current.matchOptions?.prizeAmount ?? 0,
      };
      // Await the publish and report failure: the caller's wallet was already
      // debited for this token, so a lost publish must surface, not vanish.
      const event = await publishSync(payload);
      if (!event) return false;
      updateEscrow(playerIndex === 0 ? { hostDepositToken: token } : { guestDepositToken: token });
      return true;
    },
    [publishSync, updateEscrow],
  );

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
    async (winner: 0 | 1 | null) => {
      // TRUST MODEL (tracked as task #21, the planned 2-of-3 escrow primitive):
      // the battle outcome is attested solely by this host-signed
      // battle-finished event — the guest never countersigns or even
      // acknowledges the result. The host also runs the authoritative game
      // simulation (the guest only applies host snapshots), so a patched host
      // client controls both the outcome and the only 'proof' the escrow
      // operator sees at /release, and could award itself both real-sats
      // stakes. The operator is a trusted service that socially polices this
      // until the multisig escrow primitive replaces host-only attestation.
      const current = stateRef.current;
      if (current.role !== 'host' || !current.battleId) return undefined;
      const payload: BattleFinishedPayload = {
        type: 'battle-finished',
        battleId: current.battleId,
        winner,
      };
      const event = await publishSync(payload);
      setState((prev) => ({ ...prev, phase: 'finished', winner }));
      stopSync();
      return event;
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
      escrow: resetEscrow(),
      hostFinishedEvent: null,
    });
  }, [clearInviteTimer, stopSync, resetEscrow]);



  // Real-sats: the 800ms auto-start timer almost always fires before both
  // escrow deposits land, and startFight's escrow gate silently swallows it.
  // Watch for escrow readiness and start the fight then.
  useEffect(() => {
    if (state.phase !== 'accepted' || state.role !== 'host') return;
    if (state.escrow.mode !== 'real-sats' || state.escrow.phase !== 'ready') return;
    startFight();
  }, [state.phase, state.role, state.escrow.mode, state.escrow.phase, startFight]);

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
      sendEscrowDeposit,
      startFight,
      sendHostSnapshot,
      sendGuestInput,
      sendFinished,
      reset,
      guestInputRef,
    }),
    [state, sendInvite, acceptInvite, declineInvite, cancelInvite, sendEscrowDeposit, startFight, sendHostSnapshot, sendGuestInput, sendFinished, reset, guestInputRef],
  );
}
