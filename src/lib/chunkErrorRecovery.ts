/**
 * Shared detection and recovery logic for Vite stale-chunk errors.
 *
 * Used by both the React error boundary and the global window error watcher so
 * dynamic-import failures are caught regardless of whether they bubble through
 * React.
 */

export const RECOVERY_KEY = 'chunk-error-recovery';

export const CHUNK_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Loading chunk',
  'Loading CSS chunk',
  'Cannot find module',
];

export function isChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

export function hasRecoveryBeenAttempted(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === '1';
  } catch {
    // sessionStorage may be unavailable in private mode / locked WebViews.
    return false;
  }
}

export function markRecoveryAttempted(): void {
  try {
    sessionStorage.setItem(RECOVERY_KEY, '1');
  } catch {
    // Best-effort marker.
  }
}

async function clearAppCaches(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Best-effort cache cleanup.
  }

  try {
    if (navigator.serviceWorker) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // Best-effort service-worker cleanup.
  }
}

export function buildCacheBustedHref(): string {
  const url = new URL(window.location.href);
  url.searchParams.set('_cb', String(Date.now()));
  return url.toString();
}

/**
 * Clear caches/service workers and navigate to a cache-busted URL.
 *
 * The cache-busting parameter forces the browser to fetch a fresh
 * index.html instead of reusing a cached copy that points to stale hashed
 * chunks.
 */
export async function recoverFromChunkError(): Promise<void> {
  await clearAppCaches();
  markRecoveryAttempted();
  window.location.href = buildCacheBustedHref();
}
