import { useEffect, useRef } from 'react';

import { type ChaseGameState, CHASE_RAILS } from './types';

interface ChaseCanvasProps {
  state: ChaseGameState;
  width: number;
  height: number;
  groundY: number;
}

export function ChaseCanvas({ state, width, height, groundY }: ChaseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#F8FAFC');
    gradient.addColorStop(1, '#E2E8F0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Distant city blocks
    ctx.fillStyle = '#CBD5E1';
    const blockOffset = Math.floor(state.distance * 0.2) % 200;
    for (let x = -blockOffset; x < width; x += 200) {
      const h = 30 + ((x + 1000) % 70);
      ctx.fillRect(x, groundY - h, 120, h);
    }

    // Ground
    ctx.fillStyle = '#94A3B8';
    ctx.fillRect(0, groundY, width, height - groundY);
    ctx.fillStyle = '#64748B';
    ctx.fillRect(0, groundY, width, 6);

    // Ground stripes
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    const stripeOffset = Math.floor(state.distance) % 100;
    for (let x = -stripeOffset; x < width; x += 100) {
      ctx.fillRect(x, groundY + 10, 50, 4);
    }

    // Gaps
    for (const obstacle of state.obstacles) {
      if (obstacle.type === 'gap') {
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(obstacle.x, groundY, obstacle.width, height - groundY);
      }
    }

    // Obstacles
    for (const obstacle of state.obstacles) {
      if (obstacle.type === 'gap') continue;
      if (obstacle.type === 'low') {
        ctx.fillStyle = '#475569';
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        ctx.fillStyle = '#94A3B8';
        ctx.fillRect(obstacle.x + 4, obstacle.y + 4, obstacle.width - 8, obstacle.height - 8);
      } else {
        ctx.fillStyle = '#334155';
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(obstacle.x + obstacle.width / 2, obstacle.y + 8, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Coins
    for (const coin of state.coins) {
      if (coin.collected) continue;
      const rail = CHASE_RAILS.find((r) => r.id === coin.rail);
      if (!rail) continue;

      ctx.save();
      ctx.translate(coin.x, coin.y);
      ctx.fillStyle = rail.color;
      ctx.beginPath();
      ctx.arc(0, 0, coin.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rail.icon, 0, 0);
      ctx.restore();
    }
  }, [state, width, height, groundY]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 w-full h-full touch-none"
      aria-label="Chase BTC game world"
    />
  );
}
