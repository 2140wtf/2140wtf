import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAndroidBack } from "@/hooks/useAndroidBack";
import { useEdgeSwipe } from "@/hooks/useEdgeSwipe";
import { useIsTouch } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";

interface SwipeRevealProps {
  /**
   * The persistent parent view (server rail + channel/DM list) revealed
   * underneath the chat when swiping. On desktop these are the static left
   * panes.
   */
  underlay: React.ReactNode;
  /** The chat pane (a full-height column). It slides right to reveal `underlay`. */
  children: React.ReactNode;
  /**
   * Whether the list is revealed (chat slid fully away). Controlled by the
   * parent so the reveal persists until a channel is tapped or the chat is
   * swiped/tapped back.
   */
  open: boolean;
  /** Reveal the list (chat slides fully out). */
  onReveal: () => void;
  /** Slide the chat back over the list. */
  onClose: () => void;
}

/**
 * Discord-style swipe-to-reveal layout for the mobile chat screens. The chat
 * pane is a full-screen overlay:
 *
 * - Drag rightward from anywhere on the chat pane → the chat slides right;
 *   release past the threshold and it slides fully out, revealing the list
 *   (`onReveal`). On Android the system back gesture is the reliable way to
 *   start a reveal, since the OS reserves the screen edges for its own nav.
 * - When revealed, drag the list left (or tap the chat-return affordance) →
 *   the chat slides back (`onClose`).
 *
 * A cancelled drag springs back. On desktop / non-touch it degrades to a plain
 * side-by-side flex row.
 */
