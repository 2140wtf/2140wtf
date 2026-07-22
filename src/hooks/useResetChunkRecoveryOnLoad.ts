import { useEffect } from 'react';
import { RECOVERY_KEY } from '@/lib/chunkErrorRecovery';

/**
 * Reset the chunk-error recovery guard after the app has successfully loaded.
 *
 * The guard is set before the cache-busting reload so we don't loop forever
 * when a chunk is genuinely missing. Once the app boots and runs for a few
 * seconds, we clear it so future stale-chunk errors in the same session can
 * auto-recover instead of requiring the manual "Reload page" button.
 */
export function useResetChunkRecoveryOnLoad(): void {
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        sessionStorage.removeItem(RECOVERY_KEY);
      } catch {
        // sessionStorage may be unavailable in private mode / locked WebViews.
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, []);
}
