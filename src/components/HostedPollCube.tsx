import { Loader2, RefreshCw } from 'lucide-react';

import { useHostedCubeEmbed } from '@/hooks/useHostedCubeEmbed';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface HostedPollCubeProps {
  pollId: string;
  title?: string;
  className?: string;
}

/**
 * Render a hosted BAO cube for a poll by fetching the kind:33889
 * cube-design event and loading its embed URL in an iframe.
 */
export function HostedPollCube({ pollId, title, className }: HostedPollCubeProps) {
  const { data: embedUrl, isLoading, isError, refetch } = useHostedCubeEmbed(pollId);

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-border bg-muted/30',
          className,
        )}
        style={{ minHeight: 320 }}
      >
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !embedUrl) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-muted/30 p-6 text-center',
          className,
        )}
        style={{ minHeight: 320 }}
      >
        <p className="text-sm text-muted-foreground">
          {isError ? 'Could not load hosted cube.' : 'No hosted cube found for this poll.'}
        </p>
        {isError && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()}>
            <RefreshCw className="size-3.5" />
            Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('relative rounded-xl overflow-hidden border border-border bg-background', className)}>
      <iframe
        src={embedUrl}
        title={title || `Hosted cube for ${pollId}`}
        className="w-full h-full"
        style={{ minHeight: 320, border: 0 }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>
  );
}
