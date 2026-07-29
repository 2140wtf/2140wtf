export const ARENA_WIDTH = 1000;
export const ARENA_HEIGHT = 650;
export const FLOOR_Y = 0;

export const FIGHTER_WIDTH = 110;
export const FIGHTER_HEIGHT = 160;
export const FIGHTER_MAX_HEALTH = 100;
export const FIGHTER_MAX_ENERGY = 100;

// Deliberately slower than a twitch fighter: the manga battle style favors
// readable weighty movement, with dashes and special moves providing bursts.
export const MOVE_SPEED = 165;
export const BLOCK_MOVE_SPEED = 65;
// Coordinate system: y = 0 is the floor, positive y is up.
export const JUMP_VELOCITY = 580;
export const GRAVITY = -1550;
// Super jump: press jump while holding block — a high floaty leap.
export const SUPER_JUMP_VELOCITY = 860;

// Dashes: double-tap a direction for a quick burst (manga speed lines).
export const DASH_SPEED = 560;
export const DASH_DURATION_MS = 190;
export const DOUBLE_TAP_MS = 300;

export const SWORD_DAMAGE = 12;
export const SWORD_RANGE = 110;
export const SWORD_COOLDOWN_MS = 420;
export const SWORD_HIT_STUN_MS = 200;

export const FIREBALL_DAMAGE = 20;
export const FIREBALL_SPEED = 300;
export const FIREBALL_RADIUS = 14;
// Fireballs are the big killer, so they can't be spammed: one per ~4s leaves
// room to jump over a shot and forces the melee/air game between casts.
export const FIREBALL_COOLDOWN_MS = 4000;
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
