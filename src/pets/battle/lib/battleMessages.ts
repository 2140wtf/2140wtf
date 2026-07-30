import type { NostrSigner } from '@nostrify/nostrify';
import type { PlayerInput } from '../types/battle.types';
import type { PetsCompanion } from '@/pets/core/lib/pets';

/** Ephemeral kind for in-match battle synchronization. */
export const BATTLE_SYNC_KIND = 21124;

/** NIP-17 subject tag used for battle invitations and lifecycle messages. */
export const BATTLE_INVITE_SUBJECT = 'battle-invite';

export type BattleMessageType =
  | 'battle-invite'
  | 'battle-accept'
  | 'battle-decline'
  | 'battle-cancel'
  | 'battle-state'
  | 'battle-input'
  | 'battle-finished'
  | 'battle-escrow-deposit'
  | 'battle-escrow-ready'
  | 'battle-deposit-ack'
  | 'battle-deposit-reject';

export type BattleMode = 'demo-sats' | 'btc-sats' | 'real-sats';

export interface BattleInvitePayload {
  type: 'battle-invite';
  battleId: string;
  inviterPubkey: string;
  inviterPet: PetsCompanion;
  prizeAmount: number;
  roundDurationSeconds: number;
  /** Unix ms when the invite was sent. */
  sentAt: number;
  /** Battle economy mode. */
  mode: BattleMode;
  /** Host's Cashu P2PK pubkey used for escrow negotiation. */
  hostEscrowPubkey?: string;
  /**
   * The mint the host will deposit from (real-sats only). The escrow operator
   * rejects mixed-mint releases, so the guest must stake from the SAME mint —
   * advertising it up front lets the guest refuse invites it cannot match
   * instead of stranding both stakes.
   */
  hostDepositMint?: string;
}

export interface BattleAcceptPayload {
  type: 'battle-accept';
  battleId: string;
  guestPet: PetsCompanion;
  mode: BattleMode;
  guestEscrowPubkey?: string;
}

export interface BattleDeclinePayload {
  type: 'battle-decline';
  battleId: string;
}

export interface BattleCancelPayload {
  type: 'battle-cancel';
  battleId: string;
}

export interface BattleStatePayload {
  type: 'battle-state';
  battleId: string;
  /** Authoritative host state snapshot (JSON-serializable subset). */
  state: RemoteBattleStateSnapshot;
}

export interface BattleInputPayload {
  type: 'battle-input';
  battleId: string;
  input: PlayerInput;
}

export interface BattleFinishedPayload {
  type: 'battle-finished';
  battleId: string;
  winner: 0 | 1 | null;
}

export interface BattleEscrowDepositPayload {
  type: 'battle-escrow-deposit';
  battleId: string;
  /** 0 = host, 1 = guest */
  playerIndex: 0 | 1;
  /** Cashu token string locked to the operator escrow pubkey. */
  token: string;
  amount: number;
}

export interface BattleEscrowReadyPayload {
  type: 'battle-escrow-ready';
  battleId: string;
}

/**
 * End-to-end confirmation that the opponent RECEIVED and recorded our escrow
 * deposit. A relay ack only proves one relay accepted the ephemeral sync
 * event — without this, a lost deposit message leaves the depositor's stake
 * locked to the operator with no retained token and no way to distinguish
 * "opponent hasn't deposited" from "my deposit never arrived".
 */
export interface BattleDepositAckPayload {
  type: 'battle-deposit-ack';
  battleId: string;
}

/** Sent when a deposit fails validation so the depositor learns WHY. */
export interface BattleDepositRejectPayload {
  type: 'battle-deposit-reject';
  battleId: string;
  reason: string;
}

export type BattleMessagePayload =
  | BattleInvitePayload
  | BattleAcceptPayload
  | BattleDeclinePayload
  | BattleCancelPayload
  | BattleStatePayload
  | BattleInputPayload
  | BattleFinishedPayload
  | BattleEscrowDepositPayload
  | BattleEscrowReadyPayload
  | BattleDepositAckPayload
  | BattleDepositRejectPayload;

/**
 * Minimal serializable state snapshot sent by the host each tick.
 *
 * We strip the heavy `PetsCompanion` objects and roundtrip only the values
 * needed for rendering and gameplay. Pets are established during setup and
 * never change mid-match.
 */
export interface RemoteBattleStateSnapshot {
  status: 'countdown' | 'fighting' | 'finished';
  fighters: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    facing: 1 | -1;
    health: number;
    maxHealth: number;
    energy: number;
    maxEnergy: number;
    isBlocking: boolean;
    isHit: boolean;
    width: number;
    height: number;
    attackCooldownUntil: number;
    fireballCooldownUntil: number;
    hitUntil: number;
    /** Render-only move state (the guest never simulates). */
    lastHitAt: number;
    activeMove: { id: string; startedAt: number } | null;
    dashUntil: number;
    dashDir: 1 | -1;
  }>;
  projectiles: Array<{
    id: string;
    owner: 0 | 1;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    damage: number;
    stunMs: number;
    spawnedAt: number;
  }>;
  timeRemaining: number;
  winner: 0 | 1 | null;
}

export async function encryptBattleMessage(
  signer: NostrSigner,
  recipientPubkey: string,
  payload: BattleMessagePayload,
): Promise<string> {
  if (!signer.nip44) throw new Error('Signer does not support NIP-44 encryption');
  return signer.nip44.encrypt(recipientPubkey, JSON.stringify(payload));
}

export async function decryptBattleMessage(
  signer: NostrSigner,
  senderPubkey: string,
  ciphertext: string,
): Promise<BattleMessagePayload | null> {
  if (!signer.nip44) return null;
  try {
    const plaintext = await signer.nip44.decrypt(senderPubkey, ciphertext);
    return JSON.parse(plaintext) as BattleMessagePayload;
  } catch {
    return null;
  }
}
