import { memo, useEffect, useMemo, useRef, useState } from "react";
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
import { useBaoPredictionMarkets, useBaoMarketCategories, type BaoMarketSource } from "@/hooks/useBaoPredictionMarkets";
import { useBaoRelayMarkets } from "@/hooks/useBaoRelayMarkets";
import { useBaoSmjOdds, withSmjOdds } from "@/hooks/useBaoSmjOdds";
import { useUrlSelectedBaoMarket } from "@/hooks/useUrlSelectedBaoMarket";
import { BaoMarketDetailDialog } from "@/components/BaoMarketDetailDialog";
import { MarketMiniSparkline } from "@/components/MarketMiniSparkline";
import { CreateBaoMarketDialog } from "@/components/CreateBaoMarketDialog";
import { MyTradesSection } from "@/components/MyTradesSection";
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

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** Rail id → chip label/color (bao.markets card chips). */
const RAIL_CHIPS: Record<string, { label: string; className: string }> = {
  htlc: { label: '⚡', className: 'border-amber-500/60 bg-amber-500/15 text-foreground' },
  spark: { label: 'SPARK', className: 'border-yellow-500/60 bg-yellow-500/15 text-foreground' },
  cashu: { label: 'CASHU', className: 'border-green-500/60 bg-green-500/15 text-foreground' },
  liquid: { label: 'LIQUID', className: 'border-sky-500/60 bg-sky-500/15 text-foreground' },
  l1: { label: '₿', className: 'border-orange-500/60 bg-orange-500/15 text-foreground' },
  onchain: { label: '₿', className: 'border-orange-500/60 bg-orange-500/15 text-foreground' },
  ecash: { label: 'FEDIMINT', className: 'border-violet-500/60 bg-violet-500/15 text-foreground' },
  fedimint: { label: 'FEDIMINT', className: 'border-violet-500/60 bg-violet-500/15 text-foreground' },
};

