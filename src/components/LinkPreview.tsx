import { ExternalLink, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalFavicon } from '@/components/ExternalFavicon';
import { SafeImage } from '@/components/SafeImage';
import { SafeLink } from '@/components/SafeLink';
import { useLinkPreview } from '@/hooks/useLinkPreview';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface LinkPreviewProps {
  url: string;
  className?: string;
  /** When true, hides the thumbnail image in the preview card. */
  hideImage?: boolean;
  /** When true, clicking the card navigates to the /i/ comment page instead of opening the URL externally. */
  navigateToComments?: boolean;
  /** When true, shows an action button (Discuss or Open) in the domain bar. Defaults to true. */
  showActions?: boolean;
}

/** Extracts the display domain from a URL (e.g. "www.example.com" -> "example.com"). */
function displayDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Rich link preview card rendered from OEmbed data. */
export function LinkPreview({ url, className, hideImage, navigateToComments, showActions = true }: LinkPreviewProps) {
  const { data, isLoading } = useLinkPreview(url);
  const navigate = useNavigate();

  const safeHref = sanitizeUrl(url);

  if (isLoading) {
    return <LinkPreviewSkeleton className={className} />;
  }

  if (!safeHref) {
    return null;
  }

  const domain = data?.provider_name || displayDomain(safeHref);
  const image = data?.thumbnail_url;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!navigateToComments) return; // let the <a> handle it natively
    e.preventDefault();
    navigate(`/i/${encodeURIComponent(url)}`);
  };

  return (
    <a
      href={safeHref}
      target={navigateToComments ? undefined : '_blank'}
      rel={navigateToComments ? undefined : 'noopener noreferrer'}
      className={cn(
        'group block rounded-xl border border-border overflow-hidden',
        'bg-card/60 hover:bg-secondary/40 transition-colors',
        className,
      )}
      onClick={handleClick}
    >
      <div className="flex items-stretch gap-3 p-3">
        {/* Text column — domain, title, description. Stays to two content lines. */}
        <div className="min-w-0 flex-1 space-y-1">
          {/* Domain + favicon + action button */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ExternalFavicon url={url} size={14} className="shrink-0" />
            <span className="truncate font-medium">{domain}</span>

            {showActions && (navigateToComments ? (
              /* Open externally — card navigates to /i/, so offer the external link */
              <SafeLink
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full',
                  'text-xs text-muted-foreground',
                  'hover:bg-primary/10 hover:text-primary transition-colors',
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="size-3" />
                <span>Open</span>
              </SafeLink>
            ) : (
              /* Discuss — card opens externally, so offer navigation to /i/ */
              <button
                type="button"
                className={cn(
                  'ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full',
                  'text-xs text-muted-foreground',
                  'hover:bg-primary/10 hover:text-primary transition-colors',
                )}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/i/${encodeURIComponent(url)}`);
                }}
              >
                <MessageSquare className="size-3" />
                <span>Discuss</span>
              </button>
            ))}
          </div>

          {/* Title — up to 3 lines so longer titles aren't lost. */}
          {data?.title && (
            <p className="text-sm font-semibold leading-snug line-clamp-3">
              {data.title}
            </p>
          )}

          {/* Description (or author) — more embedded text than a bare URL:
              keep it readable up to 4 lines. */}
          {(data?.description ?? data?.author_name) && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
              {data.description ?? data.author_name}
            </p>
          )}
        </div>

        {/* Small thumbnail, right-aligned. Hidden on error; absent when the page has no image. */}
        {image && !hideImage && (
          <div className="shrink-0 self-center">
            <SafeImage
              src={image}
              alt=""
              className="w-24 h-16 sm:w-32 sm:h-20 rounded-lg object-cover border border-border"
              loading="lazy"
              onError={(e) => {
                // Hide broken images
                (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
              }}
            />
          </div>
        )}
      </div>
    </a>
  );
}

function LinkPreviewSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border overflow-hidden', className)}>
      <div className="flex items-stretch gap-3 p-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
        </div>
        <Skeleton className="w-24 h-16 sm:w-32 sm:h-20 shrink-0 rounded-lg" />
      </div>
    </div>
  );
}
