import { ExternalLink } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { BaoMarketChart } from '@/components/BaoMarketChart';
import { cn } from '@/lib/utils';
import { openUrl } from '@/lib/downloadFile';
import type { BaoMarket } from '@/lib/baoMarketParser';

function formatEndDate(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return 'No end date';
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatProbability(prob: number): string {
  if (!Number.isFinite(prob)) return '—';
  return `${Math.round(prob * 100)}%`;
}

function getOutcomeColor(label: string): { text: string; indicator?: string } {
  const normalized = label.trim().toLowerCase();
  if (normalized === 'yes') {
    return { text: 'text-green-500', indicator: 'bg-green-500' };
  }
  if (normalized === 'no') {
    return { text: 'text-[var(--2140-bitcoin)]' };
  }
  return { text: 'text-muted-foreground' };
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-6)}`;
}

interface BaoMarketDetailDialogProps {
  market: BaoMarket | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BaoMarketDetailDialog({
  market,
  open,
  onOpenChange,
}: BaoMarketDetailDialogProps) {
  if (!market) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">{market.title}</DialogTitle>
          <DialogDescription className="sr-only">
            Market details for {market.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {market.description || 'No description provided.'}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{market.category}</Badge>
            <Badge variant="outline">{market.type}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground block">Ends</span>
              <span>{formatEndDate(market.endTime)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Created</span>
              <span>{formatDate(market.createdAt)}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground block">Creator</span>
              <span className="font-mono text-xs">{truncatePubkey(market.creatorPubkey)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold">Market chart</h3>
            <BaoMarketChart market={market} />
          </div>

          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-semibold">Outcomes</h3>
            {market.outcomes.map((outcome) => {
              const color = getOutcomeColor(outcome.label);
              return (
                <div key={outcome.id} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className={cn('truncate max-w-[75%]', color.text)}>{outcome.label}</span>
                    <span className="text-muted-foreground">
                      {formatProbability(outcome.probability)}
                    </span>
                  </div>
                  <Progress
                    value={Math.max(0, Math.min(100, (outcome.probability || 0) * 100))}
                    className="h-2"
                    indicatorClassName={color.indicator}
                  />
                </div>
              );
            })}
          </div>

          <Button
            className="w-full mt-6"
            onClick={() =>
              openUrl(`https://bao.markets/demo/market/${encodeURIComponent(market.marketId)}`)
            }
          >
            Trade on ₿AO MARKETS
            <ExternalLink className="size-4 ml-2" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
