import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface HostedPollCubeProps {
  pollId: string;
  title?: string;
  className?: string;
}

/**
 * Render a BAO cube embed for any Nostr poll.
 *
 * bao.markets can build a hosted, interactive 3D cube from the poll id alone
 * via `https://bao.markets/embed/cube/<poll-id>`. A custom kind:33889 design
 * event will be used when one exists; otherwise a default cube is generated.
 */
export function HostedPollCube({ pollId, title, className }: HostedPollCubeProps) {
  const [loaded, setLoaded] = useState(false);
  const embedUrl = useMemo(
    () => sanitizeUrl(`https://bao.markets/embed/cube/${encodeURIComponent(pollId)}`),
    [pollId],
  );

  if (!embedUrl) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground',
          className,
        )}
        style={{ minHeight: 320 }}
      >
        Invalid poll id.
      </div>
    );
  }

  return (
    <div
      className={cn('relative rounded-xl overflow-hidden border border-border bg-background', className)}
      style={{ minHeight: 320 }}
    >
      {!loaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/30">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <iframe
        src={embedUrl}
        title={title || `Cube for poll ${pollId}`}
        className="w-full h-full transition-opacity duration-300"
        style={{ minHeight: 320, border: 0, opacity: loaded ? 1 : 0 }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-popups"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
