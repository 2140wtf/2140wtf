import type { PetsCompanion } from '@/pets/core/lib/pets';

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
  attackCooldownUntil: number;
  fireballCooldownUntil: number;
}

export interface BattleProjectile {
  id: string;
  owner: BattlePlayerIndex;
  x: number;
  y: number;
  vx: number;
  radius: number;
  damage: number;
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
}

export interface BattleMatchOptions {
  prizeAmount: number;
  roundDurationSeconds: number;
}

export interface BattleMatchResult {
  winner: BattlePlayerIndex;
  fighterNames: [string, string];
  prizeAmount: number;
}
