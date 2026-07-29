import type { PetsCompanion } from '@/pets/core/lib/pets';
import type { BattleFighterStats } from '../lib/fighterStats';
import type { ActiveMove } from '../lib/moves';
import type { RemoteBattleStateSnapshot } from '../lib/battleMessages';

export type BattlePlayerIndex = 0 | 1;

export type BattleStatus = 'setup' | 'countdown' | 'fighting' | 'finished';

export interface BattleFighter {
  pet: PetsCompanion;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  facing: 1 | -1;
  health: number;
  maxHealth: number;
  energy: number;
  maxEnergy: number;
  isBlocking: boolean;
  isHit: boolean;
  hitUntil: number;
  /** Timestamp of the most recent hit taken (drives impact-flash rendering). */
  lastHitAt: number;
  attackCooldownUntil: number;
  fireballCooldownUntil: number;
  stats: BattleFighterStats;
  /** Move currently being executed, null when free-acting. */
  activeMove: ActiveMove | null;
  /** Bitmask of melee hit windows already applied for the active move. */
  moveHitsDone: number;
  moveProjectileFired: boolean;
  /** Slash chain stage (1 = slash landed, 2 = slash-2 landed), 0 = no chain. */
  comboStage: number;
  /** Chain window deadline for continuing the slash combo. */
  comboUntil: number;
  /** Dash state: dash movement is active while now < dashUntil. */
  dashUntil: number;
  dashDir: 1 | -1;
  /** Double-tap detection: last direction tap direction and timestamp. */
  lastTapDir: 1 | -1;
  lastTapAt: number;
  /** Previous-frame held state for edge detection. */
  prevJump: boolean;
  prevLeft: boolean;
  prevRight: boolean;
  /** Flip-over trajectory endpoints (start x, target x). */
  moveX0: number;
  moveX1: number;
}

export interface BattleProjectile {
  id: string;
  owner: BattlePlayerIndex;
  x: number;
  y: number;
  vx: number;
  /** Vertical velocity for diagonal fireballs (0 = straight shot). */
  vy: number;
  radius: number;
  damage: number;
  stunMs: number;
  spawnedAt: number;
}

export interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  block: boolean;
  sword: boolean;
  fireball: boolean;
}

export interface BattleInputState {
  p1: PlayerInput;
  p2: PlayerInput;
}

export interface BattleState {
  status: BattleStatus;
  fighters: [BattleFighter, BattleFighter];
  projectiles: BattleProjectile[];
  winner: BattlePlayerIndex | null;
  timeRemaining: number;
  lastFrameAt: number;
  roundDurationSeconds: number;
}

export interface BattleMatchOptions {
  prizeAmount: number;
  roundDurationSeconds: number;
  /** When true, player 2 is controlled by AI instead of keyboard/touch. */
  isAiOpponent?: boolean;
  /** Remote mode. 'host' runs the authoritative simulation; 'guest' renders host snapshots. */
  remoteMode?: 'host' | 'guest';
  /** Host-only: called every tick with a serializable state snapshot. */
  onHostSnapshot?: (snapshot: RemoteBattleStateSnapshot) => void;
  /** Guest-only: called every tick with the local player's P2 input. */
  onGuestInput?: (input: PlayerInput) => void;
  /** Host-only: ref to the latest remote P2 input received from the guest. */
  remoteP2InputRef?: React.MutableRefObject<PlayerInput | null>;
}

export interface BattleMatchResult {
  winner: BattlePlayerIndex;
  fighterNames: [string, string];
  prizeAmount: number;
}
