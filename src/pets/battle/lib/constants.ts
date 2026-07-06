export const ARENA_WIDTH = 1000;
export const ARENA_HEIGHT = 650;
export const FLOOR_Y = 0;

export const FIGHTER_WIDTH = 110;
export const FIGHTER_HEIGHT = 160;
export const FIGHTER_MAX_HEALTH = 100;
export const FIGHTER_MAX_ENERGY = 100;

export const MOVE_SPEED = 260;
export const BLOCK_MOVE_SPEED = 90;
// Coordinate system: y = 0 is the floor, positive y is up.
export const JUMP_VELOCITY = 620;
export const GRAVITY = -1800;

export const SWORD_DAMAGE = 12;
export const SWORD_RANGE = 100;
export const SWORD_COOLDOWN_MS = 400;
export const SWORD_HIT_STUN_MS = 180;

export const FIREBALL_DAMAGE = 20;
export const FIREBALL_SPEED = 380;
export const FIREBALL_RADIUS = 14;
export const FIREBALL_COOLDOWN_MS = 1200;
export const FIREBALL_ENERGY_COST = 25;
export const FIREBALL_HIT_STUN_MS = 220;
export const ENERGY_REGEN_PER_SECOND = 12;

export const BLOCK_DAMAGE_REDUCTION = 0.75;
export const HIT_KNOCKBACK_X = 90;
export const HIT_KNOCKBACK_Y = 60;

export const DEFAULT_ROUND_DURATION_SECONDS = 60;
// Tuned to the ~50-sat shop economy: a win covers several staples.
export const DEFAULT_PRIZE_SATS = 50;
export const COUNTDOWN_SECONDS = 3;

export const KEYBOARD_CONTROLS = {
  p1: {
    left: ['a', 'A'],
    right: ['d', 'D'],
    jump: ['w', 'W'],
    block: ['s', 'S'],
    sword: ['f', 'F'],
    fireball: ['g', 'G'],
  },
  p2: {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    jump: ['ArrowUp'],
    block: ['ArrowDown'],
    sword: ['l', 'L'],
    fireball: [';', ':'],
  },
} as const;
