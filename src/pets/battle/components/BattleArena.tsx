import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../lib/constants';
import { MOVE_DEFS, type MoveDef } from '../lib/moves';
import {
  loadBattleSpriteManifest,
  resolveBattleSkin,
  type BattleSpriteManifest,
} from '../lib/battleSprites';
import { BattleHud } from './BattleHud';
import { BattlePetSprite } from './BattlePetSprite';
import { BattleTouchControls } from './BattleTouchControls';
import { useIsLandscape, useIsTouchDevice } from '../lib/useMediaQuery';
import type { BattleFighter, BattleHumanPlayers, BattleState, BattleInputState } from '../types/battle.types';

export interface BattleArenaProps {
  state: BattleState;
  inputRef: React.MutableRefObject<BattleInputState>;
  /** Human-controlled fighters on this device; touch buttons render for them only. */
  players?: BattleHumanPlayers;
  className?: string;
}

/** Deterministic pseudo-random in [0, 1) from a seed — stable per frame. */
function prand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function activeMoveDef(fighter: BattleFighter): { def: MoveDef; progress: number; elapsed: number } | null {
  if (!fighter.activeMove) return null;
  const def = MOVE_DEFS[fighter.activeMove.id];
  if (!def) return null;
  const elapsed = performance.now() - fighter.activeMove.startedAt;
  return { def, progress: Math.min(1, elapsed / def.durationMs), elapsed };
}

/** One blade at a given angle — used for the sword itself and its motion trail. */
function strokeBlade(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  angle: number,
  len: number,
  width: number,
  alpha: number,
  glow: boolean,
): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;

  if (glow) {
    ctx.shadowColor = 'rgba(165, 243, 252, 0.9)';
    ctx.shadowBlur = width * 2.2;
  }

  // Blade: steel gradient with a white-hot edge, pointed tip.
  const grad = ctx.createLinearGradient(0, 0, len, 0);
  grad.addColorStop(0, '#94a3b8');
  grad.addColorStop(0.55, '#e2e8f0');
  grad.addColorStop(1, '#ffffff');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, -width / 2);
  ctx.lineTo(len * 0.86, -width / 2);
  ctx.lineTo(len, 0);
  ctx.lineTo(len * 0.86, width / 2);
  ctx.lineTo(0, width / 2);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  // Edge highlight.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = Math.max(1, width * 0.16);
  ctx.beginPath();
  ctx.moveTo(width * 0.4, -width / 2);
  ctx.lineTo(len * 0.86, -width / 2);
  ctx.lineTo(len, 0);
  ctx.stroke();

  // Guard + grip behind the blade root.
  ctx.fillStyle = '#334155';
  ctx.fillRect(-width * 0.28, -width * 0.9, width * 0.34, width * 1.8);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-width * 1.25, -width * 0.28, width, width * 0.56);

  ctx.restore();
}

/** The massive hammer: long handle, huge glowing head — overhead smash only. */
function strokeHammer(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  angle: number,
  len: number,
  alpha: number,
  glow: boolean,
): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;

  if (glow) {
    ctx.shadowColor = 'rgba(251, 191, 36, 0.9)';
    ctx.shadowBlur = len * 0.16;
  }

  // Handle.
  ctx.fillStyle = '#78350f';
  const handleW = Math.max(3, len * 0.05);
  ctx.fillRect(-len * 0.16, -handleW / 2, len * 0.82, handleW);

  // Head: a heavy block at the far end with a bright strike face.
  const headW = len * 0.34;
  const headH = len * 0.3;
  const grad = ctx.createLinearGradient(len * 0.55, 0, len * 0.89, 0);
  grad.addColorStop(0, '#64748b');
  grad.addColorStop(0.7, '#cbd5e1');
  grad.addColorStop(1, '#fbbf24');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(len * 0.55, -headH / 2, headW, headH, headH * 0.18);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();
}

/**
 * The fighter's sword — always held, big and readable; swings wide with a
 * ghosted motion trail during sword moves, orbits the body on spin moves.
 */
