import { useState } from 'react';
import { Bot, CheckCircle2, Lock, TrendingUp, Unlock, XCircle } from 'lucide-react';
import { baoApiDate } from "@/lib/baoFundraising";

import { BaoMarketDetailDialog } from '@/components/BaoMarketDetailDialog';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useBaoMarket } from '@/hooks/useBaoMarket';
import type { BaoFundraiser, BaoMilestone, BaoMilestoneVerification } from '@/lib/baoFundraising';
import { cn } from '@/lib/utils';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

function formatDeadline(deadline: number | string | null | undefined): string | null {
  const date = baoApiDate(deadline);
  if (!date) return null;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function feeLabel(feeBps: number | undefined): string | null {
  if (!feeBps) return null;
  return `${(feeBps / 100).toFixed(2).replace(/0$/, '')}% fee`;
}

/** msats → whole sats, rounding up (matches the API's release deduction). */
function msatsToSats(msats: number): number {
  return Math.ceil(msats / 1000);
}

/** Short display name from a model id (`moonshotai/kimi-k3` → `kimi-k3`). */
function shortModelName(modelId: string): string {
  return modelId.split('/').pop() ?? modelId;
}

/**
 * Inline prediction-market widget for one fundraiser milestone.
 *
 * Every milestone IS a market on bao.markets ("Will X deliver [criteria] by
 * [deadline]?"). Shows live YES/NO odds; clicking opens the full market
 * dialog. Resolution drives payout: YES → releasable, NO → refunded.
 *
 * Donation progress: contributions are pooled at the fundraiser level (the
 * API has no per-milestone split), so each milestone shows the CAMPAIGN's
 * overall funding progress, labeled "Campaign funded".
 */
export function MilestoneMarketWidget({ milestone, fundraiser, verification }: {
  milestone: BaoMilestone;
  /** Optional campaign row — enables the "Campaign funded" progress bar. */
  fundraiser?: BaoFundraiser;
  /** Latest AI verification for this milestone, if any. */
  verification?: BaoMilestoneVerification | null;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const marketQuery = useBaoMarket(milestone.market_id);
  const market = marketQuery.data;

  const yes = market?.outcomes.find((o) => o.label.trim().toLowerCase() === 'yes');
  const no = market?.outcomes.find((o) => o.label.trim().toLowerCase() === 'no');
  const resolved = milestone.market_resolution ?? (market?.state === 'resolved' ? market.resolution?.toLowerCase() : null);
  const deadline = formatDeadline(milestone.deadline_at);
  const fee = feeLabel(milestone.fee_bps);

  const fundedPct = fundraiser
    ? Math.min(100, Math.round((Number(fundraiser.raised_sats) / Number(fundraiser.goal_sats)) * 100))
    : null;
  const verificationFeeSats = verification ? msatsToSats(Number(verification.fee_msats)) : null;
  const releasedSats = milestone.status === 'released' && verificationFeeSats !== null
    ? Number(milestone.amount_sats) - verificationFeeSats
    : null;

  return (
    <div className="rounded-md border px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {milestone.status === 'released' ? (
            <CheckCircle2 className="size-4 text-green-500 shrink-0" />
          ) : milestone.status === 'refunded' ? (
            <XCircle className="size-4 text-destructive shrink-0" />
          ) : milestone.status === 'unlocked' ? (
            <Unlock className="size-4 text-amber-500 shrink-0" />
          ) : (
            <Lock className="size-4 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              {milestone.idx + 1}. {milestone.title}
            </div>
            {milestone.description && (
              <div className="text-xs text-muted-foreground line-clamp-2">{milestone.description}</div>
            )}
            {milestone.criteria && (
              <div className="text-xs text-muted-foreground truncate">Criteria: {milestone.criteria}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {fee && <Badge variant="outline" className="text-[10px] px-1.5">{fee}</Badge>}
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatSats(Number(milestone.amount_sats))} sats
          </span>
        </div>
      </div>

      {fundedPct !== null && fundraiser && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Campaign funded</span>
            <span className="tabular-nums">
              {formatSats(Number(fundraiser.raised_sats))} / {formatSats(Number(fundraiser.goal_sats))} sats
            </span>
          </div>
          <Progress value={fundedPct} className="h-1" />
        </div>
      )}

      {milestone.market_id ? (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="w-full rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-left transition-colors hover:border-primary/50"
        >
          {marketQuery.isLoading ? (
            <Skeleton className="h-5 w-full" />
          ) : market ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                <TrendingUp className="size-3 shrink-0" />
                <span className="truncate">Prediction market{deadline ? ` · by ${deadline}` : ''}</span>
              </span>
              {resolved === 'yes' ? (
                <Badge variant="outline" className="text-green-500 border-green-500/40 shrink-0">resolved YES</Badge>
              ) : resolved === 'no' ? (
                <Badge variant="outline" className="text-destructive border-destructive/40 shrink-0">resolved NO</Badge>
              ) : (
                <span className="flex items-center gap-1.5 shrink-0 text-xs font-medium tabular-nums">
                  <span className={cn('rounded px-1.5 py-0.5 bg-green-500/10 text-green-600 dark:text-green-400')}>
                    YES {Math.round((yes?.probability ?? 0.5) * 100)}%
                  </span>
                  <span className="rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                    NO {Math.round((no?.probability ?? 0.5) * 100)}%
                  </span>
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Market unavailable — check the bao.markets API.</span>
          )}
        </button>
      ) : (
        deadline && <p className="text-xs text-muted-foreground">Deliver by {deadline}</p>
      )}

      {(milestone.status === 'locked' || milestone.status === 'unlocked') && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Bot className="size-3 shrink-0" />
          AI-verified · passes at ≥80 · donors decide 70–79
        </p>
      )}

      {verification && (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground flex items-center gap-1 min-w-0">
            <Bot className="size-3 shrink-0" />
            <span className="truncate">
              AI score <span className="font-medium text-foreground tabular-nums">{verification.score}/100</span>
              {' · '}{shortModelName(verification.model)}
              {verificationFeeSats !== null && ` · fee ${formatSats(verificationFeeSats)} sats`}
            </span>
          </span>
          <Badge
            variant="outline"
            className={cn(
              'shrink-0 text-[10px] px-1.5',
              verification.verdict === 'pass' && 'text-green-500 border-green-500/40',
              verification.verdict === 'fail' && 'text-destructive border-destructive/40',
              verification.verdict === 'review' && 'text-amber-500 border-amber-500/40',
            )}
          >
            {verification.verdict}
          </Badge>
        </div>
      )}

      {releasedSats !== null && verificationFeeSats !== null && (
        <p className="text-[11px] text-muted-foreground">
          Released {formatSats(releasedSats)} sats after a {formatSats(verificationFeeSats)} sats AI verification fee.
        </p>
      )}

      {milestone.status === 'refunded' && (
        <p className="text-xs text-destructive">Market resolved NO — milestone refunded to the treasury.</p>
      )}

      <BaoMarketDetailDialog market={market ?? null} open={dialogOpen && !!market} onOpenChange={setDialogOpen} />
    </div>
  );
}
