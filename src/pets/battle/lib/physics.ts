import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  COUNTDOWN_SECONDS,
  DASH_DURATION_MS,
  DASH_SPEED,
  DOUBLE_TAP_MS,
  FIREBALL_DAMAGE,
  FIREBALL_HIT_STUN_MS,
  HIT_KNOCKBACK_X,
  HIT_KNOCKBACK_Y,
  SUPER_JUMP_VELOCITY,
  SWORD_DAMAGE,
} from './constants';
import { computeFighterAttributes, deriveFighterStats } from './fighterStats';
import { MOVE_DEFS, canStartMove, detectMove, endMove, startMove, type MoveDef } from './moves';
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
    lastHitAt: 0,
    attackCooldownUntil: 0,
    fireballCooldownUntil: 0,
    stats,
    activeMove: null,
    moveHitsDone: 0,
    moveProjectileFired: false,
    comboStage: 0,
    comboUntil: 0,
    dashUntil: 0,
    dashDir: facing,
    lastTapDir: facing,
    lastTapAt: 0,
    prevJump: false,
    prevLeft: false,
    prevRight: false,
    moveX0: 0,
    moveX1: 0,
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
  fighter.lastHitAt = now;
  fighter.vx = knockbackDirection * knockbackX;
  fighter.vy = knockbackY;
  // Getting hit cancels whatever move was in flight and breaks the combo.
  fighter.activeMove = null;
  fighter.comboStage = 0;
  fighter.dashUntil = 0;
}

/** Melee hitbox test for a move definition (front, optionally both sides). */
function moveMeleeHits(
  attacker: BattleFighter,
  def: MoveDef,
  defender: BattleFighter,
): boolean {
  const checkSide = (facing: 1 | -1): boolean => {
    const reachStart = attacker.x + facing * halfWidth(attacker);
    const reachEnd = reachStart + facing * (def.range ?? attacker.stats.swordRange);
    const swordLeft = Math.min(reachStart, reachEnd);
    const swordRight = Math.max(reachStart, reachEnd);
    const swordBottom = attacker.y + attacker.height * (def.hitLow ?? 0.25);
    const swordTop = attacker.y + attacker.height * (def.hitHigh ?? 0.85);

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
  };

  return checkSide(attacker.facing) || (def.bothSides === true && checkSide(-attacker.facing as 1 | -1));
}

/** Pet-derived scaling so strong pets hit harder with every move. */
function meleeDamageFor(attacker: BattleFighter, def: MoveDef): number {
  return (def.damage ?? SWORD_DAMAGE) * (attacker.stats.swordDamage / SWORD_DAMAGE);
}

function projectileDamageFor(attacker: BattleFighter, base: number): number {
  return base * (attacker.stats.fireballDamage / FIREBALL_DAMAGE);
}