function drawSword(
  ctx: CanvasRenderingContext2D,
  fighter: BattleFighter,
  scale: number,
  cssHeight: number,
  now: number,
): void {
  const facing = fighter.facing;
  const cx = fighter.x * scale;
  const cy = cssHeight - (fighter.y + fighter.height * 0.52) * scale;
  const len = fighter.height * 0.74 * scale;
  const bladeW = Math.max(4, 8 * scale);
  const move = activeMoveDef(fighter);

  const drawAt = (originX: number, originY: number, angle: number, alpha: number, glow: boolean) =>
    strokeBlade(ctx, originX, originY, angle, len, bladeW, alpha, glow);

  if (move && !move.def.projectile && (move.def.hits || move.def.spinRotations)) {
    const p = move.progress;
    switch (move.def.id) {
      case 'hammer-smash': {
        // Overhead mallet arc: winds up behind the head, slams down in front.
        const angle = facing * (-2.7 + p * 3.3);
        strokeHammer(ctx, cx, cy, angle - facing * 0.5, len * 1.15, 0.2, false);
        strokeHammer(ctx, cx, cy, angle - facing * 0.25, len * 1.15, 0.38, false);
        strokeHammer(ctx, cx, cy, angle, len * 1.15, 1, true);
        break;
      }
      case 'uppercut': {
        const angle = facing * (0.6 - p * 2.9);
        drawAt(cx, cy, angle - facing * 0.5, 0.22, false);
        drawAt(cx, cy, angle - facing * 0.25, 0.4, false);
        drawAt(cx, cy, angle, 1, true);
        break;
      }
      case 'sweep': {
        const oy = cssHeight - (fighter.y + fighter.height * 0.16) * scale;
        const angle = facing * (-0.5 + p * 1.9);
        drawAt(cx, oy, angle - facing * 0.45, 0.22, false);
        drawAt(cx, oy, angle - facing * 0.2, 0.4, false);
        drawAt(cx, oy, angle, 1, true);
        break;
      }
      case 'spin-slash':
      case 'air-swirl':
      case 'salto': {
        // Blade orbits the body center like a helicopter rotor.
        const base = facing * p * Math.PI * 2 * (move.def.spinRotations ?? 1) * (move.def.id === 'salto' ? -1 : 1);
        drawAt(cx, cy, base - facing * 0.7, 0.18, false);
        drawAt(cx, cy, base - facing * 0.35, 0.32, false);
        drawAt(cx, cy, base, 1, true);
        break;
      }
      case 'dive-kick': {
        drawAt(cx, cy, facing * 0.75, 1, true);
        break;
      }
      default: {
        // Wide horizontal slash with a three-ghost trail.
        const angle = facing * (-2.3 + p * 3.6);
        drawAt(cx, cy, angle - facing * 0.55, 0.16, false);
        drawAt(cx, cy, angle - facing * 0.35, 0.28, false);
        drawAt(cx, cy, angle - facing * 0.18, 0.45, false);
        drawAt(cx, cy, angle, 1, true);
        break;
      }
    }
    return;
  }

  // Idle / running: held at the ready with a slight sway.
  const sway = Math.sin(now / 550 + fighter.x * 0.1) * 0.07;
  const dashLean = now < fighter.dashUntil ? -0.45 : 0;
  drawAt(cx, cy, facing * (-1.05 + dashLean) + sway, 1, false);
}

/** Manga crescent that flashes through the hit window of a sword move. */
function drawSlashArc(
  ctx: CanvasRenderingContext2D,
  fighter: BattleFighter,
  scale: number,
  cssHeight: number,
): void {
  const move = activeMoveDef(fighter);
  if (!move || move.def.projectile || !move.def.hits) return;
  const firstHit = move.def.hits[0];
  const sinceHit = move.elapsed - firstHit;
  if (sinceHit < 0 || sinceHit > 180) return;

  const alpha = 1 - sinceHit / 180;
  const facing = fighter.facing;
  const cx = (fighter.x + facing * (fighter.width * 0.5 + (move.def.range ?? 100) * 0.45)) * scale;
  const cy = cssHeight - (fighter.y + fighter.height * ((move.def.hitLow ?? 0.25) + (move.def.hitHigh ?? 0.85)) * 0.5) * scale;
  const r = (move.def.range ?? 100) * 0.62 * scale;

  const start = facing === 1 ? -1.4 : Math.PI - 1.4 + 0;
  const sweep = 2.4 * facing;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalAlpha = alpha * 0.55;
  ctx.strokeStyle = move.def.id === 'slash-3' ? '#fbbf24' : '#7dd3fc';
  ctx.lineWidth = 16 * scale;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep, facing === -1);
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5 * scale;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep, facing === -1);
  ctx.stroke();
  ctx.restore();
}

