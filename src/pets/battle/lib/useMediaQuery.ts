import { useEffect, useState } from 'react';

/** Reactive `window.matchMedia` — true while the query matches. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** True on phones/tablets where touch is the primary input. */
export function useIsTouchDevice(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

/** True while the viewport is wider than tall. */
export function useIsLandscape(): boolean {
  return useMediaQuery('(orientation: landscape)');
}
