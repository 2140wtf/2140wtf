// src/pets/battle/lib/moves.ts
//
// The manga battle move system. Twenty-one moves total, all triggered by
// combinations of the six base inputs (toward/away, jump, block, sword,
// fireball) plus context (ground vs air, dashing, combo chain, proximity):
//
//  Ground sword:  slash, slash-2 (chain), slash-3 (finisher), uppercut (jump+sword),
//                 sweep (block+sword), dash-slash (sword in dash), spin-slash (sword in backdash),
//                 hammer-smash (sword+fireball together — the massive hammer)
//  Air sword:     air-slash, air-swirl (toward+sword), salto (away+sword), dive-kick (block+sword)
//  Acrobatic:     flip-over (jump toward a close opponent — flips over their head)
//  Projectiles:   fireball, massive-fireball (block+fireball), fireball-upper (jump+fireball),
//                 air-fireball (fireball in air), dash-fireball (fireball in dash)
//  Movement:      dash (double-tap toward), backdash (double-tap away),
//                 super-jump (block+jump), block (hold)

import {
  FIREBALL_COOLDOWN_MS,
  FIREBALL_DAMAGE,
  FIREBALL_ENERGY_COST,
  FIREBALL_HIT_STUN_MS,
  FIREBALL_RADIUS,
  FIREBALL_SPEED,
  SWORD_COOLDOWN_MS,
  SWORD_DAMAGE,
  SWORD_HIT_STUN_MS,
  SWORD_RANGE,
} from './constants';
import type { BattleFighter, PlayerInput } from '../types/battle.types';

export type MoveId =
  | 'slash'
  | 'slash-2'
  | 'slash-3'
  | 'uppercut'
  | 'sweep'
  | 'dash-slash'
  | 'spin-slash'
  | 'air-slash'
  | 'air-swirl'
  | 'salto'
  | 'dive-kick'
  | 'flip-over'
  | 'fireball'
  | 'massive-fireball'
  | 'fireball-upper'
  | 'air-fireball'
  | 'dash-fireball'
  | 'hammer-smash';

/** Movement-only techniques (no activeMove state): dash, backdash, super-jump, block. */
export const MOVE_COUNT_TOTAL = 22;

export interface ActiveMove {
  id: MoveId;
  startedAt: number;
}

export interface MoveProjectileSpec {
  /** Ms after move start when the projectile spawns. */
  atMs: number;
  speed: number;
  radius: number;
  damage: number;
  vy?: number;
  stunMs?: number;
}

export interface MoveDef {
  id: MoveId;
  /** Manga SFX text shown while the move is fresh. */
  sfx: string;
  durationMs: number;
  /** Energy deducted at trigger; the move is unavailable below this. */
  energyCost?: number;
  /** Cooldown applied to the matching attack timer when the move ends. */
  cooldownMs: number;
  /** Melee hit times (ms after start). Empty = no melee hitbox. */
  hits?: number[];
  damage?: number;
  range?: number;
  /** Vertical hitbox span as fractions of attacker height [bottom, top]. */
  hitLow?: number;
  hitHigh?: number;
  stunMs?: number;
  knockbackX?: number;
  knockbackY?: number;
  /** Hits on both sides (spin-slash). */
  bothSides?: boolean;
  projectile?: MoveProjectileSpec;
  /** Forward velocity (× facing) held during the move. */
  vx?: number;
  /** Vertical velocity applied once at move start. */
  vy?: number;
  /** Gravity multiplier during the move (0 = fixed trajectory). */
  gravityScale?: number;
  /** Sprite spins for rendering, in full rotations (sign = × facing). */
  spinRotations?: number;
  /** Static sprite tilt in degrees (× facing), e.g. dive-kick. */
  tiltDeg?: number;
}

