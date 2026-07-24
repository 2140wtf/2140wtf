import { Loader2, Waves } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { BaoFundraiser } from '@/lib/baoFundraising';
import { cn } from '@/lib/utils';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

/**
 * Time-lock stream bar: raised funds vest linearly between stream_start_at
 * and stream_end_at. Three segments — claimed / claimable / still locked.
 * The owner can claim the vested-but-unclaimed part (DEMO: recorded only).
 */
export function StreamBar({ fundraiser, isOwner, onClaim, isClaiming }: {
  fundraiser: BaoFundraiser;
  isOwner: boolean;
  onClaim: () => void;
  isClaiming: boolean;
}) {
  const raised = Number(fundraiser.raised_sats);
  const vested = Number(fundraiser.stream_vested_sats ?? 0);
  const claimable = Number(fundraiser.stream_claimable_sats ?? 0);
  const claimed = Number(fundraiser.claimed_sats ?? 0);
  const locked = Math.max(0, raised - vested);

  const pct = (n: number) => (raised > 0 ? Math.min(100, (n / raised) * 100) : 0);

  const start = fundraiser.stream_start_at ? new Date(fundraiser.stream_start_at * 1000) : null;
  const end = fundraiser.stream_end_at ? new Date(fundraiser.stream_end_at * 1000) : null;
  const dateFmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Waves className="size-4 text-primary" /> Treasury stream
        </h3>
        {start && end && (
          <span className="text-xs text-muted-foreground">
            {dateFmt(start)} → {dateFmt(end)}
          </span>
        )}
      </div>

      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className="bg-green-500 transition-all" style={{ width: `${pct(claimed)}%` }} />
        <div className="bg-amber-500 transition-all" style={{ width: `${pct(claimable)}%` }} />
        <div className={cn('bg-muted-foreground/20 transition-all')} style={{ width: `${pct(locked)}%` }} />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-green-500" />
            <span className="text-muted-foreground">Claimed</span> {formatSats(claimed)}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">Claimable</span> {formatSats(claimable)}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="text-muted-foreground">Streaming</span> {formatSats(locked)}
          </span>
        </div>
        {isOwner && (
          <Button size="sm" variant="outline" disabled={claimable <= 0 || isClaiming} onClick={onClaim}>
            {isClaiming ? <Loader2 className="size-3.5 animate-spin" /> : `Claim ${formatSats(claimable)} sats`}
          </Button>
        )}
      </div>
    </div>
  );
}
