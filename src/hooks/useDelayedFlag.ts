import { useEffect, useState } from "react";

/**
 * Returns `true` only once `active` has stayed continuously `true` for at least
 * `delay` ms; returns `false` immediately when `active` goes `false`.
 *
 * Use it to gate loading skeletons so they never flash on fast (cache-hit)
 * loads: pass the raw loading flag as `active` and render the skeleton on the
 * returned value. A load that finishes before `delay` never shows a skeleton at
 * all; a slow load shows it after the delay.
 */
export function useDelayedFlag(active: boolean, delay = 200): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [active, delay]);

  return shown;
}