export const MOVE_DEFS: Record<MoveId, MoveDef> = {
  slash: {
    id: 'slash',
    sfx: 'SLASH!',
    durationMs: 260,
    cooldownMs: SWORD_COOLDOWN_MS,
    hits: [110],
    damage: SWORD_DAMAGE,
    range: SWORD_RANGE,
    stunMs: SWORD_HIT_STUN_MS,
    knockbackX: 110,
    knockbackY: 60,
  },
  'slash-2': {
    id: 'slash-2',
    sfx: 'SLASH-SLASH!',
    durationMs: 240,
    cooldownMs: Math.round(SWORD_COOLDOWN_MS * 0.9),
    hits: [100],
    damage: SWORD_DAMAGE + 2,
    range: SWORD_RANGE,
    stunMs: SWORD_HIT_STUN_MS,
    knockbackX: 120,
    knockbackY: 70,
  },
  'slash-3': {
    id: 'slash-3',
    sfx: 'FINISH!!',
    durationMs: 380,
    cooldownMs: Math.round(SWORD_COOLDOWN_MS * 1.4),
    hits: [170],
    damage: SWORD_DAMAGE + 8,
    range: SWORD_RANGE + 15,
    stunMs: 340,
    knockbackX: 320,
    knockbackY: 160,
  },
  uppercut: {
    id: 'uppercut',
    sfx: 'UPPERCUT!',
    durationMs: 420,
    cooldownMs: Math.round(SWORD_COOLDOWN_MS * 1.3),
    hits: [140],
    damage: SWORD_DAMAGE + 4,
    range: SWORD_RANGE - 20,
    hitLow: 0.1,
    hitHigh: 1.35,
    stunMs: 320,
    knockbackX: 60,
    knockbackY: 460,
    vy: 300,
    tiltDeg: -12,
  },
  sweep: {
    id: 'sweep',
    sfx: 'SWEEP!',
    durationMs: 340,
    cooldownMs: SWORD_COOLDOWN_MS,
    hits: [130],
    damage: 8,
    range: SWORD_RANGE - 10,
    hitLow: -0.15,
    hitHigh: 0.3,
    stunMs: 380,
    knockbackX: 140,
    knockbackY: 120,
  },
  'dash-slash': {
    id: 'dash-slash',
    sfx: 'ZOOM-SLASH!',
    durationMs: 320,
    cooldownMs: Math.round(SWORD_COOLDOWN_MS * 1.2),
    hits: [120],
    damage: SWORD_DAMAGE + 3,
    range: SWORD_RANGE + 15,
    stunMs: 240,
    knockbackX: 240,
    knockbackY: 80,
    vx: 420,
  },
  'spin-slash': {
    id: 'spin-slash',
    sfx: 'SPIN!!',
    durationMs: 420,
    cooldownMs: Math.round(SWORD_COOLDOWN_MS * 1.2),
    hits: [150],
    damage: SWORD_DAMAGE - 1,
    range: SWORD_RANGE - 20,
    stunMs: 220,
    knockbackX: 160,
    knockbackY: 120,
    bothSides: true,
    vx: -240,
    spinRotations: 1,
  },
  'air-slash': {
    id: 'air-slash',
    sfx: 'SLASH!',
    durationMs: 280,
    cooldownMs: SWORD_COOLDOWN_MS,
    hits: [110],
    damage: SWORD_DAMAGE,
    range: SWORD_RANGE,
    stunMs: SWORD_HIT_STUN_MS,
    knockbackX: 130,
    knockbackY: 100,
    gravityScale: 0.6,
  },
  'air-swirl': {
    id: 'air-swirl',
    sfx: 'SWIRL!!',
    durationMs: 720,
    cooldownMs: Math.round(SWORD_COOLDOWN_MS * 1.5),
    hits: [140, 360, 580],
    damage: 6,
    range: SWORD_RANGE - 25,
    stunMs: 140,
    knockbackX: 90,
    knockbackY: 90,
    bothSides: true,
    vx: 120,
    gravityScale: 0.22,
    spinRotations: 2,
  },
  salto: {
    id: 'salto',
    sfx: 'SALTO!',
    durationMs: 500,
    cooldownMs: Math.round(SWORD_COOLDOWN_MS * 1.1),
    hits: [210],
    damage: SWORD_DAMAGE + 1,
    range: SWORD_RANGE - 15,
    stunMs: 220,
    knockbackX: 150,
    knockbackY: 140,
    vx: -300,
    vy: 240,
    gravityScale: 0.85,
    spinRotations: -1,
  },
  'dive-kick': {
    id: 'dive-kick',
    sfx: 'DIVE!!',
    durationMs: 900,
    cooldownMs: Math.round(SWORD_COOLDOWN_MS * 1.2),
    hits: [90],
    damage: SWORD_DAMAGE + 2,
    range: SWORD_RANGE - 30,
    hitLow: -0.4,
    hitHigh: 0.5,
    stunMs: 260,
    knockbackX: 180,
    knockbackY: 60,
    vx: 380,
    vy: -460,
    gravityScale: 0,
    tiltDeg: 42,
  },
  'flip-over': {
    id: 'flip-over',
    sfx: 'FLIP!',
    durationMs: 540,
    cooldownMs: Math.round(SWORD_COOLDOWN_MS * 0.8),
    gravityScale: 0,
    spinRotations: 1,
  },
  fireball: {
    id: 'fireball',
    sfx: 'FIRE!',
    durationMs: 300,
    cooldownMs: FIREBALL_COOLDOWN_MS,
    energyCost: FIREBALL_ENERGY_COST,
    projectile: {
      atMs: 120,
      speed: FIREBALL_SPEED,
      radius: FIREBALL_RADIUS,
      damage: FIREBALL_DAMAGE,
      stunMs: FIREBALL_HIT_STUN_MS,
    },
  },
  'massive-fireball': {
    id: 'massive-fireball',
    sfx: 'MEGA FIRE!!',
    durationMs: 520,
    cooldownMs: Math.round(FIREBALL_COOLDOWN_MS * 1.7),
    energyCost: 40,
    projectile: {
      atMs: 260,
      speed: Math.round(FIREBALL_SPEED * 0.62),
      radius: 36,
      damage: 32,
      stunMs: 340,
    },
  },
  'fireball-upper': {
    id: 'fireball-upper',
    sfx: 'FIRE UP!',
    durationMs: 320,
    cooldownMs: FIREBALL_COOLDOWN_MS,
    energyCost: 20,
    projectile: {
      atMs: 130,
      speed: Math.round(FIREBALL_SPEED * 0.75),
      radius: FIREBALL_RADIUS,
      damage: FIREBALL_DAMAGE - 2,
      vy: 300,
      stunMs: FIREBALL_HIT_STUN_MS,
    },
  },
  'air-fireball': {
    id: 'air-fireball',
    sfx: 'FIRE!',
    durationMs: 300,
    cooldownMs: FIREBALL_COOLDOWN_MS,
    energyCost: 20,
    gravityScale: 0.5,
    projectile: {
      atMs: 120,
      speed: Math.round(FIREBALL_SPEED * 1.05),
      radius: FIREBALL_RADIUS,
      damage: FIREBALL_DAMAGE - 2,
      vy: -190,
      stunMs: FIREBALL_HIT_STUN_MS,
    },
  },
  'dash-fireball': {
    id: 'dash-fireball',
    sfx: 'BOLT!',
    durationMs: 260,
    cooldownMs: Math.round(FIREBALL_COOLDOWN_MS * 0.9),
    energyCost: 15,
    projectile: {
      atMs: 100,
      speed: Math.round(FIREBALL_SPEED * 1.7),
      radius: FIREBALL_RADIUS - 4,
      damage: FIREBALL_DAMAGE - 6,
      stunMs: 160,
    },
  },
  'hammer-smash': {
    id: 'hammer-smash',
    sfx: 'HAMMER!!',
    durationMs: 540,
    cooldownMs: 900,
    energyCost: 10,
    hits: [250],
    damage: SWORD_DAMAGE + 7,
    range: SWORD_RANGE - 20,
    hitLow: -0.1,
    hitHigh: 0.6,
    stunMs: 420,
    knockbackX: 260,
    knockbackY: 220,
    bothSides: true,
    tiltDeg: 8,
  },
};

