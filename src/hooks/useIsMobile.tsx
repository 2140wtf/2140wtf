import { useEffect, useState } from "react"

/** Matches the `md` breakpoint in tailwind.config.ts (768px). Hardcoded to avoid pulling the entire Tailwind config + plugins into the client bundle. */
const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * True on touch-first devices that lack a hover pointer (phones, tablets), as
 * opposed to a merely narrow desktop window. Use this — not {@link useIsMobile}
 * — to gate touch-only interactions like tap-to-reveal, so a small desktop
 * window keeps its hover behaviour instead of switching to taps.
 */
const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";

export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(
    () => window.matchMedia(TOUCH_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(TOUCH_QUERY);
    const onChange = () => setIsTouch(mql.matches);
    mql.addEventListener("change", onChange);
    setIsTouch(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isTouch;
}
