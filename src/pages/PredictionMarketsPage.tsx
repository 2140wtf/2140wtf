import { memo, useEffect, useMemo, useState } from "react";
import { BarChart3, Box, Info, Plus, RefreshCw, Search } from "lucide-react";
import { useSeoMeta } from "@unhead/react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { useBaoPredictionMarkets, useBaoMarketCategories } from "@/hooks/useBaoPredictionMarkets";
import { useBaoRelayMarkets } from "@/hooks/useBaoRelayMarkets";
import { BaoMarketDetailDialog } from "@/components/BaoMarketDetailDialog";
import { CreateBaoMarketDialog } from "@/components/CreateBaoMarketDialog";
import { cn } from "@/lib/utils";
import { openUrl } from "@/lib/downloadFile";
import { mergeApiAndRelayMarkets, type RelayMergedMarket } from "@/lib/baoRelayMarkets";
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

/** "5mo" / "30d"-style duration between creation and market end. */
function formatDuration(createdAt: number, endTime: number): string {
  if (!endTime || endTime <= 0) return 'Open';
  const days = Math.max(0, Math.round((endTime - createdAt) / 86_400));
  if (days >= 60) return `${Math.round(days / 30)}mo`;
  return `${days}d`;
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
  market: RelayMergedMarket;
  onSelect: (market: RelayMergedMarket, outcomeLabel?: string) => void;
}) {
  const isBinary = market.outcomes.length === 2;
  const [yesOutcome, noOutcome] = isBinary ? market.outcomes : [undefined, undefined];
  const yesPct = yesOutcome ? Math.round((yesOutcome.probability || 0) * 100) : 0;
  const noPct = noOutcome ? Math.round((noOutcome.probability || 0) * 100) : 100 - yesPct;

  return (
    <Card
      data-market-id={market.marketId}
      className="group flex flex-col transition-all hover:border-primary/40 hover:shadow-md"
    >
      <CardContent className="flex-1 flex flex-col gap-3 p-5">
        {/* Category tag */}
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <span className="size-1.5 rounded-full bg-amber-500" />
          {titleCaseCategory(market.category)}
          {market.viaRelay && (
            <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground">· via relay</span>
          )}
        </div>

        {/* Serif title — the bao.markets look */}
        <h3
          className="text-xl font-bold leading-snug line-clamp-3"
          style={{ fontFamily: 'var(--title-font-family, serif)' }}
        >
          {market.title}
        </h3>

        {market.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {market.description}
          </p>
        )}

        {/* Probability row + split bar */}
        <div className="mt-auto space-y-1.5 pt-1">
          {isBinary && market.oddsAvailable ? (
            <>
              <div className="flex justify-between text-xs font-semibold tabular-nums">
                <span className="text-amber-600 dark:text-amber-400">YES {yesPct}%</span>
                <span className="text-muted-foreground">NO {noPct}%</span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="bg-amber-500" style={{ width: `${yesPct}%` }} />
                <div className="bg-neutral-500/70 flex-1" />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              {market.outcomes.slice(0, 3).map((outcome) => {
                const pct = Math.round((outcome.probability || 0) * 100);
                return (
                  <div key={outcome.id} className="space-y-0.5">
                    <div className="flex justify-between text-xs">
                      <span className="truncate max-w-[75%]">{outcome.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {market.oddsAvailable ? `${pct}%` : '—'}
                      </span>
                    </div>
                    {market.oddsAvailable && (
                      <Progress value={pct} className="h-1" indicatorClassName="bg-amber-500/80" />
                    )}
                  </div>
                );
              })}
              {market.outcomes.length > 3 && (
                <p className="text-[11px] text-muted-foreground">+{market.outcomes.length - 3} more</p>
              )}
              {!market.oddsAvailable && (
                <p className="text-xs text-muted-foreground italic">Odds unavailable</p>
              )}
            </div>
          )}
        </div>

        {/* Actions — Details / Buy Yes / Buy No (bao.markets row) */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => onSelect(market)}>
            Details
          </Button>
          {isBinary ? (
            <>
              <Button
                size="sm"
                className="bg-amber-500 text-black hover:bg-amber-400"
                onClick={() => onSelect(market, yesOutcome?.label)}
              >
                Buy {yesOutcome?.label}
              </Button>
              <Button variant="outline" size="sm" onClick={() => onSelect(market, noOutcome?.label)}>
                Buy {noOutcome?.label}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="col-span-2 bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => onSelect(market)}
            >
              Trade
            </Button>
          )}
        </div>

        {/* Bottom meta */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded border border-border px-1.5 py-0.5 tabular-nums">
            {formatDuration(market.createdAt, market.endTime)}
          </span>
          <span className="tabular-nums">Ends {formatEndDate(market.endTime)}</span>
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
  const [initialOutcome, setInitialOutcome] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedMarketId = searchParams.get("market");

  useSeoMeta({
    title: `₿AO MARKETS | ${config.appName}`,
    description: "Kind 38000 prediction markets on Nostr",
  });

  const statusFilter = showResolved ? 'all' : 'active';
  const { data: markets = [], isLoading, isFetching, error, refetch } = useBaoPredictionMarkets('all', statusFilter);
  // Relay-first discovery: kind-38000 definitions straight from the relay, so
  // cards render even when the bao.markets API is down. API markets win on
  // conflicts (live odds); relay-only markets are badged "via relay".
  const { data: relayMarkets = [] } = useBaoRelayMarkets('all', statusFilter);
  const mergedMarkets = useMemo(
    () => mergeApiAndRelayMarkets(markets, relayMarkets),
    [markets, relayMarkets],
  );
  const { data: apiCategories = [] } = useBaoMarketCategories();

  const now = Math.floor(Date.now() / 1000);

  const activeMarkets = useMemo(() => {
    return mergedMarkets.filter((m) => {
      if (m.state === 'ended') return false;
      // ₿AO Fund milestone markets live on the ₿AO Fund page, not here.
      if (m.category === 'fundraiser') return false;
      if (!showResolved) {
        if (m.state !== 'active') return false;
        if (m.endTime > 0 && m.endTime < now) return false;
      }
      return true;
    });
  }, [mergedMarkets, showResolved, now]);

  // Category picker: the API catalog (with live counts), falling back to the
  // categories present in the loaded markets when the catalog is unavailable.
  const categories = useMemo(() => {
    if (apiCategories.length > 0) {
      const visible = apiCategories
        .filter((c) => c.slug !== 'fundraiser' && (showResolved ? c.count : c.active_count) > 0)
        .sort((a, b) => (showResolved ? b.count - a.count : b.active_count - a.active_count));
      return ['all', ...visible.map((c) => c.slug)];
    }
    const set = new Set<string>();
    for (const m of activeMarkets) {
      if (m.category) set.add(m.category);
    }
    return ['all', ...Array.from(set).sort()];
  }, [apiCategories, activeMarkets, showResolved]);

  const categoryCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of apiCategories) {
      map.set(c.slug, showResolved ? c.count : c.active_count);
    }
    return map;
  }, [apiCategories, showResolved]);

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
    if (!selectedMarketId || mergedMarkets.length === 0) return;
    const market = mergedMarkets.find((m) => m.marketId === selectedMarketId);
    if (market) setSelectedMarket(market);
  }, [selectedMarketId, mergedMarkets]);

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
        onSelect={(m, outcomeLabel) => { setSelectedMarket(m); setInitialOutcome(outcomeLabel ?? null); }}
      />
    ));
  }, [isLoading, filteredAndSorted, error, refetch]);

  return (
    <main>
      <PageHeader
        title="₿AO MARKETS"
        icon={<BarChart3 className="size-5" />}
      >
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" /> Create market
        </Button>
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
                  {c === 'all'
                    ? 'All categories'
                    : `${titleCaseCategory(c)}${categoryCount.has(c) ? ` (${categoryCount.get(c)})` : ''}`}
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
        initialOutcomeLabel={initialOutcome}
        open={!!selectedMarket}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedMarket(null);
            setInitialOutcome(null);
            if (selectedMarketId) {
              const next = new URLSearchParams(searchParams);
              next.delete("market");
              setSearchParams(next, { replace: true });
            }
          }
        }}
      />

      <CreateBaoMarketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => refetch()}
      />
    </main>
  );
}

export default PredictionMarketsPage;
