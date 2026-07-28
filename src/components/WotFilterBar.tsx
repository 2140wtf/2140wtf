import { Loader2, RefreshCw, Shield, X } from 'lucide-react';

import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface WotFilterBarProps {
  /** Current minimum rank (0..100). */
  threshold: number;
  onThresholdChange: (threshold: number) => void;
  /** Turn the WoT filter off (hides this bar). */
  onDisable: () => void;
  /** Posts currently hidden by the filter. */
  hiddenCount: number;
  /** Authors on the page with a rank assertion. */
  scoredCount: number;
  /** Authors on the page in total. */
  totalCount: number;
  /** True while ranks are being fetched (nothing is filtered yet). */
  isLoading: boolean;
  /** True when every assertions relay failed — shows a retry button. */
  isError?: boolean;
  /** Re-run the rank fetch after a relay failure. */
  onRetry?: () => void;
}

/**
 * Score bar for the Web-of-Trust feed filter. Rendered on top of the home
 * feed while the WoT toggle is on; authors whose global rank (NIP-85
 * GrapeRank, 0..100) falls below the slider value are removed from the
 * feed. Authors without any rank assertion count as 0.
 */
export function WotFilterBar({
  threshold,
  onThresholdChange,
  onDisable,
  hiddenCount,
  scoredCount,
  totalCount,
  isLoading,
  isError,
  onRetry,
}: WotFilterBarProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 text-sm font-medium text-primary shrink-0">
            <Shield className="size-4" />
            WoT
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          Web of Trust: authors are scored 0–100 by global GrapeRank assertions (NIP-85).
          Authors below the threshold — and unknown authors (rank 0) — are hidden.
        </TooltipContent>
      </Tooltip>

      <Slider
        value={[threshold]}
        onValueChange={([value]) => onThresholdChange(value)}
        min={0}
        max={100}
        step={1}
        aria-label="Minimum WoT score"
        className="flex-1"
      />

      <span className="w-8 text-right text-sm font-semibold tabular-nums shrink-0">
        {threshold}
      </span>

      <span className="hidden sm:block text-xs text-muted-foreground tabular-nums shrink-0">
        {isLoading ? (
          <span className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            scoring…
          </span>
        ) : isError ? (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 text-destructive hover:underline"
          >
            <RefreshCw className="size-3" />
            scoring failed — retry
          </button>
        ) : (
          <>
            {hiddenCount > 0 ? `${hiddenCount} hidden · ` : ''}
            {scoredCount}/{totalCount} scored
          </>
        )}
      </span>

      {isError && !isLoading && (
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry WoT scoring"
          className="sm:hidden shrink-0 rounded-full p-1 text-destructive hover:bg-muted transition-colors"
        >
          <RefreshCw className="size-4" />
        </button>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onDisable}
            aria-label="Turn off WoT filter"
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Turn off the WoT filter</TooltipContent>
      </Tooltip>
    </div>
  );
}
