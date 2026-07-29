// src/pets/battle/lib/moves.test.ts
//
// Move system: detection from input combinations, execution through physics,
// combo chains, dashes, flip-over, and projectile variants.

import { describe, expect, it } from 'vitest';
import { MOVE_DEFS, MOVE_COUNT_TOTAL, detectMove } from './moves';
import { createFighter, createInitialState, stepBattleState } from './physics';
import { createPlaceholderCompanion } from './rival';
import type { BattleState, PlayerInput } from '../types/battle.types';

const IDLE: PlayerInput = {
  left: false,
  right: false,
  jump: false,
  block: false,
  sword: false,
  fireball: false,
};

function makeState(): BattleState {
  const pet1 = createPlaceholderCompanion();
  const pet2 = createPlaceholderCompanion();
  const state = createInitialState(pet1, pet2, 0, 60);
  return { ...state, status: 'fighting' };
}

function step(state: BattleState, p1: PlayerInput, p2: PlayerInput, now: number): BattleState {
  return stepBattleState(state, { p1, p2 }, now);
}

describe('move definitions', () => {
  it('ships 18 active moves + dash/backdash/super-jump/block = 22 features', () => {
    expect(Object.keys(MOVE_DEFS)).toHaveLength(18);
    expect(MOVE_COUNT_TOTAL).toBe(22);
  });
});

describe('detectMove — ground sword combinations', () => {
  const base = createFighter(createPlaceholderCompanion(), 200, 1);
  const foe = createFighter(createPlaceholderCompanion(), 800, -1);

  it('plain sword on the ground is a slash', () => {
    expect(detectMove(base, { ...IDLE, sword: true }, 1000, foe)).toBe('slash');
  });

  it('jump+sword is an uppercut', () => {
    expect(detectMove(base, { ...IDLE, sword: true, jump: true }, 1000, foe)).toBe('uppercut');
  });

  it('block+sword is a sweep', () => {
    expect(detectMove(base, { ...IDLE, sword: true, block: true }, 1000, foe)).toBe('sweep');
  });

  it('sword during a forward dash is a dash-slash, during a backdash a spin-slash', () => {
    const dashing = { ...base, dashUntil: 2000, dashDir: 1 as const };
    expect(detectMove(dashing, { ...IDLE, sword: true, right: true }, 1000, foe)).toBe('dash-slash');
    const backdashing = { ...base, dashUntil: 2000, dashDir: -1 as const };
    expect(detectMove(backdashing, { ...IDLE, sword: true, left: true }, 1000, foe)).toBe('spin-slash');
  });

  it('chains slash → slash-2 → slash-3 inside the combo window', () => {
    const c1 = { ...base, comboStage: 1, comboUntil: 1500 };
    expect(detectMove(c1, { ...IDLE, sword: true }, 1000, foe)).toBe('slash-2');
    const c2 = { ...base, comboStage: 2, comboUntil: 1500 };
    expect(detectMove(c2, { ...IDLE, sword: true }, 1000, foe)).toBe('slash-3');
    const expired = { ...base, comboStage: 1, comboUntil: 900 };
    expect(detectMove(expired, { ...IDLE, sword: true }, 1000, foe)).toBe('slash');
  });
});

describe('detectMove — air sword combinations', () => {
  const air = { ...createFighter(createPlaceholderCompanion(), 200, 1), y: 120 };
  const foe = createFighter(createPlaceholderCompanion(), 800, -1);

  it('plain air sword is an air-slash', () => {
    expect(detectMove(air, { ...IDLE, sword: true }, 1000, foe)).toBe('air-slash');
  });

  it('toward+sword in air is an air swirl', () => {
    expect(detectMove(air, { ...IDLE, sword: true, right: true }, 1000, foe)).toBe('air-swirl');
  });

  it('away+sword in air is a salto', () => {
    expect(detectMove(air, { ...IDLE, sword: true, left: true }, 1000, foe)).toBe('salto');
  });

  it('block+sword in air is a dive-kick', () => {
    expect(detectMove(air, { ...IDLE, sword: true, block: true }, 1000, foe)).toBe('dive-kick');
  });
});

