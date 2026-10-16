import { useState } from 'react';
import { Music } from 'lucide-react';
import { KindInfoButton } from '@/components/KindInfoButton';
import type { ExtraKindDef } from '@/lib/extraKinds';
import { cn } from '@/lib/utils';

interface ContentCTACardProps {
  /** The ExtraKindDef for this content type (used for the info dialog). */
  kindDef: ExtraKindDef;
  /** Title text (e.g. "Share Your Music on Nostr"). */
  title: string;
  /** Subtitle text. */
  subtitle: string;
  /** Icon to display above the title. Defaults to Music. */
  icon?: React.ReactNode;
  /** Extra classes on the outer container. */
  className?: string;
  /** Primary button label. Defaults to "Learn More". */
  primaryLabel?: string;
  /**
   * Primary action. When provided, the primary button runs this instead of
   * opening the external-apps dialog; the dialog is then offered as a
   * secondary "More apps" button.
   */
  onPrimary?: () => void;
  /** Label for the secondary (external apps) button when `onPrimary` is set. */
  secondaryLabel?: string;
}

/**
 * Call-to-action card for content discovery pages.
 *
 * By default the "Learn More" button opens the KindInfoButton dialog listing
 * external apps for this content type. Callers can pass `onPrimary` to make the
 * card lead with their OWN in-app feature (e.g. the music uploader) while
 * keeping the external apps behind a secondary button.
 */
export function ContentCTACard({ kindDef, title, subtitle, icon, className, primaryLabel, onPrimary, secondaryLabel = 'More apps' }: ContentCTACardProps) {
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <div className={cn('mx-4 rounded-2xl overflow-hidden relative', className)}>
      <div className="bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10">
        <div className="p-6 text-center">
          <div className="flex justify-center text-primary/40">
            {icon ?? <Music className="size-10" />}
          </div>
          <h3 className="text-lg font-bold mt-3">{title}</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">{subtitle}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => (onPrimary ? onPrimary() : setInfoOpen(true))}
              className="px-6 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {primaryLabel ?? 'Learn More'}
            </button>
            {onPrimary && (
              <button
                onClick={() => setInfoOpen(true)}
                className="px-4 py-2 rounded-full border border-border text-sm font-medium text-muted-foreground hover:bg-secondary/50 transition-colors"
              >
                {secondaryLabel}
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Hidden KindInfoButton that we control programmatically */}
      <div className="hidden">
        <KindInfoButton kindDef={kindDef} open={infoOpen} onOpenChange={setInfoOpen} />
      </div>
    </div>
  );
}