/** Radiating speed lines while a fighter dashes or dash-attacks. */
function drawSpeedLines(
  ctx: CanvasRenderingContext2D,
  fighter: BattleFighter,
  scale: number,
  cssHeight: number,
  now: number,
): void {
  const move = activeMoveDef(fighter);
  const burst = now < fighter.dashUntil || move?.def.id === 'dash-slash' || move?.def.id === 'dive-kick';
  if (!burst) return;

  const dir = move?.def.id === 'dash-slash' || move?.def.id === 'dive-kick' ? fighter.facing : fighter.dashDir;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    const scroll = (i * 0.173 + (now % 320) / 320) % 1;
    const yFrac = 0.1 + 0.85 * prand(i * 7.13 + 3.7);
    const y = cssHeight - (fighter.y + fighter.height * yFrac) * scale;
    const startX = (fighter.x - dir * (fighter.width * 0.35 + scroll * 260)) * scale;
    const lineLen = (34 + prand(i * 3.3) * 60) * scale;
    ctx.globalAlpha = (1 - scroll) * 0.65;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = (1 + prand(i * 5.1) * 2) * scale;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX - dir * lineLen, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** White starburst + shockwave ring where a hit just landed. */
function drawImpactFlash(
  ctx: CanvasRenderingContext2D,
  fighter: BattleFighter,
  scale: number,
  cssHeight: number,
  now: number,
): void {
  const elapsed = now - fighter.lastHitAt;
  if (elapsed < 0 || elapsed > 160) return;
  const p = elapsed / 160;
  const cx = fighter.x * scale;
  const cy = cssHeight - (fighter.y + fighter.height * 0.55) * scale;

  ctx.save();
  ctx.globalAlpha = 1 - p;
  // Starburst rays.
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  const rays = 8;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + p * 0.6;
    const inner = (14 + p * 26) * scale;
    const outer = (30 + p * 60) * scale;
    ctx.lineWidth = (4.5 - p * 3) * scale;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.stroke();
  }
  // Core flash.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 26 * scale);
  core.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  core.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, 26 * scale, 0, Math.PI * 2);
  ctx.fill();
  // Shockwave ring.
  ctx.globalAlpha = (1 - p) * 0.7;
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.arc(cx, cy, (18 + p * 90) * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Bold italic SFX text popping over the fighter while a move is fresh. */
function drawMoveSfx(
  ctx: CanvasRenderingContext2D,
  fighter: BattleFighter,
  scale: number,
  cssHeight: number,
): void {
  const move = activeMoveDef(fighter);
  if (!move || move.elapsed > 620) return;
  const p = move.elapsed / 620;
  const pop = p < 0.18 ? p / 0.18 : 1;
  const size = (20 + 12 * pop) * scale;
  const fire = !!move.def.projectile;

  ctx.save();
  ctx.translate(
    fighter.x * scale,
    cssHeight - (fighter.y + fighter.height + 34 + p * 26) * scale,
  );
  ctx.rotate(-0.11 * fighter.facing);
  ctx.globalAlpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
  ctx.font = `italic 900 ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 5 * scale;
  ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)';
  ctx.strokeText(move.def.sfx, 0, 0);
  ctx.fillStyle = fire ? '#fb923c' : '#fde047';
  ctx.fillText(move.def.sfx, 0, 0);
  ctx.restore();
}

/** Guard bubble shown while blocking. */
function drawBlockShield(
  ctx: CanvasRenderingContext2D,
  fighter: BattleFighter,
  scale: number,
  cssHeight: number,
): void {
  const cx = (fighter.x + fighter.facing * fighter.width * 0.42) * scale;
  const cy = cssHeight - (fighter.y + fighter.height * 0.5) * scale;
  const r = fighter.height * 0.52 * scale;
  const base = fighter.facing === 1 ? 0 : Math.PI;

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = '#7dd3fc';
  ctx.lineWidth = 3.5 * scale;
  ctx.shadowColor = 'rgba(125, 211, 252, 0.8)';
  ctx.shadowBlur = 10 * scale;
  ctx.beginPath();
  ctx.arc(cx, cy, r, base - 1.15, base + 1.15);
  ctx.stroke();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#7dd3fc';
  ctx.beginPath();
  ctx.arc(cx, cy, r, base - 1.15, base + 1.15);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Projectiles: glow, white-hot core, flame trail; massive orbs pulse dark red. */
function drawProjectile(
  ctx: CanvasRenderingContext2D,
  projectile: BattleState['projectiles'][number],
  scale: number,
  cssHeight: number,
  now: number,
): void {
  const px = projectile.x * scale;
  const py = cssHeight - projectile.y * scale;
  const radius = projectile.radius * scale;
  const massive = projectile.radius >= 30;

  // Flame trail behind the shot.
  const dir = Math.sign(projectile.vx) || 1;
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    const tx = px - dir * radius * (1.1 + t * 2.1);
    const ty = py - (projectile.vy / Math.max(1, Math.abs(projectile.vx))) * dir * radius * t * 1.4 + (prand(i * 9.7 + projectile.x) - 0.5) * radius * 0.5;
    ctx.globalAlpha = (1 - t) * 0.45;
    ctx.fillStyle = massive ? '#dc2626' : '#f97316';
    ctx.beginPath();
    ctx.arc(tx, ty, radius * (1 - t * 0.55), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const pulse = massive ? 1 + Math.sin(now / 85) * 0.12 : 1;
  const glow = ctx.createRadialGradient(px, py, radius * 0.2, px, py, radius * 2.4 * pulse);
  if (massive) {
    glow.addColorStop(0, 'rgba(254, 202, 202, 1)');
    glow.addColorStop(0.35, 'rgba(220, 38, 38, 0.85)');
    glow.addColorStop(1, 'rgba(127, 29, 29, 0)');
  } else {
    glow.addColorStop(0, 'rgba(251, 146, 60, 1)');
    glow.addColorStop(0.5, 'rgba(234, 88, 12, 0.6)');
    glow.addColorStop(1, 'rgba(234, 88, 12, 0)');
  }
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(px, py, radius * 2.4 * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = massive ? '#fecaca' : '#fff7ed';
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function BattleArena({ state, inputRef, players = { p1: true, p2: true }, className }: BattleArenaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [spriteManifest, setSpriteManifest] = useState<BattleSpriteManifest | null>(null);
  const isTouch = useIsTouchDevice();
  const isLandscape = useIsLandscape();

  // Load the optional Open Design sprite manifest once per mount (404 →
  // procedural rendering for every fighter).
  useEffect(() => {
    let live = true;
    loadBattleSpriteManifest().then((manifest) => {
      if (live) setSpriteManifest(manifest);
    });
    return () => {
      live = false;
    };
  }, []);

  // Measure container and compute arena scale.
  useEffect(() => {
    const measure = () => {
      const width = containerRef.current?.clientWidth ?? window.innerWidth;
      setScale(width / ARENA_WIDTH);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Draw effects on the canvas each frame / state update.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = container.clientWidth;
    const cssHeight = ARENA_HEIGHT * scale;

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.resetTransform();
    ctx.scale(dpr, dpr);

    const now = performance.now();

    // Screen shake while a fresh hit is ringing.
    const freshestHit = Math.min(...state.fighters.map((f) => now - f.lastHitAt), 1000);
    if (freshestHit < 150) {
      const strength = (1 - freshestHit / 150) * 5 * scale;
      ctx.translate(
        (prand(now * 0.77) - 0.5) * 2 * strength,
        (prand(now * 1.31) - 0.5) * 2 * strength,
      );
    }

    // Background — manga night gradient with a halftone-ish floor band.
    const gradient = ctx.createLinearGradient(0, 0, 0, cssHeight);
    gradient.addColorStop(0, 'rgba(15, 23, 42, 0.85)');
    gradient.addColorStop(1, 'rgba(30, 41, 59, 0.95)');
    ctx.fillStyle = gradient;
    ctx.fillRect(-20, -20, cssWidth + 40, cssHeight + 40);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cssHeight);
    ctx.lineTo(cssWidth, cssHeight);
    ctx.stroke();

    for (const fighter of state.fighters) {
      drawSpeedLines(ctx, fighter, scale, cssHeight, now);
    }

    // Ground shadows.
    for (const fighter of state.fighters) {
      const shadowScale = Math.max(0.35, 1 - fighter.y / 480);
      ctx.globalAlpha = 0.3 * shadowScale;
      ctx.fillStyle = '#020617';
      ctx.beginPath();
      ctx.ellipse(
        fighter.x * scale,
        cssHeight - 4 * scale,
        fighter.width * 0.42 * scale * shadowScale,
        7 * scale * shadowScale,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const projectile of state.projectiles) {
      drawProjectile(ctx, projectile, scale, cssHeight, now);
    }

    for (const fighter of state.fighters) {
      if (fighter.isBlocking) drawBlockShield(ctx, fighter, scale, cssHeight);
      // Skins with baked-in weapons opt out of the procedural sword.
      const skin = resolveBattleSkin(spriteManifest, fighter.pet);
      if (!skin || skin.proceduralSword) {
        drawSword(ctx, fighter, scale, cssHeight, now);
      }
      drawSlashArc(ctx, fighter, scale, cssHeight);
    }

    for (const fighter of state.fighters) {
      drawImpactFlash(ctx, fighter, scale, cssHeight, now);
      drawMoveSfx(ctx, fighter, scale, cssHeight);
    }
  }, [state, scale, spriteManifest]);

  const arenaHeight = ARENA_HEIGHT * scale;

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full overflow-hidden rounded-xl border border-border/50 bg-slate-950 shadow-2xl',
        className,
      )}
      style={{ height: arenaHeight }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-0"
        aria-hidden="true"
      />

      {state.fighters.map((fighter, index) => (
        <BattlePetSprite
          key={`fighter-${index}-${fighter.pet.d}`}
          fighter={fighter}
          scale={scale}
          skin={resolveBattleSkin(spriteManifest, fighter.pet)}
        />
      ))}

      <BattleHud state={state} />
      {/* Landscape touch play: thumb clusters on the arena's left/right edges.
          In portrait the controls live below the arena (see PetsBattlePage). */}
      {isTouch && isLandscape && (
        <BattleTouchControls inputRef={inputRef} players={players} layout="overlay" />
      )}
    </div>
  );
}
