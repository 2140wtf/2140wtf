/**
 * EggTapTarget — Foreground hit target for the room egg.
 *
 * The Pets visual is rendered inside the room canvas, which is intentionally
 * pointer-events-none so the page-flow layer (hero + bottom dock) can receive
 * touches. That layering makes the egg itself unreachable by pointer events on
 * mobile, even though the egg container has pointer-events-auto.
 *
 * This component creates a small, transparent, fixed-position overlay that
 * tracks the egg's bounding rect and forwards taps to the room's egg click
 * handler. It only renders while the current companion is an egg and an
 * onEggClick handler is provided.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface EggTapTargetProps {
  /** Ref to the PetsRoomStage root element. The egg element is queried inside it. */
  stageRef: React.RefObject<HTMLDivElement | null>;
  /** Called when the foreground tap target is activated. */
  onClick?: () => void;
  /** Whether the tap target should be visible/active. */
  enabled: boolean;
  /** Extra padding around the egg visual to expand the tap area (px). */
  padding?: number;
}

export function EggTapTarget({ stageRef, onClick, enabled, padding = 24 }: EggTapTargetProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    if (!enabled || !stageRef?.current) {
      setRect(null);
      return;
    }

    // Target the explicit pets visual wrapper so we don't accidentally match
    // other pointer-events-auto elements like the life badge.
    const egg = stageRef.current.querySelector('[data-pets-visual]') as HTMLElement | null;
    if (!egg) {
      setRect(null);
      return;
    }

    const rect = egg.getBoundingClientRect();
    const pad = padding;
    setRect(
      new DOMRect(
        rect.left - pad,
        rect.top - pad,
        rect.width + pad * 2,
        rect.height + pad * 2,
      ),
    );
  }, [enabled, padding, stageRef]);

  useEffect(() => {
    updateRect();

    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    // Observe size changes on the egg element so we don't need to poll for them.
    let resizeObserver: ResizeObserver | undefined;
    const egg = stageRef?.current?.querySelector('[data-pets-visual]') as HTMLElement | null;
    if (egg) {
      resizeObserver = new ResizeObserver(updateRect);
      resizeObserver.observe(egg);
    }

    // Only run an animation-frame loop while the egg is visible on screen.
    // This avoids burning CPU when the room is off-screen or hidden.
    let rafId = 0;
    let lastFrame = 0;
    const FPS = 10;
    const frameInterval = 1000 / FPS;
    let isVisible = true;

    const loop = (time: number) => {
      rafId = requestAnimationFrame(loop);
      if (!isVisible) return;
      if (time - lastFrame < frameInterval) return;
      lastFrame = time;
      updateRect();
    };

    let intersectionObserver: IntersectionObserver | undefined;
    if (egg && 'IntersectionObserver' in window) {
      intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          isVisible = entry?.isIntersecting ?? true;
          if (isVisible) updateRect();
        },
        { threshold: 0 },
      );
      intersectionObserver.observe(egg);
    }

    rafId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [updateRect, stageRef]);

  if (!enabled || !rect || !onClick) {
    return null;
  }

  return createPortal(
    <button
      type="button"
      aria-label="Hatch egg"
      onClick={onClick}
      className="fixed z-50 rounded-full bg-transparent p-0 m-0 border-0 touch-manipulation outline-none focus:outline-none"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: 'auto',
        cursor: 'pointer',
      }}
    />,
    document.body,
  );
}