/** Run one frame of the active move; returns a projectile when one spawns. */
function stepActiveMove(
  fighter: BattleFighter,
  opponent: BattleFighter,
  def: MoveDef,
  now: number,
  dt: number,
  playerIndex: BattlePlayerIndex,
): BattleProjectile | null {
  const elapsed = now - fighter.activeMove!.startedAt;
  let spawnedProjectile: BattleProjectile | null = null;

  if (def.id === 'flip-over') {
    // Scripted arc over the opponent's head; land behind them, facing them.
    const p = Math.min(1, elapsed / def.durationMs);
    fighter.x = fighter.moveX0 + (fighter.moveX1 - fighter.moveX0) * p;
    fighter.y = Math.sin(p * Math.PI) * Math.max(190, opponent.height * 1.25);
    fighter.vx = 0;
    fighter.vy = 0;
    if (p >= 1) {
      fighter.y = 0;
      const dir = fighter.moveX1 >= fighter.moveX0 ? 1 : -1;
      fighter.facing = dir === 1 ? -1 : 1;
      endMove(fighter, now);
    }
    return null;
  }

  // Move-driven movement overrides input while the move runs.
  if (def.vx !== undefined) {
    fighter.vx = def.vx * fighter.facing;
  } else if (fighter.y <= 0) {
    fighter.vx = 0;
  }
  fighter.vy += fighter.stats.gravity * (def.gravityScale ?? 1) * dt;

  if (def.hits) {
    for (let i = 0; i < def.hits.length; i++) {
      if (elapsed >= def.hits[i] && !(fighter.moveHitsDone & (1 << i))) {
        fighter.moveHitsDone |= 1 << i;
        if (moveMeleeHits(fighter, def, opponent)) {
          applyDamage(
            opponent,
            meleeDamageFor(fighter, def),
            now,
            def.stunMs ?? fighter.stats.swordHitStunMs,
            fighter.facing,
            def.knockbackX ?? fighter.stats.hitKnockbackX,
            def.knockbackY ?? fighter.stats.hitKnockbackY,
          );
        }
      }
    }
  }

  if (def.projectile && !fighter.moveProjectileFired && elapsed >= def.projectile.atMs) {
    fighter.moveProjectileFired = true;
    const spec = def.projectile;
    spawnedProjectile = {
      id: `${now}-${Math.random().toString(36).slice(2)}`,
      owner: playerIndex,
      x: fighter.x + fighter.facing * (halfWidth(fighter) + 10),
      y: Math.max(10, fighter.y + fighter.height * 0.55),
      vx: fighter.facing * spec.speed,
      vy: spec.vy ?? 0,
      radius: spec.radius,
      damage: projectileDamageFor(fighter, spec.damage),
      stunMs: spec.stunMs ?? FIREBALL_HIT_STUN_MS,
      spawnedAt: now,
    };
  }

  const landed = fighter.y <= 0 && elapsed > 150;
  if (elapsed >= def.durationMs || (def.id === 'dive-kick' && landed)) {
    endMove(fighter, now);
  }

  return spawnedProjectile;
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

  const leftPressed = input.left && !next.prevLeft;
  const rightPressed = input.right && !next.prevRight;
  const jumpPressed = input.jump && !next.prevJump;

  next.isBlocking = canAct && onGround && input.block && !next.activeMove;

  if (!isStunned) {
    // Double-tap dash / backdash.
    if (!next.activeMove && onGround && (leftPressed || rightPressed)) {
      const dir: 1 | -1 = leftPressed ? -1 : 1;
      if (next.lastTapDir === dir && now - next.lastTapAt <= DOUBLE_TAP_MS) {
        next.dashUntil = now + DASH_DURATION_MS;
        next.dashDir = dir;
        next.lastTapAt = 0;
      } else {
        next.lastTapDir = dir;
        next.lastTapAt = now;
      }
    }

    // Move trigger (sword / fireball / flip-over).
    if (input.sword || input.fireball || jumpPressed) {
      const moveId = detectMove(next, input, now, opponent);
      if (moveId && canStartMove(next, moveId, now)) {
        const def = MOVE_DEFS[moveId];
        const cooldownReady = def.projectile
          ? now >= next.fireballCooldownUntil
          : now >= next.attackCooldownUntil;
        const energyReady = !def.energyCost || next.energy >= def.energyCost;
        if (cooldownReady && energyReady) {
          // Silent cancel when chain-comboing into the next slash (no cooldown).
          next.activeMove = null;
          if (moveId === 'flip-over') {
            const dir: 1 | -1 = opponent.x >= next.x ? 1 : -1;
            next.moveX0 = next.x;
            next.moveX1 = opponent.x + dir * (halfWidth(opponent) + halfWidth(next) + 30);
          }
          startMove(next, moveId, now);
          next.dashUntil = 0;
          next.isBlocking = false;
        }
      }
    }

    if (next.activeMove) {
      spawnedProjectile = stepActiveMove(
        next,
        opponent,
        MOVE_DEFS[next.activeMove.id],
        now,
        dt,
        playerIndex,
      );
    } else {
      // Free movement: dash burst, walk, jump, super jump.
      if (now < next.dashUntil) {
        next.vx = next.dashDir * DASH_SPEED;
      } else {
        const speed = next.isBlocking ? next.stats.blockMoveSpeed : next.stats.moveSpeed;
        let desiredVx = 0;
        if (input.left) desiredVx -= speed;
        if (input.right) desiredVx += speed;
        next.vx = desiredVx;
      }

      if (onGround && jumpPressed) {
        next.vy = input.block ? SUPER_JUMP_VELOCITY : next.stats.jumpVelocity;
        next.y = 0.1;
      }
      next.vy += next.stats.gravity * dt;

      if (opponent.x > next.x) {
        next.facing = 1;
      } else if (opponent.x < next.x) {
        next.facing = -1;
      }
    }
  } else {
    next.isBlocking = false;
    next.vy += next.stats.gravity * dt;
  }

  next.x += next.vx * dt;
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
  next.prevJump = input.jump;
  next.prevLeft = input.left;
  next.prevRight = input.right;

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
      y: projectile.y + projectile.vy * dt,
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
          projectile.stunMs,
          Math.sign(projectile.vx) as 1 | -1,
          HIT_KNOCKBACK_X,
          HIT_KNOCKBACK_Y,
        );
        hitFighters.add(index);
        hit = true;
        break;
      }
    }

    const outOfBounds =
      moved.x < -80 || moved.x > ARENA_WIDTH + 80 || moved.y < -60 || moved.y > ARENA_HEIGHT + 100;
    if (!hit && !outOfBounds) {
      remaining.push(moved);
    }
  }

  return { projectiles: remaining, hitFighters };
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
