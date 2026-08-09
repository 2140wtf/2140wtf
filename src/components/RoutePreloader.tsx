import { useEffect } from 'react';
import { IDLE_PRELOAD_ROUTES, preloadRoute } from '@/lib/routePreload';

function internalPath(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin) return null;
  return anchor.pathname;
}

/** Prefetch lazy pages on intent and during idle time, without blocking paint. */
export function RoutePreloader() {
  useEffect(() => {
    const preloadTarget = (event: Event) => {
      const pathname = internalPath(event.target);
      if (pathname) void preloadRoute(pathname)?.catch(() => undefined);
    };

    document.addEventListener('pointerover', preloadTarget, { passive: true, capture: true });
    document.addEventListener('focusin', preloadTarget, { passive: true, capture: true });
    document.addEventListener('touchstart', preloadTarget, { passive: true, capture: true });

    let cancelled = false;
    let index = 0;
    const scheduleNext = () => {
      if (cancelled || index >= IDLE_PRELOAD_ROUTES.length) return;
      const run = () => {
        if (cancelled) return;
        const path = IDLE_PRELOAD_ROUTES[index++];
        void preloadRoute(path)?.catch(() => undefined).finally(scheduleNext);
      };
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(run, { timeout: 2_000 });
      } else {
        globalThis.setTimeout(run, 250);
      }
    };
    scheduleNext();

    return () => {
      cancelled = true;
      document.removeEventListener('pointerover', preloadTarget, true);
      document.removeEventListener('focusin', preloadTarget, true);
      document.removeEventListener('touchstart', preloadTarget, true);
    };
  }, []);

  return null;
}