describe('detectMove — projectiles and acrobatics', () => {
  const base = createFighter(createPlaceholderCompanion(), 200, 1);
  const air = { ...base, y: 120 };
  const foe = createFighter(createPlaceholderCompanion(), 800, -1);

  it('block+fireball is a massive fireball', () => {
    expect(detectMove(base, { ...IDLE, fireball: true, block: true }, 1000, foe)).toBe('massive-fireball');
  });

  it('sword+fireball together on the ground is the massive hammer', () => {
    expect(detectMove(base, { ...IDLE, sword: true, fireball: true }, 1000, foe)).toBe('hammer-smash');
    // In the air the combo falls through to the air moves.
    expect(detectMove(air, { ...IDLE, sword: true, fireball: true }, 1000, foe)).toBe('air-slash');
  });

  it('jump+fireball is an anti-air lob', () => {
    expect(detectMove(base, { ...IDLE, fireball: true, jump: true }, 1000, foe)).toBe('fireball-upper');
  });

  it('fireball in air is an air fireball', () => {
    expect(detectMove(air, { ...IDLE, fireball: true }, 1000, foe)).toBe('air-fireball');
  });

  it('fireball during a dash is a dash fireball', () => {
    const dashing = { ...base, dashUntil: 2000, dashDir: 1 as const };
    expect(detectMove(dashing, { ...IDLE, fireball: true, right: true }, 1000, foe)).toBe('dash-fireball');
  });

  it('jump toward a close opponent flips over them', () => {
    const close = { ...createFighter(createPlaceholderCompanion(), 280, -1), x: 320 };
    expect(detectMove(base, { ...IDLE, jump: true, right: true }, 1000, close)).toBe('flip-over');
  });

  it('jump toward a far opponent is not a flip-over', () => {
    expect(detectMove(base, { ...IDLE, jump: true, right: true }, 1000, foe)).toBeNull();
  });
});