/** Distance (center to center) within which jump-toward becomes a flip-over. */
export const FLIP_OVER_DISTANCE = 150;
/** Chain window after a slash during which sword continues the combo. */
export const COMBO_WINDOW_MS = 620;
/** Earliest point in a slash where the next chain input is accepted. */
const CHAIN_CANCEL_FRACTION = 0.55;

/**
 * Pick the move a fresh input frame triggers, or null for none.
 *
 * Sword/fireball are one-shot edge triggers (set on keydown, consumed after
 * the frame), jump/block/directions are level-held. Dash detection happens in
 * physics (tap history lives on the fighter); this only maps the current
 * input + context to a MoveId.
 */
export function detectMove(
  fighter: BattleFighter,
  input: PlayerInput,
  now: number,
  opponent: BattleFighter,
): MoveId | null {
  const onGround = fighter.y <= 0;
  const dashing = now < fighter.dashUntil;
  const dashForward = fighter.dashDir === fighter.facing;
  const holdingToward =
    (fighter.facing === 1 && input.right) || (fighter.facing === -1 && input.left);
  const holdingAway =
    (fighter.facing === 1 && input.left) || (fighter.facing === -1 && input.right);

  if (input.sword && input.fireball) {
    // The massive hammer only swings on solid ground.
    if (onGround) return 'hammer-smash';
  }

  if (input.sword) {
    if (onGround) {
      if (dashing) return dashForward ? 'dash-slash' : 'spin-slash';
      if (input.block) return 'sweep';
      if (input.jump) return 'uppercut';
      if (fighter.comboStage === 1 && now < fighter.comboUntil) return 'slash-2';
      if (fighter.comboStage === 2 && now < fighter.comboUntil) return 'slash-3';
      return 'slash';
    }
    if (input.block) return 'dive-kick';
    if (holdingAway) return 'salto';
    if (holdingToward) return 'air-swirl';
    return 'air-slash';
  }

  if (input.fireball) {
    if (!onGround) return 'air-fireball';
    if (input.block) return 'massive-fireball';
    if (dashing) return 'dash-fireball';
    if (input.jump) return 'fireball-upper';
    return 'fireball';
  }

  // Acrobatic: jump toward a close opponent flips over their head.
  if (
    onGround &&
    input.jump &&
    !fighter.prevJump &&
    holdingToward &&
    Math.abs(opponent.x - fighter.x) <= FLIP_OVER_DISTANCE
  ) {
    return 'flip-over';
  }

  return null;
}

