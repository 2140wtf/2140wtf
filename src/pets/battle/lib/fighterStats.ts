import {
  BLOCK_DAMAGE_REDUCTION,
  BLOCK_MOVE_SPEED,
  ENERGY_REGEN_PER_SECOND,
  FIGHTER_HEIGHT,
  FIGHTER_MAX_ENERGY,
  FIGHTER_MAX_HEALTH,
  FIGHTER_WIDTH,
  FIREBALL_COOLDOWN_MS,
  FIREBALL_DAMAGE,
  FIREBALL_ENERGY_COST,
  FIREBALL_HIT_STUN_MS,
  FIREBALL_RADIUS,
  FIREBALL_SPEED,
  GRAVITY,
  HIT_KNOCKBACK_X,
  HIT_KNOCKBACK_Y,
  JUMP_VELOCITY,
  MOVE_SPEED,
  SWORD_COOLDOWN_MS,
  SWORD_DAMAGE,
  SWORD_HIT_STUN_MS,
  SWORD_RANGE,
} from './constants';
import type {
  PetsArchetype,
  PetsCompanion,
  PetsSize,
  PetsSpecialAbility,
  PetsStage,
} from '@/pets/core/lib/pets';

export interface BattleFighterStats {
  moveSpeed: number;
  blockMoveSpeed: number;
  jumpVelocity: number;
  gravity: number;
  swordDamage: number;
  swordRange: number;
  swordCooldownMs: number;
  swordHitStunMs: number;
  fireballDamage: number;
  fireballSpeed: number;
  fireballRadius: number;
  fireballCooldownMs: number;
  fireballEnergyCost: number;
  fireballHitStunMs: number;
  energyRegenPerSecond: number;
  blockDamageReduction: number;
  hitKnockbackX: number;
  hitKnockbackY: number;
  sizeScale: number;
  healthScale: number;
  energyScale: number;
}

