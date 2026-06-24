/**
 * PetBirthdayConfetti — One-shot falling confetti burst for 100,000-block
 * pet birthdays.
 *
 * Renders a short CSS-only confetti shower above the pet visual. Particles
 * spawn near the top of the container and fall while drifting left/right.
 * The component cleans itself up after the animation completes.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface PetBirthdayConfettiProps {
  /** Called after the confetti animation finishes. */
  onComplete?: () => void;
  className?: string;
}

/** Confetti particle colours — Bitcoin/gold/pet themed. */
const CONFETTI_COLORS = [
  '#f59e0b', // amber-500
  '#fbbf24', // amber-400
  '#f97316', // orange-500
  '#ef4444', // red-500
  '#22c55e', // green-500
  '#3b82f6', // blue-500
  '#a855f7', // purple-500
  '#ec4899', // pink-500
];

const PARTICLE_COUNT = 48;
// Max particle lifetime: 600ms delay + 3000ms duration = 3600ms; add padding.
const ANIMATION_DURATION_MS = 4000;

interface Particle {
  id: number;
  left: number; // 0..100
  color: string;
  size: number; // px
  delay: number; // ms
  duration: number; // ms
  drift: number; // -1..1
  rotation: number; // deg
}

function generateParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    size: 4 + Math.random() * 6,
    delay: Math.random() * 600,
    duration: 1800 + Math.random() * 1200,
    drift: (Math.random() - 0.5) * 2,
    rotation: Math.random() * 360,
  }));
}

export function PetBirthdayConfetti({ onComplete, className }: PetBirthdayConfettiProps) {
  const [particles] = useState(generateParticles);

  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete?.();
    }, ANIMATION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className={cn(
        'absolute inset-x-0 top-0 h-full pointer-events-none overflow-visible z-30',
        className,
      )}
      aria-hidden
    >
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-sm motion-reduce:opacity-0"
          style={{
            left: `${p.left}%`,
            top: '-6px',
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            transform: `rotate(${p.rotation}deg)`,
            animation: `pets-birthday-confetti ${p.duration}ms ease-out ${p.delay}ms forwards`,
            '--confetti-drift': p.drift,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
