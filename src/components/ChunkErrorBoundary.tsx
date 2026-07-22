import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  recovering: boolean;
}

const RECOVERY_KEY = 'chunk-error-recovery';

const CHUNK_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Loading chunk',
  'Loading CSS chunk',
  'Cannot find module',
];

function isChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function hasRecoveryBeenAttempted(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === '1';
  } catch {
    // sessionStorage may be unavailable in private mode / locked WebViews.
    return false;
  }
}

function markRecoveryAttempted(): void {
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

function buildCacheBustedHref(): string {
  const url = new URL(window.location.href);
  url.searchParams.set('_cb', String(Date.now()));
  return url.toString();
}

async function recoverFromChunkError(): Promise<void> {
  await clearAppCaches();
  markRecoveryAttempted();
  // Force the browser to fetch a fresh index.html instead of reloading the
  // possibly cached version that points to stale hashed chunks.
  window.location.href = buildCacheBustedHref();
}

/**
 * Catches Vite dynamic-import chunk failures (e.g. after the dev server
 * restarts and the browser still references an old hashed chunk URL) and
 * tries to recover automatically once per session by clearing caches and
 * reloading. If recovery isn't possible it offers a manual reload.
 */
export class ChunkErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, recovering: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (!isChunkError(error)) return;
    if (hasRecoveryBeenAttempted()) return;

    this.setState({ recovering: true });
    recoverFromChunkError().catch(() => {
      this.setState({ recovering: false });
    });
  }

  render() {
    const { error, recovering } = this.state;
    if (!error) return this.props.children;

    if (!isChunkError(error)) {
      // Re-throw non-chunk errors so they still crash loudly in dev and hit
      // the global error boundary in production.
      throw error;
    }

    if (recovering) {
      return (
        <div className="min-h-[50vh] flex items-center justify-center p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Fetching the latest version…</span>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-[50vh] flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-4 text-center">
          <h2 className="text-lg font-semibold">App updated</h2>
          <p className="text-sm text-muted-foreground">
            The page you were loading changed while this session was open. Reload to get the latest version.
          </p>
          <Button
            onClick={() => {
              recoverFromChunkError().catch(() => {
                window.location.href = buildCacheBustedHref();
              });
            }}
            className="w-full gap-2"
          >
            <RefreshCw className="size-4" />
            Reload page
          </Button>
        </div>
      </div>
    );
  }
}
