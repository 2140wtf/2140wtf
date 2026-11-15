import { useEffect, useState } from 'react';

import { useTheme } from '@/hooks/useTheme';
import { getBackgroundThemeMode } from '@/lib/colorUtils';

/**
 * Resolved `dark`/`light` basemap mode for the Leaflet maps.
 *
 * `getBackgroundThemeMode()` reads the live `--background` CSS variable, so it
 * is correct at the moment it is called — but a page that memoises it once
 * (`useMemo(() => getBackgroundThemeMode(), [])`, as BTC Map and Roadstr used
 * to) keeps rendering the old basemap after the user switches theme. That is
 * why switching to dark mode left the map with light tiles.
 *
 * Recomputing whenever the theme setting (or the custom theme, which carries
 * its own background) changes keeps the map in step with the app, and a
 * `matchMedia` listener covers the `system` setting, where the OS can flip
 * without React re-rendering.
 */
export function useBasemapTheme(): 'dark' | 'light' {
  const { theme, customTheme } = useTheme();
  const [mode, setMode] = useState<'dark' | 'light'>(() => getBackgroundThemeMode());

  useEffect(() => {
    setMode(getBackgroundThemeMode());
  }, [theme, customTheme]);

  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setMode(getBackgroundThemeMode());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  return mode;
}