describe('move execution through physics', () => {
  it('a slash damages an in-range opponent when the hit window passes', () => {
    let state = makeState();
    state.fighters[1].x = state.fighters[0].x + 120;
    state = step(state, { ...IDLE, sword: true }, IDLE, 100);
    expect(state.fighters[0].activeMove?.id).toBe('slash');
    const hpBefore = state.fighters[1].health;
    state = step(state, IDLE, IDLE, 100 + MOVE_DEFS.slash.hits![0] + 20);
    expect(state.fighters[1].health).toBeLessThan(hpBefore);
  });

  it('a slash whiffs against a far opponent', () => {
    let state = makeState();
    state = step(state, { ...IDLE, sword: true }, IDLE, 100);
    const hpBefore = state.fighters[1].health;
    state = step(state, IDLE, IDLE, 100 + MOVE_DEFS.slash.hits![0] + 20);
    expect(state.fighters[1].health).toBe(hpBefore);
  });

  it('slash chains into slash-2 via the cancel window', () => {
    let state = makeState();
    state = step(state, { ...IDLE, sword: true }, IDLE, 100);
    const cancelAt = 100 + Math.ceil(MOVE_DEFS.slash.durationMs * 0.7);
    state = step(state, { ...IDLE, sword: true }, IDLE, cancelAt);
    expect(state.fighters[0].activeMove?.id).toBe('slash-2');
  });

  it('a fireball move spawns a projectile and deducts energy', () => {
    let state = makeState();
    const energyBefore = state.fighters[0].energy;
    state = step(state, { ...IDLE, fireball: true }, IDLE, 100);
    expect(state.fighters[0].activeMove?.id).toBe('fireball');
    expect(state.fighters[0].energy).toBeLessThan(energyBefore);
    state = step(state, IDLE, IDLE, 100 + MOVE_DEFS.fireball.projectile!.atMs + 20);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0].vy).toBe(0);
  });

  it('a massive fireball is big, slow, and costs more energy', () => {
    let state = makeState();
    const energyBefore = state.fighters[0].energy;
    state = step(state, { ...IDLE, fireball: true, block: true }, IDLE, 100);
    expect(state.fighters[0].activeMove?.id).toBe('massive-fireball');
    state = step(state, IDLE, IDLE, 100 + MOVE_DEFS['massive-fireball'].projectile!.atMs + 20);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0].radius).toBeGreaterThanOrEqual(30);
    // ~40 spent, minus a little regen over the spawn frames.
    expect(energyBefore - state.fighters[0].energy).toBeGreaterThan(35);
  });

  it('an air fireball travels diagonally down', () => {
    let state = makeState();
    state.fighters[0].y = 200;
    state = step(state, { ...IDLE, fireball: true }, IDLE, 100);
    expect(state.fighters[0].activeMove?.id).toBe('air-fireball');
    state = step(state, IDLE, IDLE, 100 + MOVE_DEFS['air-fireball'].projectile!.atMs + 20);
    expect(state.projectiles[0]?.vy).toBeLessThan(0);
  });

  it('double-tapping a direction dashes', () => {
    let state = makeState();
    state = step(state, { ...IDLE, right: true }, IDLE, 100);
    state = step(state, IDLE, IDLE, 130);
    state = step(state, { ...IDLE, right: true }, IDLE, 160);
    expect(state.fighters[0].dashUntil).toBeGreaterThan(160);
    const xBefore = state.fighters[0].x;
    state = step(state, { ...IDLE, right: true }, IDLE, 180);
    expect(state.fighters[0].x - xBefore).toBeGreaterThan(10);
  });

  it('flip-over arcs over a close opponent and lands behind them', () => {
    let state = makeState();
    state.fighters[1].x = state.fighters[0].x + 130;
    const foeX = state.fighters[1].x;
    state = step(state, { ...IDLE, jump: true, right: true }, IDLE, 100);
    expect(state.fighters[0].activeMove?.id).toBe('flip-over');
    // Mid-flight: above the ground.
    state = step(state, IDLE, IDLE, 100 + MOVE_DEFS['flip-over'].durationMs / 2);
    expect(state.fighters[0].y).toBeGreaterThan(50);
    // Finished: on the far side of the opponent, facing them.
    state = step(state, IDLE, IDLE, 100 + MOVE_DEFS['flip-over'].durationMs + 40);
    expect(state.fighters[0].activeMove).toBeNull();
    expect(state.fighters[0].x).toBeGreaterThan(foeX);
    expect(state.fighters[0].y).toBe(0);
    expect(state.fighters[0].facing).toBe(-1);
  });

  it('getting hit cancels the active move', () => {
    let state = makeState();
    state.fighters[1].x = state.fighters[0].x + 120;
    // P1 winds up the slow chain finisher; P2's quick slash lands first.
    state.fighters[0].comboStage = 2;
    state.fighters[0].comboUntil = 1000;
    state = step(state, { ...IDLE, sword: true }, IDLE, 100);
    expect(state.fighters[0].activeMove?.id).toBe('slash-3');
    state = step(state, IDLE, { ...IDLE, sword: true }, 110);
    state = step(state, IDLE, IDLE, 110 + MOVE_DEFS.slash.hits![0] + 20);
    expect(state.fighters[0].hitUntil).toBeGreaterThan(240);
    expect(state.fighters[0].activeMove).toBeNull();
  });

  it('the massive hammer smashes an in-range opponent for heavy damage', () => {
    let state = makeState();
    state.fighters[1].x = state.fighters[0].x + 120;
    const hpBefore = state.fighters[1].health;
    state = step(state, { ...IDLE, sword: true, fireball: true }, IDLE, 100);
    expect(state.fighters[0].activeMove?.id).toBe('hammer-smash');
    state = step(state, IDLE, IDLE, 100 + MOVE_DEFS['hammer-smash'].hits![0] + 20);
    expect(hpBefore - state.fighters[1].health).toBeGreaterThanOrEqual(15);
  });

  it('moves are gated by cooldowns', () => {
    let state = makeState();
    state = step(state, { ...IDLE, sword: true }, IDLE, 100);
    // Let the slash finish.
    state = step(state, IDLE, IDLE, 100 + MOVE_DEFS.slash.durationMs + 10);
    expect(state.fighters[0].activeMove).toBeNull();
    // Immediate next sword press is still on cooldown.
    state = step(state, { ...IDLE, sword: true }, IDLE, 100 + MOVE_DEFS.slash.durationMs + 20);
    expect(state.fighters[0].activeMove).toBeNull();
  });
});
