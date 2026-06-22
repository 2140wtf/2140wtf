// src/pets/battle/lib/ai.ts
//
// Simple AI opponent for single-player pet battles.
// The AI reads the current battle state and returns a PlayerInput for p2.

import type { BattleState, PlayerInput } from '../types/battle.types';

const DEFAULT_INPUT: PlayerInput = {
  left: false,
  right: false,
  jump: false,
  block: false,
  sword: false,
  fireball: false,
};

/** Distance the AI tries to keep when closing in for a sword strike. */
const IDEAL_MELEE_DISTANCE = 90;

export function computeAiInput(state: BattleState, now: number): PlayerInput {
  const ai = state.fighters[1];
  const player = state.fighters[0];
  if (!ai || !player) return DEFAULT_INPUT;

  const distance = Math.abs(player.x - ai.x);
  const direction = Math.sign(player.x - ai.x); // 1 = player to the right, -1 = left
  const canAct = now >= ai.hitUntil;

  const input: PlayerInput = { ...DEFAULT_INPUT };

  if (!canAct) {
    return input;
  }

  // Movement: close to melee range, then dance around.
  if (distance > IDEAL_MELEE_DISTANCE + 20) {
    if (direction > 0) input.right = true;
    else input.left = true;
  } else if (distance < IDEAL_MELEE_DISTANCE - 30) {
    // Back up slightly to avoid being cornered.
    if (direction > 0) input.left = true;
    else input.right = true;
  } else {
    // In range; randomly pick a side to drift toward so it doesn't stand still.
    const drift = Math.sin(now / 400) > 0;
    if (drift) {
      if (direction > 0) input.right = true;
      else input.left = true;
    }
  }

  // Jump over incoming projectiles or occasionally to dodge.
  const incomingProjectile = state.projectiles.find(
    (p) => p.owner === 0 && Math.abs(p.x - ai.x) < 220 && p.vx * (ai.x - player.x) > 0,
  );
  if (incomingProjectile || Math.sin(now / 800) > 0.92) {
    input.jump = true;
  }

  // Block when player is close and swinging or about to fire.
  const playerSwinging = now < player.attackCooldownUntil && now >= player.attackCooldownUntil - 250;
  if (distance < 160 && (playerSwinging || Math.sin(now / 600) > 0.9)) {
    input.block = true;
  }

  // Sword attack when in range and not blocking.
  if (!input.block && distance <= ai.stats.swordRange + ai.width / 2 + player.width / 2) {
    input.sword = true;
  }

  // Fireball when at safe distance, enough energy, and off cooldown.
  if (
    !input.block &&
    distance > ai.stats.swordRange + 60 &&
    ai.energy >= ai.stats.fireballEnergyCost &&
    now >= ai.fireballCooldownUntil &&
    Math.sin(now / 500) > 0.3
  ) {
    input.fireball = true;
  }

  return input;
}
