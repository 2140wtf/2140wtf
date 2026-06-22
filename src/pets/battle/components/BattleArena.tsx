import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ARENA_HEIGHT, ARENA_WIDTH, SWORD_COOLDOWN_MS } from '../lib/constants';
import { BattleHud } from './BattleHud';
import { BattlePetSprite } from './BattlePetSprite';
import { BattleTouchControls } from './BattleTouchControls';
import type { BattleState, BattleInputState } from '../types/battle.types';

export interface BattleArenaProps {
  state: BattleState;
  inputRef: React.MutableRefObject<BattleInputState>;
  className?: string;
}

export function BattleArena({ state, inputRef, className }: BattleArenaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);

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

    // Background
    const gradient = ctx.createLinearGradient(0, 0, 0, cssHeight);
    gradient.addColorStop(0, 'rgba(15, 23, 42, 0.85)');
    gradient.addColorStop(1, 'rgba(30, 41, 59, 0.95)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Floor grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    const floorY = cssHeight;
    ctx.beginPath();
    ctx.moveTo(0, floorY);
    ctx.lineTo(cssWidth, floorY);
    ctx.stroke();

    // Projectiles
    for (const projectile of state.projectiles) {
      const px = projectile.x * scale;
      const py = cssHeight - projectile.y * scale;
      const radius = projectile.radius * scale;

      const glow = ctx.createRadialGradient(px, py, radius * 0.2, px, py, radius * 2);
      glow.addColorStop(0, 'rgba(251, 146, 60, 1)');
      glow.addColorStop(0.5, 'rgba(234, 88, 12, 0.6)');
      glow.addColorStop(1, 'rgba(234, 88, 12, 0)');

      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, radius * 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fff7ed';
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sword slash effects
    for (const fighter of state.fighters) {
      const swingStart = fighter.attackCooldownUntil - SWORD_COOLDOWN_MS;
      const elapsed = now - swingStart;
      if (elapsed >= 0 && elapsed <= 140) {
        const fx = fighter.x * scale;
        const fy = cssHeight - (fighter.y + fighter.height * 0.6) * scale;
        const reach = 70 * scale * fighter.facing;
        const alpha = 1 - elapsed / 140;

        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = 4 * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.quadraticCurveTo(
          fx + reach,
          fy - 30 * scale,
          fx + reach * 1.2,
          fy + 20 * scale,
        );
        ctx.stroke();
      }
    }
  }, [state, scale]);

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
        />
      ))}

      <BattleHud state={state} />
      <BattleTouchControls inputRef={inputRef} />
    </div>
  );
}
