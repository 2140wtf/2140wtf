/**
 * Hook for moving the 3D pet around the room with keyboard arrow keys and
 * an on-screen directional pad.
 *
 * Movement is local state only; it is not persisted to relays. The pet faces
 * the last direction it moved.
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// This file intentionally exports a hook that returns a JSX fragment (the
// on-screen movement pad). Fast refresh does not apply here because the file
// exports a non-component hook; disable the component-only rule.
/* eslint-disable react-refresh/only-export-components */

const STEP = 0.15;
const FLOOR_BOUNDS = 4.5;

export interface Pet3DPosition {
  x: number;
  z: number;
}

export interface UsePet3DControlsResult {
  position: Pet3DPosition;
  facingAngle: number;
  moveForward: () => void;
  moveBackward: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  MovementPad: React.ComponentType<{ className?: string }>;
}

const ANGLES = {
  up: 0,
  down: Math.PI,
  left: -Math.PI / 2,
  right: Math.PI / 2,
};

export function usePet3DControls(): UsePet3DControlsResult {
  const [position, setPosition] = useState<Pet3DPosition>({ x: 0, z: 0 });
  const [facingAngle, setFacingAngle] = useState(ANGLES.up);

  const move = useCallback((dx: number, dz: number, angle: number) => {
    setPosition((prev) => ({
      x: Math.max(-FLOOR_BOUNDS, Math.min(FLOOR_BOUNDS, prev.x + dx)),
      z: Math.max(-FLOOR_BOUNDS, Math.min(FLOOR_BOUNDS, prev.z + dz)),
    }));
    setFacingAngle(angle);
  }, []);

  const moveForward = useCallback(() => move(0, -STEP, ANGLES.up), [move]);
  const moveBackward = useCallback(() => move(0, STEP, ANGLES.down), [move]);
  const moveLeft = useCallback(() => move(-STEP, 0, ANGLES.left), [move]);
  const moveRight = useCallback(() => move(STEP, 0, ANGLES.right), [move]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          moveForward();
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          moveBackward();
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          moveLeft();
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          moveRight();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [moveForward, moveBackward, moveLeft, moveRight]);

  const MovementPad = useCallback(
    ({ className }: { className?: string }) => (
      <div
        className={cn(
          'grid grid-cols-3 gap-0.5 p-1 rounded-lg bg-background/80 backdrop-blur-sm border shadow-sm select-none',
          className,
        )}
        onTouchStart={(e) => e.preventDefault()}
      >
        <div />
        <PadButton onClick={moveForward} icon={ChevronUp} label="Forward" />
        <div />
        <PadButton onClick={moveLeft} icon={ChevronLeft} label="Left" />
        <div className="size-5 rounded-full bg-muted/50" />
        <PadButton onClick={moveRight} icon={ChevronRight} label="Right" />
        <div />
        <PadButton onClick={moveBackward} icon={ChevronDown} label="Backward" />
        <div />
      </div>
    ),
    [moveForward, moveBackward, moveLeft, moveRight],
  );

  return {
    position,
    facingAngle,
    moveForward,
    moveBackward,
    moveLeft,
    moveRight,
    MovementPad,
  };
}

function PadButton({
  onClick,
  icon: Icon,
  label,
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="size-6 flex items-center justify-center rounded-md bg-muted hover:bg-muted/80 active:scale-95 transition-transform"
    >
      <Icon className="size-3.5" />
    </button>
  );
}
