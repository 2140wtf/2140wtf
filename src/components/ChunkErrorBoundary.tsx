import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import {
  isChunkError,
  hasRecoveryBeenAttempted,
  recoverFromChunkError,
  buildCacheBustedHref,
} from '@/lib/chunkErrorRecovery';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  recovering: boolean;
}

/**
 * Catches Vite dynamic-import chunk failures (e.g., after the dev/preview
 * server restarts and the browser still references an old hashed chunk URL) and
 * tries to recover automatically once per session by clearing caches and
 * reloading to a cache-busted URL. If recovery isn't possible it offers a
 * manual reload.
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
      // the generic error boundary in production.
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