/**
 * True when a fresh move may start: no active move, or the active move is a
 * chainable slash past its cancel point and the incoming move continues the
 * chain.
 */
export function canStartMove(fighter: BattleFighter, next: MoveId, now: number): boolean {
  const active = fighter.activeMove;
  if (!active) return true;
  const def = MOVE_DEFS[active.id];
  const elapsed = now - active.startedAt;
  if (elapsed >= def.durationMs) return true;
  const chainNext =
    (active.id === 'slash' && next === 'slash-2') ||
    (active.id === 'slash-2' && next === 'slash-3');
  return chainNext && elapsed >= def.durationMs * CHAIN_CANCEL_FRACTION;
}

/**
 * Bookkeeping when a move starts: deduct energy, update the slash combo
 * chain, and apply the move's initial vertical velocity.
 */
export function startMove(fighter: BattleFighter, id: MoveId, now: number): void {
  const def = MOVE_DEFS[id];
  fighter.activeMove = { id, startedAt: now };
  fighter.moveHitsDone = 0;
  fighter.moveProjectileFired = false;
  if (def.energyCost) {
    fighter.energy = Math.max(0, fighter.energy - def.energyCost);
  }
  if (id === 'slash') fighter.comboStage = 1;
  else if (id === 'slash-2') fighter.comboStage = 2;
  else fighter.comboStage = 0;
  fighter.comboUntil =
    id === 'slash' || id === 'slash-2' ? now + def.durationMs + COMBO_WINDOW_MS : 0;
  if (def.vy !== undefined) {
    fighter.vy = def.vy;
    if (def.vy > 0 && fighter.y <= 0) fighter.y = 0.1;
  }
}

/** Cooldowns and chain cleanup when a move completes. */
export function endMove(fighter: BattleFighter, now: number): void {
  const active = fighter.activeMove;
  if (!active) return;
  const def = MOVE_DEFS[active.id];
  if (def.projectile) {
    fighter.fireballCooldownUntil = now + def.cooldownMs;
  } else {
    fighter.attackCooldownUntil = now + def.cooldownMs;
  }
  fighter.activeMove = null;
}
