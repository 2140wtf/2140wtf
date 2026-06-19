import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useHostedCubeEmbed } from '@/hooks/useHostedCubeEmbed';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface HostedPollCubeProps {
  pollId: string;
  title?: string;
  className?: string;
}

/**
 * Render a BAO cube embed for a Nostr poll.
 *
 * The cube design is resolved API-first (GET /v1/cube-designs/<pollId>) so the
 * latest branding/wall images are used when available. If the API cannot be
 * reached, we fall back to the deterministic `https://bao.markets/embed/cube/<poll-id>`
 * URL, which renders a default BAO-branded cube for any poll.
 */
export function HostedPollCube({ pollId, title, className }: HostedPollCubeProps) {
  const [loaded, setLoaded] = useState(false);
  const { data: design, isLoading } = useHostedCubeEmbed(pollId);
  const embedUrl = sanitizeUrl(design?.embedUrl) ?? null;

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-border bg-muted/30',
          className,
        )}
        style={{ minHeight: 420 }}
      >
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!embedUrl) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground',
          className,
        )}
        style={{ minHeight: 420 }}
      >
        Could not resolve a cube embed URL for this poll.
      </div>
    );
  }

  return (
    <div
      className={cn('relative rounded-xl overflow-hidden border border-border bg-background', className)}
      style={{ minHeight: 420 }}
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
        style={{ minHeight: 420, border: 0, opacity: loaded ? 1 : 0 }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-popups"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