function RailChips({ rails }: { rails?: string[] }) {
  if (!rails || rails.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {rails.map((rail) => {
        const chip = RAIL_CHIPS[rail.toLowerCase()];
        if (!chip) return null;
        return (
          <span
            key={rail}
            className={cn('rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wide', chip.className)}
          >
            {chip.label}
          </span>
        );
      })}
    </div>
  );
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

        {/* Payment rails (bao.markets chips) */}
        <RailChips rails={market.paymentRails} />

        {!market.viaRelay && <MarketMiniSparkline market={market} />}

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
        <div className="flex flex-wrap gap-x-3 text-[11px] font-medium tabular-nums text-muted-foreground">
          <span>Vol {market.totalVolumeSats === undefined ? '—' : `${formatCompactNumber(market.totalVolumeSats)} sats`}</span>
          <span>{market.tradeCount === undefined ? '— trades' : `${formatCompactNumber(market.tradeCount)} trades`}</span>
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
  const [columns, setColumns] = useState<3 | 2 | 1>(() => {
    if (typeof window === "undefined") return 2;
    return window.innerWidth < 768 ? 1 : 2;
  });
  const [showResolved, setShowResolved] = useState(false);
  // Where the catalog loads from: API, relay, or both. Defaults to the API —
  // the relay carries definitions only (no odds/volume), so it is the
  // comparison/test mode, not the default.
  const SOURCE_STORAGE_KEY = "bao-market-source";
  const [source, setSource] = useState<BaoMarketSource>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(SOURCE_STORAGE_KEY) : null;
    return stored === "api" || stored === "relay" || stored === "both" ? stored : "api";
  });
  // Progressive render: mount only the first cards immediately, then append
  // more as the user scrolls. This keeps first paint fast (images, sparklines
  // and odds load only for the visible batch) instead of mounting the whole
  // grid — and firing hundreds of sub-requests — at once.
  // Progressive load: paint the first 6 markets immediately, then grow by 6
  // as the sentinel scrolls into view. Smaller than the old 8/8 so the first
  // paint is cheaper and the grid fills faster on slow connections.
  const INITIAL_VISIBLE = 6;
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const gridSentinelRef = useRef<HTMLDivElement | null>(null);
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
  const { markets = [], apiUnavailable, isLoading, isFetching, error, refetch } = useBaoPredictionMarkets('all', statusFilter, source);
  // Relay query is disabled entirely in api-only mode.
  const { data: relayMarkets = [] } = useBaoRelayMarkets('all', statusFilter, source !== 'api');
  const mergedMarkets = useMemo(() => {
    if (source === 'api') return mergeApiAndRelayMarkets(markets, []);
    if (source === 'relay') return mergeApiAndRelayMarkets([], relayMarkets);
    return mergeApiAndRelayMarkets(markets, relayMarkets);
  }, [markets, relayMarkets, source]);
  const { data: apiCategories = [] } = useBaoMarketCategories();

  // Live SMJ (parimutuel) odds from the API: the relay defs are anonymous
  // and the markets API's outcome.price is a stale default for SMJ pools —
  // the /smj/:id endpoint carries the real pool distribution.
  //
  // Odds are fetched ONLY for the markets currently mounted (the progressive
  // visible batch), so the initial load does not fire hundreds of parallel
  // /smj/:id requests; more odds load as the user scrolls.
  const visibleMarkets = useMemo(() => mergedMarkets.slice(0, visibleCount), [mergedMarkets, visibleCount]);
  const smjIds = useMemo(
    () => visibleMarkets.filter((m) => m.poolModel === 'smj').map((m) => m.marketId),
    [visibleMarkets],
  );
  const smjOdds = useBaoSmjOdds(smjIds);
  const marketsWithOdds = useMemo(
    () => mergedMarkets.map((m) => {
      // SMJ markets without a funded parimutuel pool must not show the API's
      // stale 0.5 default price as if it were real odds — a fabricated 50/50.
      if (m.poolModel === 'smj' && !smjOdds[m.marketId]) {
        return { ...m, oddsAvailable: false };
      }
      return withSmjOdds(m, smjOdds);
    }),
    [mergedMarkets, smjOdds],
  );

  const now = Math.floor(Date.now() / 1000);

  const activeMarkets = useMemo(() => {
    return marketsWithOdds.filter((m) => {
      if (m.state === 'ended') return false;
      // ₿AO Fund milestone markets live on the ₿AO Fund page, not here.
      if (m.category === 'fundraiser') return false;
      if (!showResolved) {
        if (m.state !== 'active') return false;
        if (m.endTime > 0 && m.endTime < now) return false;
      }
      return true;
    });
  }, [marketsWithOdds, showResolved, now]);

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

  useUrlSelectedBaoMarket(
    selectedMarketId,
    marketsWithOdds,
    selectedMarket?.marketId,
    setSelectedMarket,
  );

  // Grow the rendered batch as the sentinel approaches the viewport. Reset
  // whenever the list/shape changes (new search, category, sort, status).
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [search, category, sort, showResolved]);

  useEffect(() => {
    const el = gridSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => Math.min(c + INITIAL_VISIBLE, filteredAndSorted.length));
        }
      },
      { rootMargin: "800px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filteredAndSorted.length]);

  const gridItems = useMemo(() => {
    if (isLoading) {
      return Array.from({ length: INITIAL_VISIBLE }).map((_, i) => (
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
          {apiUnavailable ? (
            <div className="space-y-3">
              <p>
                The markets API is unreachable right now, so odds and volume can't load.
                Markets discovered on the relay are still shown above when available.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="size-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          ) : error ? (
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

    return filteredAndSorted.slice(0, visibleCount).map((market) => (
      <MarketCard
        key={market.marketId}
        market={market}
        onSelect={(m, outcomeLabel) => { setSelectedMarket(m); setInitialOutcome(outcomeLabel ?? null); }}
      />
    ));
  }, [isLoading, filteredAndSorted, visibleCount, error, refetch, apiUnavailable]);

  return (
    <main>
      <PageHeader
        title="₿AO MARKETS"
        icon={<BarChart3 className="size-5" />}
      >
        <Button size="sm" className="gap-1.5 border-amber-500 bg-amber-500 px-2 text-black hover:bg-amber-400 sm:px-3" onClick={() => setCreateOpen(true)} aria-label="Create market">
          <Plus className="size-3.5" /> <span className="hidden sm:inline">Create market</span>
        </Button>
        {isFetching && (
          <Box
            className="size-5 animate-spin text-muted-foreground"
            aria-label="Loading markets"
          />
        )}
      </PageHeader>

      <div className="px-4 py-4 max-w-6xl mx-auto space-y-4">
        <Alert className="border-primary/30 bg-primary/5">
          <Info className="size-4" />
          <AlertDescription>
            <span className="font-semibold text-foreground">The first Bitcoin-only prediction market on Nostr.</span>{' '}
            ₿AO MARKETS is currently for training and demo use only. Mainnet is expected after testing passes.
            Feedback is welcome while we prepare it.
          </AlertDescription>
        </Alert>

        {apiUnavailable && !isLoading && markets.length > 0 && (
          <Alert variant="destructive" className="border-amber-600/40 bg-amber-500/10">
            <Info className="size-4" />
            <AlertDescription>
              The markets API is unreachable right now — showing relay definitions only. Odds and
              volume will appear automatically once it recovers.
            </AlertDescription>
          </Alert>
        )}

        <MyTradesSection
          onOpenMarket={(market, position) => {
            if (market) {
              setSelectedMarket(market);
              setInitialOutcome(position?.outcome_id ?? null);
            } else if (position) {
              setInitialOutcome(position.outcome_id ?? null);
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('market', position.market_id);
                return next;
              }, { replace: true });
            }
          }}
        />

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />            <Input
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
            value={source}
            onValueChange={(v) => {
              if (v === 'api' || v === 'relay' || v === 'both') {
                setSource(v);
                try { localStorage.setItem(SOURCE_STORAGE_KEY, v); } catch { /* best-effort */ }
              }
            }}
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-label="Market data source"
          >
            <ToggleGroupItem value="api" aria-label="Load markets from the API">API</ToggleGroupItem>
            <ToggleGroupItem value="relay" aria-label="Load markets from the relay">Relay</ToggleGroupItem>
            <ToggleGroupItem value="both" aria-label="Load markets from both the API and the relay">Both</ToggleGroupItem>
          </ToggleGroup>

          <ToggleGroup
            type="single"
            value={String(columns)}
            onValueChange={(v) => {
              if (v) setColumns(Number(v) as 1 | 2 | 3);
            }}
            variant="outline"
            size="sm"
            className="shrink-0"
          >
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
            Practice with dummy bitcoin in demo mode; claim testnet bitcoin by visiting{' '}
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
          )}
        >
          {gridItems}

          {filteredAndSorted.length > visibleCount && (
            <div
              ref={gridSentinelRef}
              className="col-span-full flex justify-center py-6 text-xs text-muted-foreground"
              aria-hidden
            >
              Loading more markets…
            </div>
          )}
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
