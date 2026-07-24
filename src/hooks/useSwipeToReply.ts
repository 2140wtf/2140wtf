import { useCallback, useRef, useState } from "react";

/**
 * Swipe-to-reply gesture hook for touch devices.
 *
 * Tracks a predominantly-horizontal LEFTWARD touch drag on a message row and
 * calls `onSwipe` when the horizontal travel exceeds `THRESHOLD` pixels at
 * release. The caller gets back the current pixel offset (a positive magnitude;
 * apply it as a negative `translateX`) and touch handlers to spread onto the
 * row element.
 *
 * Design notes:
 * - Reply is a LEFT swipe (Telegram-style) specifically so it can never collide
 *   with the SwipeReveal edge-swipe: a RIGHTWARD drag anywhere on the chat pane
 *   slides the pane away to reveal the channel list (see `useEdgeSwipe`). The
 *   two gestures share the same surface (message rows fill the pane), so intent
 *   is disambiguated purely by direction: left on a message = reply, right
 *   anywhere = leave the room.
 * - Only gestures whose horizontal travel exceeds 2× their vertical travel are
 *   considered "swipes". Purely-vertical touches (scrolling) are ignored so the
 *   page scrolls normally, and a rightward horizontal drag bails out so it
 *   belongs exclusively to the pane-reveal gesture.
 * - `touch-action: pan-y` on the row (set by the caller via inline style or a
 *   class) tells the browser the same thing at the compositor level.
 * - The drag is clamped to `MAX_DRAG` so the row can't be dragged off-screen.
 * - On release the offset springs back to 0 via a CSS transition (the caller
 *   toggles the transition on/off based on whether a drag is active).
 * - Haptic feedback: a 10 ms vibration pulse fires the moment the threshold is
 *   crossed during the drag (not at release), giving the user a physical "click"
 *   that says "you've swiped far enough — let go to reply".
 */

/** Horizontal distance (px) the user must drag to trigger the reply. */
const THRESHOLD = 60;
/** Maximum horizontal drag (px) for visual feedback. */
const MAX_DRAG = 100;
/** Horizontal travel must exceed 2× vertical travel to be a "swipe". */
const HORIZONTAL_RATIO = 2;

export interface UseSwipeToReplyResult {
  /**
   * Current drag magnitude in pixels (0 at rest, grows as the user swipes
   * LEFT). Apply as `translateX(-offset)` for the visual slide.
   */
  offset: number;
  /** Whether a drag is currently in progress (disables the spring-back transition). */
  dragging: boolean;
  /** Whether the current drag has crossed the threshold (for icon opacity). */
  pastThreshold: boolean;
  /** Spread onto the row element. */
  touchHandlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
}

/**
 * @param onSwipe Called when the user releases past the threshold.
 * @param enabled Set to `false` on non-touch devices to skip all touch handling.
 */
export function useSwipeToReply(
  onSwipe: () => void,
  enabled: boolean,
): UseSwipeToReplyResult {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Refs avoid re-renders during the drag (touchmove fires very frequently).
  const startX = useRef(0);
  const startY = useRef(0);
  const active = useRef(false);
  const horizontal = useRef(false);
  const vibrated = useRef(false);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0];
      if (!touch) return;
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      active.current = true;
      horizontal.current = false;
      vibrated.current = false;
      // Don't set dragging yet — wait until we know it's horizontal.
    },
    [enabled],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || !active.current) return;
      const touch = e.touches[0];
      if (!touch) return;

      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;

      // Determine direction on first significant movement.
      if (!horizontal.current) {
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx < 5 && absDy < 5) return; // wait for real movement
        if (absDx > absDy * HORIZONTAL_RATIO && dx < 0) {
          horizontal.current = true;
          setDragging(true);
        } else {
          // Vertical gesture (scroll) or a rightward drag (the pane-reveal
          // "leave room" gesture, see useEdgeSwipe) — bail out entirely.
          active.current = false;
          return;
        }
      }

      // Clamp the leftward drag for visual feedback (positive magnitude).
      const clamped = Math.max(0, Math.min(-dx, MAX_DRAG));
      setOffset(clamped);

      // Haptic feedback the moment the user crosses the threshold.
      if (clamped >= THRESHOLD && !vibrated.current) {
        vibrated.current = true;
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(10);
        }
      }
    },
    [enabled],
  );

  const onTouchEnd = useCallback(
    () => {
      if (!enabled || !active.current) {
        // Reset any partial state.
        active.current = false;
        horizontal.current = false;
        setDragging(false);
        setOffset(0);
        return;
      }

      const triggered = offset >= THRESHOLD;
      active.current = false;
      horizontal.current = false;
      setDragging(false);
      setOffset(0); // spring back

      if (triggered) {
        onSwipe();
      }
    },
    [enabled, offset, onSwipe],
  );

  return {
    offset,
    dragging,
    pastThreshold: offset >= THRESHOLD,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
