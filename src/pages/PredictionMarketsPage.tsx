import { memo, useEffect, useMemo, useState } from "react";
import { BarChart3, Box, Info, RefreshCw, Search } from "lucide-react";
import { useSeoMeta } from "@unhead/react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/PageHeader";
import { useAppContext } from "@/hooks/useAppContext";
import { useBaoPredictionMarkets } from "@/hooks/useBaoPredictionMarkets";
import { BaoMarketDetailDialog } from "@/components/BaoMarketDetailDialog";
import { cn } from "@/lib/utils";
import { openUrl } from "@/lib/downloadFile";
import type { BaoMarket } from "@/lib/baoMarketParser";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "ending-soon", label: "Ending soon" },
  { value: "highest-probability", label: "Highest probability" },
];

function formatEndDate(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return "No end date";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatProbability(prob: number): string {
  if (!Number.isFinite(prob)) return "—";
  return `${Math.round(prob * 100)}%`;
}

function getOutcomeColor(label: string): { text: string; indicator?: string } {
  const normalized = label.trim().toLowerCase();
  if (normalized === "yes") {
    return { text: "text-green-500", indicator: "bg-green-500" };
  }
  if (normalized === "no") {
    return { text: "text-[var(--2140-bitcoin)]" };
  }
  return { text: "text-muted-foreground" };
}

function titleCaseCategory(name: string): string {
  return name
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const MarketCard = memo(function MarketCard({
  market,
  onSelect,
}: {
  market: BaoMarket;
  onSelect: (market: BaoMarket) => void;
}) {
  return (
    <Card
      data-market-id={market.marketId}
      className="flex flex-col cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onSelect(market)}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-snug line-clamp-2">
            {market.title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        <p className="text-sm text-muted-foreground line-clamp-2">
          {market.description || "No description provided."}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{titleCaseCategory(market.category)}</Badge>
          <span className="text-xs text-muted-foreground">
            Ends {formatEndDate(market.endTime)}
          </span>
        </div>

        <div className="mt-auto space-y-2">
          {market.outcomes.slice(0, 4).map((outcome) => {
            const color = getOutcomeColor(outcome.label);
            return (
              <div key={outcome.id} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className={cn('truncate max-w-[70%]', color.text)}>{outcome.label}</span>
                  <span className="text-muted-foreground">
                    {formatProbability(outcome.probability)}
                  </span>
                </div>
                <Progress
                  value={Math.max(0, Math.min(100, (outcome.probability || 0) * 100))}
                  className="h-1.5"
                  indicatorClassName={color.indicator}
                />
              </div>
            );
          })}
          {market.outcomes.length > 4 && (
            <p className="text-xs text-muted-foreground">
              +{market.outcomes.length - 4} more outcomes
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

export function PredictionMarketsPage(): React.JSX.Element {
  const { config } = useAppContext();
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [columns, setColumns] = useState<4 | 3 | 2 | 1>(2);
  const [showResolved, setShowResolved] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<BaoMarket | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedMarketId = searchParams.get("market");

  useSeoMeta({
    title: `₿AO MARKETS | ${config.appName}`,
    description: "Kind 38000 prediction markets on Nostr",
  });

  const { data: markets = [], isLoading, isFetching, error, refetch } = useBaoPredictionMarkets('all', showResolved ? 'all' : 'active');

  const now = Math.floor(Date.now() / 1000);

  const activeMarkets = useMemo(() => {
    return markets.filter((m) => {
      if (m.state === 'ended') return false;
      if (!showResolved) {
        if (m.state !== 'active') return false;
        if (m.endTime > 0 && m.endTime < now) return false;
      }
      return true;
    });
  }, [markets, showResolved, now]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of activeMarkets) {
      if (m.category) set.add(m.category);
    }
    return ['all', ...Array.from(set).sort()];
  }, [activeMarkets]);

  const filteredAndSorted = useMemo(() => {
    const q = search.toLowerCase().trim();

    let items = activeMarkets.filter((m) => {
      if (category !== 'all' && m.category !== category) return false;

      if (!q) return true;
      const hay = `${m.title} ${m.description} ${m.category} ${m.outcomes
        .map((o) => o.label)
        .join(' ')}`.toLowerCase();
      return hay.includes(q);
    });

    items = [...items].sort((a, b) => {
      switch (sort) {
        case "ending-soon": {
          if (!a.endTime && !b.endTime) return b.createdAt - a.createdAt;
          if (!a.endTime) return 1;
          if (!b.endTime) return -1;
          return a.endTime - b.endTime;
        }
        case "highest-probability": {
          const maxA = Math.max(...a.outcomes.map((o) => o.probability || 0));
          const maxB = Math.max(...b.outcomes.map((o) => o.probability || 0));
          return maxB - maxA;
        }
        case "newest":
        default:
          return b.createdAt - a.createdAt;
      }
    });

    return items;
  }, [activeMarkets, search, sort, category]);

  useEffect(() => {
    if (!selectedMarketId || markets.length === 0) return;
    const market = markets.find((m) => m.marketId === selectedMarketId);
    if (market) setSelectedMarket(market);
  }, [selectedMarketId, markets]);

  const gridItems = useMemo(() => {
    if (isLoading) {
      return Array.from({ length: 8 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-3/4" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-2 w-full" />
          </CardContent>
        </Card>
      ));
    }

    if (filteredAndSorted.length === 0) {
      return (
        <div className="col-span-full py-20 text-center text-sm text-muted-foreground">
          {error ? (
            <div className="space-y-3">
              <p className="text-destructive">
                {error instanceof Error ? error.message : "Failed to load markets"}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="size-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          ) : (
            <p>No markets found. Try a different category, search, or sort.</p>
          )}
        </div>
      );
    }

    return filteredAndSorted.map((market) => (
      <MarketCard
        key={market.marketId}
        market={market}
        onSelect={setSelectedMarket}
      />
    ));
  }, [isLoading, filteredAndSorted, error, refetch]);

  return (
    <main>
      <PageHeader
        title="₿AO MARKETS"
        icon={<BarChart3 className="size-5" />}
      >
        {isFetching && (
          <Box
            className="size-5 animate-spin text-muted-foreground"
            aria-label="Loading markets"
          />
        )}
      </PageHeader>

      <div className="px-4 py-4 max-w-6xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search markets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === 'all' ? 'All categories' : titleCaseCategory(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ToggleGroup
            type="single"
            value={String(columns)}
            onValueChange={(v) => {
              if (v) setColumns(Number(v) as 1 | 2 | 3 | 4);
            }}
            variant="outline"
            size="sm"
            className="shrink-0"
          >
            <ToggleGroupItem value="4" aria-label="4 columns">4</ToggleGroupItem>
            <ToggleGroupItem value="3" aria-label="3 columns">3</ToggleGroupItem>
            <ToggleGroupItem value="2" aria-label="2 columns">2</ToggleGroupItem>
            <ToggleGroupItem value="1" aria-label="1 column">1</ToggleGroupItem>
          </ToggleGroup>

          <div className="flex items-center gap-2 shrink-0">
            <Switch
              id="show-resolved"
              checked={showResolved}
              onCheckedChange={setShowResolved}
            />
            <Label htmlFor="show-resolved" className="text-sm text-muted-foreground whitespace-nowrap">
              Show resolved
            </Label>
          </div>

          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <Alert>
          <Info className="size-4" />
          <AlertDescription>
            Prediction Markets powered by ₿AO MARKETS. All markets are for play only with dummy
            bitcoin in demo mode, claim testnet bitcoin by visiting{' '}
            <button
              type="button"
              onClick={() => openUrl("https://bao.markets")}
              className="text-primary hover:underline bg-transparent border-none p-0"
            >
              https://bao.markets
            </button>
            . Learn how to use all bitcoin networks: lightning, ecash, liquid, ark, spark and all
            other layers of BTC tech that make it stronger faster and private without risk.
          </AlertDescription>
        </Alert>

        <div
          className={cn(
            "grid gap-4",
            columns === 1 && "grid-cols-1",
            columns === 2 && "grid-cols-2",
            columns === 3 && "grid-cols-3",
            columns === 4 && "grid-cols-4",
          )}
        >
          {gridItems}
        </div>
      </div>

      <BaoMarketDetailDialog
        market={selectedMarket}
        open={!!selectedMarket}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedMarket(null);
            if (selectedMarketId) {
              const next = new URLSearchParams(searchParams);
              next.delete("market");
              setSearchParams(next, { replace: true });
            }
          }
        }}
      />
    </main>
  );
}

export default PredictionMarketsPage;
