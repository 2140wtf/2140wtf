import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface SafeLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string | undefined | null;
  /** Optional placeholder rendered when the URL is unsafe or missing. */
  placeholder?: React.ReactNode;
}

/**
 * Renders an <a> only when `href` is a valid HTTPS URL.
 * Falls back to `placeholder` (or a plain <span> of children) for missing/unsafe URLs.
 */
export function SafeLink({ href, placeholder, children, className, ...rest }: SafeLinkProps): React.ReactNode {
  const safe = sanitizeUrl(href);
  if (!safe) {
    if (placeholder) {
      return <span className={cn(className)}>{placeholder}</span>;
    }
    return <span className={cn(className)}>{children}</span>;
  }
  return (
    <a {...rest} href={safe} className={className}>
      {children}
    </a>
  );
}
