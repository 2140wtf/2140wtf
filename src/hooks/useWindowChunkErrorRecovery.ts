import { useEffect } from 'react';
import {
  isChunkError,
  hasRecoveryBeenAttempted,
  recoverFromChunkError,
} from '@/lib/chunkErrorRecovery';

/**
 * Global safety net for Vite stale-chunk errors.
 *
 * Some dynamic-import failures are reported through window error events or
 * unhandled promise rejections instead of React's error boundary. This hook
 * watches those channels and triggers the same cache-busting recovery so the
 * user doesn't get stuck on a broken build.
 */
export function useWindowChunkErrorRecovery(): void {
  useEffect(() => {
    let recovering = false;

    const handleError = (event: ErrorEvent) => {
      if (recovering || !isChunkError(event.error ?? event.message)) return;
      if (hasRecoveryBeenAttempted()) return;

      recovering = true;
      event.preventDefault();
      recoverFromChunkError().catch(() => {
        recovering = false;
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (recovering || !isChunkError(event.reason)) return;
      if (hasRecoveryBeenAttempted()) return;

      recovering = true;
      event.preventDefault();
      recoverFromChunkError().catch(() => {
        recovering = false;
      });
    };

    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleRejection, true);

    return () => {
      window.removeEventListener('error', handleError, true);
      window.removeEventListener('unhandledrejection', handleRejection, true);
    };
  }, []);
}
