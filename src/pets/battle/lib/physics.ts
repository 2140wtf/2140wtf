import { ARENA_WIDTH, COUNTDOWN_SECONDS, FIREBALL_HIT_STUN_MS, HIT_KNOCKBACK_X, HIT_KNOCKBACK_Y } from './constants';
import { computeFighterAttributes, deriveFighterStats } from './fighterStats';
import type {
  BattleFighter,
  BattlePlayerIndex,
  BattleProjectile,
  BattleState,
  BattleStatus,
  PlayerInput,
} from '../types/battle.types';

export function createFighter(
  pet: BattleFighter['pet'],
  x: number,
  facing: 1 | -1,
): BattleFighter {
  const stats = deriveFighterStats(pet);
  const { width, height, maxHealth, maxEnergy } = computeFighterAttributes(pet, stats);

  return {
    pet,
    x,
    y: 0,
    vx: 0,
    vy: 0,
    width,
    height,
    facing,
    health: maxHealth,
    maxHealth,
    energy: maxEnergy,
    maxEnergy,
    isBlocking: false,
    isHit: false,
    hitUntil: 0,
    attackCooldownUntil: 0,
    fireballCooldownUntil: 0,
    stats,
  };
}

export function createInitialState(
  pet1: BattleFighter['pet'],
  pet2: BattleFighter['pet'],
  now: number,
  roundDurationSeconds: number,
): BattleState {
  return {
    status: 'countdown',
    fighters: [
      createFighter(pet1, 180, 1),
      createFighter(pet2, ARENA_WIDTH - 180, -1),
    ],
    projectiles: [],
    winner: null,
    timeRemaining: COUNTDOWN_SECONDS,
    lastFrameAt: now,
    roundDurationSeconds,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function halfWidth(fighter: BattleFighter): number {
  return fighter.width / 2;
}

function fighterLeft(fighter: BattleFighter): number {
  return fighter.x - halfWidth(fighter);
}

function fighterRight(fighter: BattleFighter): number {
  return fighter.x + halfWidth(fighter);
}

function fighterTop(fighter: BattleFighter): number {
  return fighter.y + fighter.height;
}

function rectsOverlap(
  aLeft: number,
  aRight: number,
  aBottom: number,
  aTop: number,
  bLeft: number,
  bRight: number,
  bBottom: number,
  bTop: number,
): boolean {
  return aLeft < bRight && aRight > bLeft && aBottom < bTop && aTop > bBottom;
}

export function applyDamage(
  fighter: BattleFighter,
  rawDamage: number,
  now: number,
  stunMs: number,
  knockbackDirection: 1 | -1,
  knockbackX: number,
  knockbackY: number,
): void {
  const reduced = fighter.isBlocking
    ? rawDamage * (1 - fighter.stats.blockDamageReduction)
    : rawDamage;
  const damage = Math.max(1, Math.floor(reduced));
  fighter.health = clamp(fighter.health - damage, 0, fighter.maxHealth);
  fighter.hitUntil = Math.max(fighter.hitUntil, now + stunMs);
  fighter.vx = knockbackDirection * knockbackX;
  fighter.vy = knockbackY;
}

function performSwordStrike(
  attacker: BattleFighter,
  defender: BattleFighter,
): boolean {
  const reachStart = attacker.x + attacker.facing * halfWidth(attacker);
  const reachEnd = reachStart + attacker.facing * attacker.stats.swordRange;
  const swordLeft = Math.min(reachStart, reachEnd);
  const swordRight = Math.max(reachStart, reachEnd);
  const swordBottom = attacker.y + attacker.height * 0.25;
  const swordTop = attacker.y + attacker.height * 0.85;

  return rectsOverlap(
    swordLeft,
    swordRight,
    swordBottom,
    swordTop,
    fighterLeft(defender),
    fighterRight(defender),
    defender.y,
    fighterTop(defender),
  );
}

function projectileHitsFighter(
  projectile: BattleProjectile,
  fighter: BattleFighter,
): boolean {
  return rectsOverlap(
    projectile.x - projectile.radius,
    projectile.x + projectile.radius,
    projectile.y - projectile.radius,
    projectile.y + projectile.radius,
    fighterLeft(fighter),
    fighterRight(fighter),
    fighter.y,
    fighterTop(fighter),
  );
}

export function stepFighter(
  fighter: BattleFighter,
  input: PlayerInput,
  opponent: BattleFighter,
  now: number,
  dt: number,
  playerIndex: BattlePlayerIndex,
): { fighter: BattleFighter; spawnedProjectile: BattleProjectile | null } {
  const next: BattleFighter = { ...fighter };
  let spawnedProjectile: BattleProjectile | null = null;

  const onGround = next.y <= 0;
  const canAct = now >= next.hitUntil;
  const isStunned = !canAct;

  next.isBlocking = canAct && onGround && input.block;

  if (!isStunned) {
    const speed = next.isBlocking ? next.stats.blockMoveSpeed : next.stats.moveSpeed;
    let desiredVx = 0;
    if (input.left) desiredVx -= speed;
    if (input.right) desiredVx += speed;
    next.vx = desiredVx;

    if (onGround && input.jump) {
      next.vy = next.stats.jumpVelocity;
      next.y = 0.1;
    }

    if (opponent.x > next.x) {
      next.facing = 1;
    } else if (opponent.x < next.x) {
      next.facing = -1;
    }

    if (input.sword && now >= next.attackCooldownUntil && !next.isBlocking) {
      next.attackCooldownUntil = now + next.stats.swordCooldownMs;
      if (performSwordStrike(next, opponent)) {
        applyDamage(
          opponent,
          next.stats.swordDamage,
          now,
          next.stats.swordHitStunMs,
          next.facing,
          next.stats.hitKnockbackX,
          next.stats.hitKnockbackY,
        );
      }
    }

    if (
      input.fireball &&
      now >= next.fireballCooldownUntil &&
      !next.isBlocking &&
      next.energy >= next.stats.fireballEnergyCost
    ) {
      next.energy -= next.stats.fireballEnergyCost;
      next.fireballCooldownUntil = now + next.stats.fireballCooldownMs;
      spawnedProjectile = {
        id: `${now}-${Math.random().toString(36).slice(2)}`,
        owner: playerIndex,
        x: next.x + next.facing * (halfWidth(next) + 10),
        y: next.y + next.height * 0.55,
        vx: next.facing * next.stats.fireballSpeed,
        radius: next.stats.fireballRadius,
        damage: next.stats.fireballDamage,
        spawnedAt: now,
      };
    }
  } else {
    next.isBlocking = false;
  }

  next.x += next.vx * dt;
  next.vy += next.stats.gravity * dt;
  next.y += next.vy * dt;

  next.x = clamp(next.x, halfWidth(next), ARENA_WIDTH - halfWidth(next));
  if (next.y <= 0) {
    next.y = 0;
    next.vy = 0;
  }

  next.energy = clamp(
    next.energy + next.stats.energyRegenPerSecond * dt,
    0,
    next.maxEnergy,
  );

  next.isHit = now < next.hitUntil;

  return { fighter: next, spawnedProjectile };
}

export function stepProjectiles(
  projectiles: BattleProjectile[],
  fighters: [BattleFighter, BattleFighter],
  now: number,
  dt: number,
): { projectiles: BattleProjectile[]; hitFighters: Set<BattlePlayerIndex> } {
  const remaining: BattleProjectile[] = [];
  const hitFighters = new Set<BattlePlayerIndex>();

  for (const projectile of projectiles) {
    const moved: BattleProjectile = {
      ...projectile,
      x: projectile.x + projectile.vx * dt,
      y: projectile.y,
    };

    let hit = false;
    for (let i = 0; i < fighters.length; i++) {
      const index = i as BattlePlayerIndex;
      if (projectile.owner === index) continue;

      if (projectileHitsFighter(moved, fighters[index])) {
        applyDamage(
          fighters[index],
          projectile.damage,
          now,
          FIREBALL_HIT_STUN_MS,
          Math.sign(projectile.vx) as 1 | -1,
          HIT_KNOCKBACK_X,
          HIT_KNOCKBACK_Y,
        );
        hitFighters.add(index);
        hit = true;
        break;
      }
    }

    const outOfBounds = moved.x < -50 || moved.x > ARENA_WIDTH + 50;
    if (!hit && !outOfBounds) {
      remaining.push(moved);
    }
  }

  return { projectiles: remaining, hitFighters };
}

export function determineWinner(
  fighters: [BattleFighter, BattleFighter],
): BattlePlayerIndex | null {
  const p1Dead = fighters[0].health <= 0;
  const p2Dead = fighters[1].health <= 0;

  if (p1Dead && p2Dead) return null;
  if (p1Dead) return 1;
  if (p2Dead) return 0;

  return null;
}

/** Winner when the round timer hits zero: higher health wins; ties are draws. */
function determineTimeOutWinner(
  fighters: [BattleFighter, BattleFighter],
): BattlePlayerIndex | null {
  if (fighters[0].health === fighters[1].health) return null;
  return fighters[0].health > fighters[1].health ? 0 : 1;
}

export function stepBattleState(
  state: BattleState,
  inputs: { p1: PlayerInput; p2: PlayerInput },
  now: number,
): BattleState {
  if (state.status === 'finished') return state;

  const dt = Math.min(0.05, (now - state.lastFrameAt) / 1000);

  if (state.status === 'countdown') {
    const timeRemaining = state.timeRemaining - dt;
    if (timeRemaining <= 0) {
      return {
        ...state,
        status: 'fighting',
        timeRemaining: state.roundDurationSeconds,
        lastFrameAt: now,
      };
    }
    return { ...state, timeRemaining, lastFrameAt: now };
  }

  const nextFighters: [BattleFighter, BattleFighter] = [
    { ...state.fighters[0] },
    { ...state.fighters[1] },
  ];
  const nextProjectiles: BattleProjectile[] = [...state.projectiles];

  for (let i = 0; i < nextFighters.length; i++) {
    const index = i as BattlePlayerIndex;
    const opponentIndex = (1 - i) as BattlePlayerIndex;
    const result = stepFighter(
      nextFighters[index],
      index === 0 ? inputs.p1 : inputs.p2,
      nextFighters[opponentIndex],
      now,
      dt,
      index,
    );
    nextFighters[index] = result.fighter;
    if (result.spawnedProjectile) {
      nextProjectiles.push(result.spawnedProjectile);
    }
  }

  const { projectiles: remainingProjectiles } = stepProjectiles(
    nextProjectiles,
    nextFighters,
    now,
    dt,
  );

  const timeRemaining = Math.max(0, state.timeRemaining - dt);
  const winner = determineWinner(nextFighters);
  const finished = winner !== null || timeRemaining <= 0;

  const nextStatus: BattleStatus = finished ? 'finished' : 'fighting';
  const finalWinner: BattlePlayerIndex | null =
    nextStatus === 'finished' && winner === null
      ? determineTimeOutWinner(nextFighters)
      : winner;

  return {
    ...state,
    status: nextStatus,
    fighters: nextFighters,
    projectiles: remainingProjectiles,
    winner: finalWinner,
    timeRemaining,
    lastFrameAt: now,
  };
}

export function createSetupState(
  pet1: BattleFighter['pet'],
  pet2: BattleFighter['pet'],
  roundDurationSeconds: number,
): BattleState {
  return {
    status: 'setup',
    fighters: [
      createFighter(pet1, 180, 1),
      createFighter(pet2, ARENA_WIDTH - 180, -1),
    ],
    projectiles: [],
    winner: null,
    timeRemaining: roundDurationSeconds,
    lastFrameAt: performance.now(),
    roundDurationSeconds,
  };
}
