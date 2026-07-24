import { useEffect, useState } from "react";

/**
 * Drives a mount/slide transition for a panel that should stay in the DOM
 * through its exit animation, then unmount.
 *
 * Returns `{ mounted, visible }`:
 *   - `mounted` — whether the panel should be in the DOM. Stays true for
 *     `exitMs` after `open` flips to false so the slide-out can play, then
 *     flips to false.
 *   - `visible` — the animation target. Flipped to true a frame after mount (so
 *     the enter transition runs from the collapsed state), and back to false
 *     immediately on close.
 *
 * Render the panel while `mounted`, and key its open/closed classes off
 * `visible` (e.g. `grid-rows-[1fr] opacity-100` vs `grid-rows-[0fr] opacity-0`).
 */
export function useMountedTransition(open: boolean, exitMs = 200) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  // Mount on open; keep mounted through the exit animation on close.
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setVisible(false);
    if (!mounted) return;
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [open, mounted, exitMs]);

  // Once mounted (and still open), flip the animation target on the next paint
  // so the enter transition runs from the collapsed state to open.
  useEffect(() => {
    if (!mounted || !open) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [mounted, open]);

  return { mounted, visible };
}
