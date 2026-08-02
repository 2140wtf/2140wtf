import { Waves } from 'lucide-react';
import { baoApiDate } from "@/lib/baoFundraising";

import type { BaoFundraiser } from '@/lib/baoFundraising';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

/**
 * Time-lock stream bar: raised funds vest linearly between stream_start_at
 * and stream_end_at. This is schedule information only: payouts remain gated
 * by milestone acceptance and are never claimable merely because time passed.
 */
export function StreamBar({ fundraiser }: {
  fundraiser: BaoFundraiser;
}) {
  const raised = Number(fundraiser.raised_sats);
  const vested = Number(fundraiser.stream_vested_sats ?? 0);
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
      <div className="w-full space-y-2 rounded-lg border border-green-500/30 bg-green-500/5 p-3 lg:w-1/4 lg:min-w-72">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Waves className="size-4 text-green-500" /> Time release
          </h3>
          <span className="text-sm font-semibold tabular-nums">{elapsedPct !== null ? `${elapsedPct}%` : '—'}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Time release progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={elapsedPct ?? 0}>
          <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${elapsedPct ?? 0}%` }} />
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium tabular-nums">{remainingLabel}</span>
          {start && end && <span className="text-muted-foreground">{dateFmt(start)} → {dateFmt(end)}</span>}
        </div>
      </div>

      <div className="flex-1 space-y-3">
      <div className="flex flex-wrap gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <div className="min-w-32 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Rate</div>
          <div className="text-xs font-medium tabular-nums">{ratePerDay !== null ? `${formatSats(ratePerDay)} sats/day` : '—'}</div>
        </div>
        <div className="min-w-32 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Scheduled by time</div>
          <div className="text-xs font-medium tabular-nums">{vestedPct}% · {formatSats(vested)} sats</div>
        </div>
        <div className="min-w-32 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Still locked</div>
          <div className="text-xs font-medium tabular-nums">{formatSats(locked)} sats</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Schedule progress does not authorize payout. Funds remain locked until the required milestone is accepted.
      </p>
      </div>
    </div>
  );
}
