import { Loader2, Waves } from 'lucide-react';
import { baoApiDate } from "@/lib/baoFundraising";

import { Button } from '@/components/ui/button';
import type { BaoFundraiser } from '@/lib/baoFundraising';

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

  const start = baoApiDate(fundraiser.stream_start_at);
  const end = baoApiDate(fundraiser.stream_end_at);
  const dateFmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const windowDays = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000)) : null;
  const ratePerDay = windowDays ? Math.round(raised / windowDays) : null;
  const vestedPct = raised > 0 ? Math.min(100, Math.round((vested / raised) * 100)) : 0;
  const now = Date.now();
  const elapsedPct = start && end && end.getTime() > start.getTime()
    ? Math.max(0, Math.min(100, Math.round(((now - start.getTime()) / (end.getTime() - start.getTime())) * 100)))
    : null;
  const remainingMs = end ? end.getTime() - now : null;
  const remainingLabel = remainingMs === null
    ? 'Schedule unavailable'
    : remainingMs <= 0
      ? 'Release complete'
      : `${Math.floor(remainingMs / 86_400_000)}d ${Math.floor((remainingMs % 86_400_000) / 3_600_000)}h left`;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      <div className="w-full space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 lg:w-1/4 lg:min-w-72">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Waves className="size-4 text-amber-500" /> Time release
          </h3>
          <span className="text-sm font-semibold tabular-nums">{elapsedPct !== null ? `${elapsedPct}%` : '—'}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Time release progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={elapsedPct ?? 0}>
          <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${elapsedPct ?? 0}%` }} />
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium tabular-nums">{remainingLabel}</span>
          {start && end && <span className="text-muted-foreground">{dateFmt(start)} → {dateFmt(end)}</span>}
        </div>
      </div>

      <div className="flex-1 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Rate</div>
          <div className="text-xs font-medium tabular-nums">{ratePerDay !== null ? `${formatSats(ratePerDay)} sats/day` : '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Released by time</div>
          <div className="text-xs font-medium tabular-nums">{vestedPct}% · {formatSats(vested)} sats</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Available now</div>
          <div className="text-xs font-medium tabular-nums">{formatSats(claimable)} sats</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Still locked</div>
          <div className="text-xs font-medium tabular-nums">{formatSats(locked)} sats</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">Claimed: <span className="text-foreground tabular-nums">{formatSats(claimed)} sats</span></span>
        {isOwner && (
          <Button size="sm" variant="outline" disabled={claimable <= 0 || isClaiming} onClick={onClaim}>
            {isClaiming ? <Loader2 className="size-3.5 animate-spin" /> : `Claim ${formatSats(claimable)} sats`}
          </Button>
        )}
      </div>
      </div>
    </div>
  );
}
