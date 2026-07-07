import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface SafeImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | undefined | null;
  /** Optional placeholder rendered when the URL is unsafe or missing. */
  placeholder?: React.ReactNode;
}

/**
 * Renders an <img> only when `src` is a valid HTTPS URL.
 * Falls back to `placeholder` (or `null`) for missing/unsafe URLs.
 */
export function SafeImage({ src, placeholder, className, alt, ...rest }: SafeImageProps): React.ReactNode {
  const safe = typeof src === 'string' ? sanitizeUrl(src) : undefined;
  if (!safe) {
    if (placeholder) {
      return <div className={cn(className)}>{placeholder}</div>;
    }
    return null;
  }
  return <img {...rest} src={safe} alt={alt ?? ''} className={className} />;
}
