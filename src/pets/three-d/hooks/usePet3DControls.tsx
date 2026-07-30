/**
 * Hook for moving the 3D pet around the room with keyboard arrow keys / WASD
 * and an on-screen 8-way directional pad.
 *
 * Movement is smooth and continuous: holding a key or pad button keeps the pet
 * walking (including diagonals and depth), instead of the old step-per-tap
 * behavior. Movement is local state only; it is not persisted to relays. The
 * pet faces the last direction it moved.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// This file intentionally exports a hook that returns a JSX fragment (the
// on-screen movement pad). Fast refresh does not apply here because the file
// exports a non-component hook; disable the component-only rule.
/* eslint-disable react-refresh/only-export-components */

/** Walk speed in world units per second. */
const SPEED = 2.4;
const FLOOR_BOUNDS = 6;

export interface Pet3DPosition {
  x: number;
  z: number;
}

export interface UsePet3DControlsResult {
  position: Pet3DPosition;
  facingAngle: number;
  MovementPad: React.ComponentType<{ className?: string }>;
}

/** rotationY for a movement vector; 0 faces -z (away from camera). */
function angleFor(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

const DIRS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  upLeft: [-1, -1],
  upRight: [1, -1],
  downLeft: [-1, 1],
  downRight: [1, 1],
} as const;

type DirName = keyof typeof DIRS;

/**
 * Map by `e.code` (physical key), not `e.key`: pressing Shift/CapsLock mid-hold
 * changes `e.key` ('w' → 'W'), which would orphan the pressed direction and
 * leave the pet walking forever.
 */
const KEY_TO_DIR: Record<string, DirName> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

/** True when the event targets editable content — never hijack those keys. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export function usePet3DControls(): UsePet3DControlsResult {
  const [position, setPosition] = useState<Pet3DPosition>({ x: 0, z: 0 });
  const [facingAngle, setFacingAngle] = useState(0);
  /** Active direction vectors, keyed by input source (key or pad button). */
  const activeRef = useRef(new Map<string, readonly [number, number]>());
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(
    (now: number) => {
      const active = activeRef.current;
      if (active.size === 0) {
        rafRef.current = null;
        return;
      }

      const dt = Math.min((now - lastFrameRef.current) / 1000, 0.1);
      lastFrameRef.current = now;

      let dx = 0;
      let dz = 0;
      for (const [vx, vz] of active.values()) {
        dx += vx;
        dz += vz;
      }
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        dx /= len;
        dz /= len;
        const step = SPEED * dt;
        setPosition((prev) => {
          const x = Math.max(-FLOOR_BOUNDS, Math.min(FLOOR_BOUNDS, prev.x + dx * step));
          const z = Math.max(-FLOOR_BOUNDS, Math.min(FLOOR_BOUNDS, prev.z + dz * step));
          // Pinned at the floor bounds — keep the previous object so React
          // bails out instead of re-rendering the Canvas tree at 60fps.
          if (x === prev.x && z === prev.z) return prev;
          return { x, z };
        });
        const angle = angleFor(dx, dz);
        setFacingAngle((prev) => (prev === angle ? prev : angle));
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [],
  );

  const startLoop = useCallback(() => {
    if (rafRef.current === null) {
      lastFrameRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  const pressDir = useCallback(
    (source: string, dir: DirName) => {
      activeRef.current.set(source, DIRS[dir]);
      startLoop();
    },
    [startLoop],
  );

  const releaseDir = useCallback((source: string) => {
    activeRef.current.delete(source);
  }, []);

  // Keyboard: arrows + WASD, diagonals via key combinations. Ignores events
  // aimed at editable content so co-mounted inputs keep working.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const dir = KEY_TO_DIR[e.code];
      if (!dir || isEditableTarget(e.target)) return;
      e.preventDefault();
      pressDir(`key:${e.code}`, dir);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      releaseDir(`key:${e.code}`);
    };
    const onBlur = () => activeRef.current.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [pressDir, releaseDir]);

  // Stop the loop on unmount.
  useEffect(() => stopLoop, [stopLoop]);

  const MovementPad = useCallback(
    ({ className }: { className?: string }) => (
      <div
        className={cn(
          'grid grid-cols-3 gap-1 p-1.5 rounded-lg bg-background/80 backdrop-blur-sm border shadow-sm select-none',
          className,
        )}
      >
        <PadButton dir="upLeft" pressDir={pressDir} releaseDir={releaseDir} icon={ArrowUpLeft} label="Forward left" />
        <PadButton dir="up" pressDir={pressDir} releaseDir={releaseDir} icon={ChevronUp} label="Forward" />
        <PadButton dir="upRight" pressDir={pressDir} releaseDir={releaseDir} icon={ArrowUpRight} label="Forward right" />
        <PadButton dir="left" pressDir={pressDir} releaseDir={releaseDir} icon={ChevronLeft} label="Left" />
        <div className="size-6 m-auto rounded-full bg-muted/50" />
        <PadButton dir="right" pressDir={pressDir} releaseDir={releaseDir} icon={ChevronRight} label="Right" />
        <PadButton dir="downLeft" pressDir={pressDir} releaseDir={releaseDir} icon={ArrowDownLeft} label="Back left" />
        <PadButton dir="down" pressDir={pressDir} releaseDir={releaseDir} icon={ChevronDown} label="Backward" />
        <PadButton dir="downRight" pressDir={pressDir} releaseDir={releaseDir} icon={ArrowDownRight} label="Back right" />
      </div>
    ),
    [pressDir, releaseDir],
  );

  return { position, facingAngle, MovementPad };
}

function PadButton({
  dir,
  pressDir,
  releaseDir,
  icon: Icon,
  label,
}: {
  dir: DirName;
  pressDir: (source: string, dir: DirName) => void;
  releaseDir: (source: string) => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const source = `pad:${dir}`;

  // Keyboard activation (Enter/Space fires click with detail 0): do a short
  // pulse, since pointer hold doesn't apply.
  const pulse = () => {
    pressDir(source, dir);
    setTimeout(() => releaseDir(source), 150);
  };

  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        pressDir(source, dir);
      }}
      onPointerUp={() => releaseDir(source)}
      onPointerLeave={() => releaseDir(source)}
      onPointerCancel={() => releaseDir(source)}
      onClick={(e) => {
        if (e.detail === 0) pulse();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="size-8 flex items-center justify-center rounded-md bg-muted hover:bg-muted/80 active:scale-95 transition-transform touch-none"
    >
      <Icon className="size-4" />
    </button>
  );
}