const BASE_STATS: BattleFighterStats = {
  moveSpeed: MOVE_SPEED,
  blockMoveSpeed: BLOCK_MOVE_SPEED,
  jumpVelocity: JUMP_VELOCITY,
  gravity: GRAVITY,
  swordDamage: SWORD_DAMAGE,
  swordRange: SWORD_RANGE,
  swordCooldownMs: SWORD_COOLDOWN_MS,
  swordHitStunMs: SWORD_HIT_STUN_MS,
  fireballDamage: FIREBALL_DAMAGE,
  fireballSpeed: FIREBALL_SPEED,
  fireballRadius: FIREBALL_RADIUS,
  fireballCooldownMs: FIREBALL_COOLDOWN_MS,
  fireballEnergyCost: FIREBALL_ENERGY_COST,
  fireballHitStunMs: FIREBALL_HIT_STUN_MS,
  energyRegenPerSecond: ENERGY_REGEN_PER_SECOND,
  blockDamageReduction: BLOCK_DAMAGE_REDUCTION,
  hitKnockbackX: HIT_KNOCKBACK_X,
  hitKnockbackY: HIT_KNOCKBACK_Y,
  sizeScale: 1,
  healthScale: 1,
  energyScale: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function applyArchetypeModifiers(
  stats: BattleFighterStats,
  archetype: PetsArchetype | undefined,
): void {
  switch (archetype) {
    case 'ghost':
      stats.moveSpeed *= 1.12;
      stats.jumpVelocity *= 1.1;
      stats.swordDamage *= 0.9;
      break;
    case 'runner':
      stats.moveSpeed *= 1.2;
      stats.swordCooldownMs *= 0.9;
      break;
    case 'netrunner':
      stats.fireballDamage *= 1.25;
      stats.fireballCooldownMs *= 0.9;
      stats.energyRegenPerSecond *= 1.15;
      break;
    case 'drone':
      stats.moveSpeed *= 1.1;
      stats.jumpVelocity *= 0.95;
      stats.fireballSpeed *= 1.15;
      break;
    case 'construct':
      stats.healthScale *= 1.25;
      stats.moveSpeed *= 0.85;
      stats.swordDamage *= 1.2;
      stats.hitKnockbackX *= 1.2;
      break;
    case 'cipher':
      stats.swordRange *= 1.15;
      stats.fireballRadius *= 1.15;
      stats.blockDamageReduction = Math.min(
        0.9,
        stats.blockDamageReduction + 0.1,
      );
      break;
    default:
      break;
  }
}

function applyAbilityModifiers(
  stats: BattleFighterStats,
  ability: PetsSpecialAbility | undefined,
): void {
  switch (ability) {
    case 'glitch-step':
      stats.moveSpeed *= 1.15;
      stats.jumpVelocity *= 1.1;
      break;
    case 'overclock':
      stats.swordCooldownMs *= 0.8;
      stats.fireballCooldownMs *= 0.9;
      stats.energyRegenPerSecond *= 1.2;
      break;
    case 'firewall':
      stats.blockDamageReduction = Math.min(
        0.92,
        stats.blockDamageReduction + 0.15,
      );
      break;
    case 'synesthesia':
      stats.energyRegenPerSecond *= 1.25;
      stats.fireballDamage *= 1.1;
      break;
    case 'recursion':
      stats.energyScale *= 1.2;
      stats.fireballEnergyCost *= 0.8;
      break;
    case 'mirror-self':
      stats.healthScale *= 1.15;
      stats.swordDamage *= 1.1;
      break;
    default:
      break;
  }
}

function applySizeModifiers(
  stats: BattleFighterStats,
  size: PetsSize | undefined,
): void {
  switch (size) {
    case 'small':
      stats.sizeScale = 0.82;
      stats.moveSpeed *= 1.1;
      stats.healthScale *= 0.9;
      break;
    case 'large':
      stats.sizeScale = 1.18;
      stats.moveSpeed *= 0.92;
      stats.healthScale *= 1.15;
      stats.swordDamage *= 1.1;
      break;
    default:
      stats.sizeScale = 1;
      break;
  }
}

function applyStageModifiers(
  stats: BattleFighterStats,
  stage: PetsStage | undefined,
): void {
  if (stage === 'baby') {
    stats.healthScale *= 0.8;
    stats.energyScale *= 0.9;
    stats.moveSpeed *= 1.05;
  }
}

/**
 * Derive per-fighter combat stats from the public pet event data.
 *
 * Each pet's stored health/energy, visual archetype, special ability, size and
 * life stage now meaningfully change how it fights: a large Construct tank has
 * more health and knockback but is slower; a Netrunner with Overclock spams
 * stronger fireballs faster; a small baby Ghost is fragile but hard to catch.
 */
export function deriveFighterStats(pet: PetsCompanion): BattleFighterStats {
  const stats: BattleFighterStats = { ...BASE_STATS };

  const health = clamp(pet.stats.health ?? 100, 1, 100);
  const energy = clamp(pet.stats.energy ?? 100, 1, 100);

  stats.healthScale = 0.6 + (health / 100) * 0.8;
  stats.energyScale = 0.6 + (energy / 100) * 0.8;

  applyArchetypeModifiers(stats, pet.visualTraits?.archetype);
  applyAbilityModifiers(stats, pet.visualTraits?.specialAbility);
  applySizeModifiers(stats, pet.visualTraits?.size);
  applyStageModifiers(stats, pet.stage);

  stats.blockDamageReduction = clamp(stats.blockDamageReduction, 0, 1);

  return stats;
}

/**
 * Compute the final pixel dimensions and resource pools for a fighter.
 */
export function computeFighterAttributes(
  pet: PetsCompanion,
  stats: BattleFighterStats,
): {
  width: number;
  height: number;
  maxHealth: number;
  maxEnergy: number;
} {
  return {
    width: Math.round(FIGHTER_WIDTH * stats.sizeScale),
    height: Math.round(FIGHTER_HEIGHT * stats.sizeScale),
    maxHealth: Math.round(FIGHTER_MAX_HEALTH * stats.healthScale),
    maxEnergy: Math.round(FIGHTER_MAX_ENERGY * stats.energyScale),
  };
}