export function SwipeReveal({ underlay, children, open, onReveal, onClose }: SwipeRevealProps) {
  const isTouch = useIsTouch();
  // Mobile layout (single-pane drill-down) kicks in below the 900px `sidebar:`
  // breakpoint. Gate the gesture on a narrow viewport AND a touch device so a
  // small desktop window keeps the side-by-side panes.
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 899px)").matches,
  );
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 899px)");
    const onChange = () => setNarrow(mql.matches);
    mql.addEventListener("change", onChange);
    setNarrow(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const swipeEnabled = isTouch && narrow;

  // Android system back gesture / button. On the mobile drill-down, when the
  // chat is showing (list hidden), "back" reveals the channel list — one level
  // up, the Discord behavior. This is also the only reliable left-edge gesture
  // on Android, where the OS reserves the screen edges for its own gesture nav
  // and eats an in-WebView edge swipe before our pointer handlers see it. When
  // the list is already revealed, we defer (return false) so back leaves the
  // server/community via normal history navigation.
  useAndroidBack(() => {
    if (!open) {
      onReveal();
      return true;
    }
    return false;
  }, swipeEnabled);

  // Slide the chat in from the right on first mount (e.g. tapping a channel on
  // ServerPage navigates here as a *fresh* component, so without this the chat
  // would just appear flush with no animation). A one-shot CSS keyframe
  // (`animate-in`) runs on the compositor independently of React/main-thread
  // work, so the heavy chat tree mounting on the same frame doesn't stutter it
  // (the old rAF approach forced an extra render + reflow and lurched). Captured
  // once on mount; never re-armed. Only when entering closed on a touch layout.
  const [enterAnim] = useState(() => swipeEnabled && !open);

  // A gesture-driven reveal/close should animate to its resting position (the
  // Discord settle). An `open` change from *navigation* (switching
  // server/community reuses this page instance and flips `open` via a route
  // effect) must NOT animate — otherwise the chat pane visibly slides across the
  // screen ("dives into a channel") before landing on the channel list, which
  // reads as a glitch. We flag the next `open` change as gesture-driven when a
  // swipe commits, and snap (no transition) for every other `open` change.
  const gestureCommit = useRef(false);
  // Opening: rightward drag from the left edge of the chat (only when closed).
  const openSwipe = useEdgeSwipe({
    enabled: swipeEnabled && !open,
    direction: "open",
    onCommit: () => {
      gestureCommit.current = true;
      onReveal();
    },
  });
  // Closing: leftward drag on the revealed list (only when open).
  const closeSwipe = useEdgeSwipe({
    enabled: swipeEnabled && open,
    direction: "close",
    onCommit: () => {
      gestureCommit.current = true;
      onClose();
    },
  });

  // Suppress the transform transition for one render whenever `open` flips
  // without a preceding gesture commit (i.e. navigation). `useLayoutEffect` runs
  // before paint so the snap applies on the same frame the new `open` lands.
  const prevOpen = useRef(open);
  const [snap, setSnap] = useState(false);
  useLayoutEffect(() => {
    if (prevOpen.current !== open) {
      setSnap(!gestureCommit.current);
      prevOpen.current = open;
    }
    gestureCommit.current = false;
  }, [open]);
  // Re-enable transitions on the next frame after a snap so subsequent gestures
  // still animate their settle.
  useEffect(() => {
    if (!snap) return;
    const id = requestAnimationFrame(() => setSnap(false));
    return () => cancelAnimationFrame(id);
  }, [snap]);

  if (!swipeEnabled) {
    // Desktop: static side-by-side panes.
    return (
      <>
        {underlay}
        {children}
      </>
    );
  }

  const width = typeof window !== "undefined" ? window.innerWidth : 1;
  // Chat resting offset: fully out (= width) when revealed, else flush (0).
  // Live drags add/subtract from that rest position.
  let offset: number;
  if (openSwipe.dragging) {
    offset = openSwipe.dragX; // 0 → width as it slides out
  } else if (closeSwipe.dragging) {
    offset = width - closeSwipe.dragX; // width → 0 as it slides back
  } else {
    offset = open ? width : 0;
  }
  offset = Math.max(0, Math.min(offset, width));
  const dragging = openSwipe.dragging || closeSwipe.dragging;

  const progress = width > 0 ? offset / width : 0;
  // Parallax the underlay in from the left (Discord slides the list slightly
  // rather than holding it static).
  const underlayShift = -(1 - progress) * 18; // % of its own width

  return (
    <>
      {/* Underlay: the list, revealed as the chat slides away. While open it
          carries the leftward "close" swipe so you can drag the chat back.
          `contain` isolates its layout/paint so mounting the (heavy) chat tree
          over it doesn't force the underlay to re-layout/repaint. */}
      <div
        {...(open ? closeSwipe.handlers : {})}
        className={cn(
          "absolute inset-0 flex [contain:layout_paint]",
          dragging || snap ? "" : "transition-transform duration-200 ease-out",
        )}
        style={{
          transform: `translateX(${underlayShift}%)`,
          touchAction: open ? "pan-y" : undefined,
        }}
        aria-hidden={progress === 0}
      >
        {underlay}
      </div>

      {/* Chat pane overlay. Slides right by the live drag (or rest) offset;
          springs to its rest position with a transition when not dragging. A
          fresh mount slides in from the right via a one-shot CSS keyframe.
          `will-change`/`translateZ` promote it to its own compositor layer up
          front so the slide runs on the compositor thread instead of stuttering
          while the heavy chat tree mounts on the main thread; `contain` keeps
          that mount from invalidating the rest of the page. */}
      <div
        {...openSwipe.handlers}
        className={cn(
          "absolute inset-0 z-10 flex flex-col bg-background shadow-2xl [contain:layout_paint]",
          dragging || snap ? "" : "transition-transform duration-200 ease-out",
          enterAnim && "animate-in slide-in-from-right duration-200 ease-out",
          // Reserve the fixed mobile call bar's measured height (set on the
          // shell as --call-bar-h while a call is active) so it never covers the
          // composer. The shell's own padding can't do this — this overlay is
          // `absolute inset-0`, so it ignores the shell's padding box. Unset
          // (no active call) falls back to 0.
          "max-sidebar:pb-[var(--call-bar-h,0px)]",
          // When fully revealed the chat is off-screen — don't let it block the
          // list's taps/gestures underneath.
          open && !dragging && "pointer-events-none",
        )}
        style={{
          transform: `translate3d(${offset}px, 0, 0)`,
          touchAction: "pan-y",
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </>
  );
}
