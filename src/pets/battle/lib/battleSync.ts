import { deriveFighterStats, computeFighterAttributes } from './fighterStats';
import type { RemoteBattleStateSnapshot } from './battleMessages';
import type { BattleFighter, BattleProjectile, BattleState } from '../types/battle.types';
import type { PetsCompanion } from '@/pets/core/lib/pets';

/**
 * Serialize a host BattleState into the compact snapshot sent over the network.
 */
export function createBattleSnapshot(state: BattleState): RemoteBattleStateSnapshot {
  return {
    status:
      state.status === 'setup' ? 'fighting' : state.status,
    fighters: state.fighters.map((f) => ({
      x: f.x,
      y: f.y,
      vx: f.vx,
      vy: f.vy,
      facing: f.facing,
      health: f.health,
      maxHealth: f.maxHealth,
      energy: f.energy,
      maxEnergy: f.maxEnergy,
      isBlocking: f.isBlocking,
      isHit: f.isHit,
      width: f.width,
      height: f.height,
      attackCooldownUntil: f.attackCooldownUntil,
      fireballCooldownUntil: f.fireballCooldownUntil,
      hitUntil: f.hitUntil,
    })),
    projectiles: state.projectiles.map((p) => ({
      id: p.id,
      owner: p.owner,
      x: p.x,
      y: p.y,
      vx: p.vx,
      radius: p.radius,
      damage: p.damage,
      spawnedAt: p.spawnedAt,
    })),
    timeRemaining: state.timeRemaining,
    winner: state.winner,
  };
}

function createFighterFromSnapshot(
  pet: PetsCompanion,
  snapshot: RemoteBattleStateSnapshot['fighters'][number],
): BattleFighter {
  const stats = deriveFighterStats(pet);
  const { width, height, maxHealth, maxEnergy } = computeFighterAttributes(pet, stats);

  return {
    pet,
    x: snapshot.x,
    y: snapshot.y,
    vx: snapshot.vx,
    vy: snapshot.vy,
    width: snapshot.width ?? width,
    height: snapshot.height ?? height,
    facing: snapshot.facing,
    health: snapshot.health,
    maxHealth: snapshot.maxHealth ?? maxHealth,
    energy: snapshot.energy,
    maxEnergy: snapshot.maxEnergy ?? maxEnergy,
    isBlocking: snapshot.isBlocking,
    isHit: snapshot.isHit,
    hitUntil: snapshot.hitUntil,
    attackCooldownUntil: snapshot.attackCooldownUntil,
    fireballCooldownUntil: snapshot.fireballCooldownUntil,
    stats,
  };
}

/**
 * Reconstruct a local BattleState from an authoritative host snapshot.
 *
 * The two pets are fixed for the whole match: fighter 0 is the host's pet and
 * fighter 1 is the guest's pet.
 */
export function applyBattleSnapshot(
  snapshot: RemoteBattleStateSnapshot,
  hostPet: PetsCompanion,
  guestPet: PetsCompanion,
  roundDurationSeconds: number,
  lastFrameAt: number,
): BattleState {
  return {
    status: snapshot.status,
    fighters: [
      createFighterFromSnapshot(hostPet, snapshot.fighters[0]),
      createFighterFromSnapshot(guestPet, snapshot.fighters[1]),
    ] as [BattleFighter, BattleFighter],
    projectiles: snapshot.projectiles.map((p) => ({
      id: p.id,
      owner: p.owner,
      x: p.x,
      y: p.y,
      vx: p.vx,
      radius: p.radius,
      damage: p.damage,
      spawnedAt: p.spawnedAt,
    })) as BattleProjectile[],
    winner: snapshot.winner,
    timeRemaining: snapshot.timeRemaining,
    lastFrameAt,
    roundDurationSeconds,
  };
}
