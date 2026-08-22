import { useEffect, useRef, useState } from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalFavicon } from '@/components/ExternalFavicon';
import { SafeImage } from '@/components/SafeImage';
import { SafeLink } from '@/components/SafeLink';
import { useLinkPreview } from '@/hooks/useLinkPreview';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

/** Shared pill styling for the Open/Discuss action buttons in the domain row. */
const ACTION_PILL_CLASS = cn(
  'ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full',
  'text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors',
);

/** Thumbnail box sizing shared by the card and its loading skeleton (only rounding differs). */
function thumbnailSizeClass(compact?: boolean): string {
  return compact ? 'w-16 h-12 sm:w-20 sm:h-14' : 'w-24 h-16 sm:w-32 sm:h-20';
}

interface LinkPreviewProps {
  url: string;
  className?: string;
  /** When true, hides the thumbnail image in the preview card. */
  hideImage?: boolean;
  /** When true, clicking the card navigates to the /i/ comment page instead of opening the URL externally. */
  navigateToComments?: boolean;
  /** When true, shows an action button (Discuss or Open) in the domain bar. Defaults to true. */
  showActions?: boolean;
  /** When true, renders a compact card for inline display. */
  compact?: boolean;
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
export function LinkPreview({ url, className, hideImage, navigateToComments, showActions = true, compact }: LinkPreviewProps) {
  const navigate = useNavigate();
  const safeHref = sanitizeUrl(url);

  // Defer the OEmbed fetch until the card approaches the viewport: a feed with
  // many links must not fire dozens of third-party preview requests up front.
  const rootRef = useRef<HTMLAnchorElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView]);

  // A null url keeps the query disabled until the card scrolls near the viewport.
  const { data, isLoading } = useLinkPreview(inView ? url : null);

  if (!safeHref) {
    return null;
  }

  // First load while visible: reserve approximate card height with a skeleton.
  // (Off-screen cards skip this — they stay lightweight until scrolled near.)
  if (isLoading && !data) {
    return <LinkPreviewSkeleton className={className} compact={compact} />;
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
      ref={rootRef}
      href={safeHref}
      target={navigateToComments ? undefined : '_blank'}
      rel={navigateToComments ? undefined : 'noopener noreferrer'}
      className={cn(
        'group block rounded-xl border border-border overflow-hidden',
        'bg-card/60 hover:bg-secondary/40 transition-colors',
        compact && 'rounded-lg',
        className,
      )}
      onClick={handleClick}
    >
      <div className={cn(
        'flex items-stretch gap-3',
        compact ? 'p-2 gap-2' : 'p-3',
      )}>
        {/* Text column — domain, title, description. Stays to two content lines. */}
        <div className={cn('min-w-0 flex-1 space-y-1', compact && 'space-y-0.5')}>
          {/* Domain + favicon + action button */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ExternalFavicon url={url} size={compact ? 12 : 14} className="shrink-0" />
            <span className="truncate font-medium">{domain}</span>

            {showActions && (navigateToComments ? (
              /* Open externally — card navigates to /i/, so offer the external link */
              <SafeLink
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className={ACTION_PILL_CLASS}
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="size-3" />
                <span>Open</span>
              </SafeLink>
            ) : (
              /* Discuss — card opens externally, so offer navigation to /i/ */
              <button
                type="button"
                className={ACTION_PILL_CLASS}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/i/${encodeURIComponent(url)}`);
                }}
              >
                <MessageSquare className={cn('size-3', compact && 'size-2.5')} />
                <span>Discuss</span>
              </button>
            ))}
          </div>

          {/* Title — up to 3 lines so longer titles aren't lost.
              Compact: 2 lines, smaller font. */}
          {data?.title && (
            <p className={cn(
              'font-semibold leading-snug line-clamp-3',
              compact ? 'text-xs line-clamp-2' : 'text-sm',
            )}>
              {data.title}
            </p>
          )}

          {/* Description (or author) — more embedded text than a bare URL:
              keep it readable up to 4 lines.
              Compact: 2 lines. */}
          {(data?.description ?? data?.author_name) && (
            <p className={cn(
              'text-xs text-muted-foreground leading-relaxed line-clamp-4',
              compact && 'line-clamp-2',
            )}>
              {data.description ?? data.author_name}
            </p>
          )}
        </div>

        {/* Small thumbnail, right-aligned. Hidden on error; absent when the page has no image.
            Compact: smaller, less width. */}
        {image && !hideImage && (
          <div className={cn(
            'shrink-0 self-center',
            compact && 'self-start mt-0.5',
          )}>
            <SafeImage
              src={image}
              alt=""
              className={cn(
                'object-cover border border-border',
                thumbnailSizeClass(compact),
                compact ? 'rounded-md' : 'rounded-lg',
              )}
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

function LinkPreviewSkeleton({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('border border-border overflow-hidden',
      compact ? 'rounded-lg' : 'rounded-xl',
      className,
    )}>
      <div className={cn('flex items-stretch gap-3', compact ? 'p-2 gap-2' : 'p-3')}>
        <div className={cn('min-w-0 flex-1 space-y-1', compact && 'space-y-0.5')}>
          <Skeleton className={cn(compact ? 'h-2.5 w-20' : 'h-3 w-24')} />
          <Skeleton className={cn(compact ? 'h-3 w-3/4' : 'h-4 w-3/4')} />
          <Skeleton className={cn(compact ? 'h-2.5 w-full' : 'h-3 w-full')} />
        </div>
        <Skeleton className={cn('shrink-0 rounded-md',
          thumbnailSizeClass(compact),
          !compact && 'rounded-lg',
        )} />
      </div>
    </div>
  );
}
