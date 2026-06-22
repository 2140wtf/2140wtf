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
}

export function EggTapTarget({ stageRef, onClick, enabled }: EggTapTargetProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    if (!enabled || !stageRef?.current) {
      setRect(null);
      return;
    }

    // The egg visual is the only pointer-events-auto element inside the stage.
    const egg = stageRef.current.querySelector('.pointer-events-auto') as HTMLElement | null;
    if (!egg) {
      setRect(null);
      return;
    }

    setRect(egg.getBoundingClientRect());
  }, [enabled, stageRef]);

  useEffect(() => {
    updateRect();

    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    // Re-measure periodically during animations (bob/sway) so the overlay stays
    // aligned with the moving egg without running a full animation frame loop.
    const interval = setInterval(updateRect, 250);

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      clearInterval(interval);
    };
  }, [updateRect]);

  if (!enabled || !rect || !onClick) {
    return null;
  }

  return createPortal(
    <button
      type="button"
      aria-label="Hatch egg"
      onClick={onClick}
      className="fixed z-50 rounded-full bg-transparent p-0 m-0 border-0 touch-manipulation"
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
