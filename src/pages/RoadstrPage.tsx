import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigation, Plus, Loader2, Locate } from 'lucide-react';
import { useSeoMeta } from '@unhead/react';

import { PageHeader } from '@/components/PageHeader';
import { RoadstrMap } from '@/components/roadstr/RoadstrMap';
import { RoadstrReportDialog } from '@/components/roadstr/RoadstrReportDialog';
import { useRoadstrEvents } from '@/hooks/useRoadstrEvents';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { useAppContext } from '@/hooks/useAppContext';
import { getBackgroundThemeMode } from '@/lib/colorUtils';
import {
  encodeGeohash,
  geohashPrecisionForBounds,
  getGeohashNeighbors,
} from '@/lib/geohash';
import { isRoadstrReportActive } from '@/lib/roadstr';
import type { RoadstrEventType } from '@/components/roadstr/roadstrTypes';
import { ROADSTR_EVENT_TYPES } from '@/components/roadstr/roadstrTypes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export function RoadstrPage(): React.JSX.Element {
  const { config } = useAppContext();
  useSeoMeta({
    title: `Roadstr | ${config.appName}`,
    description: 'Decentralized road event reports on Nostr.',
  });
  useLayoutOptions({ noMaxWidth: true, noOverscroll: true, rightSidebar: null });

  const theme: 'dark' | 'light' = useMemo(() => getBackgroundThemeMode(), []);

  const [viewport, setViewport] = useState<BBox | undefined>();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [visibleTypes, setVisibleTypes] = useState<Set<RoadstrEventType>>(
    () => new Set(Object.keys(ROADSTR_EVENT_TYPES) as RoadstrEventType[]),
  );

  const geohashes = useMemo(() => {
    if (!viewport) return undefined;
    const span = Math.max(
      Math.abs(viewport.maxLat - viewport.minLat),
      Math.abs(viewport.maxLon - viewport.minLon),
    );
    const precision = geohashPrecisionForBounds(span);
    const centerLat = (viewport.minLat + viewport.maxLat) / 2;
    const centerLon = (viewport.minLon + viewport.maxLon) / 2;
    const center = encodeGeohash(centerLat, centerLon, precision);
    return getGeohashNeighbors(center);
  }, [viewport]);

  const { data, isLoading, error } = useRoadstrEvents(geohashes);

  // Re-evaluate "active" periodically so reports expire while the page is open.
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  const visibleReports = useMemo(() => {
    if (!data) return [];
    return data.reports.filter((report) => {
      if (!visibleTypes.has(report.type)) return false;
      return isRoadstrReportActive(report, data.confirmations, now);
    });
  }, [data, visibleTypes, now]);

  const handleBoundsChange = useCallback((bounds: BBox) => {
    setViewport(bounds);
  }, []);

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  const toggleType = (type: RoadstrEventType) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <main className="flex flex-col h-[calc(100vh-var(--top-bar-height,0px)-var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] sidebar:h-[calc(100vh)]">
      <PageHeader title="Roadstr" icon={<Navigation className="size-5" />}>
        <Button
          size="sm"
          className="rounded-full gap-1.5"
          onClick={() => setReportDialogOpen(true)}
        >
          <Plus className="size-4" />
          Report
        </Button>
      </PageHeader>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 px-4 py-3 border-b border-border bg-background/85">
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(ROADSTR_EVENT_TYPES).map(([value, cfg]) => {
            const active = visibleTypes.has(value as RoadstrEventType);
            const Icon = cfg.icon;
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleType(value as RoadstrEventType)}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border transition-colors',
                  active
                    ? 'bg-secondary text-secondary-foreground border-transparent'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/30',
                )}
                title={cfg.label}
              >
                <Icon className="size-3.5" style={{ color: active ? cfg.color : undefined }} />
                <span className="hidden sm:inline">{cfg.label}</span>
              </button>
            );
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full gap-1.5 ml-auto"
          onClick={handleLocate}
          disabled={locating}
        >
          {locating ? <Loader2 className="size-4 animate-spin" /> : <Locate className="size-4" />}
          Locate me
        </Button>
      </div>

      {isLoading && visibleReports.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading road events…
        </div>
      )}

      {error && visibleReports.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
          <p className="text-sm text-destructive">{error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs text-primary underline"
          >
            Reload
          </button>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <RoadstrMap
          reports={visibleReports}
          selectedReportId={selectedReportId}
          onSelectReport={setSelectedReportId}
          onMapClick={() => setSelectedReportId(null)}
          userLocation={userLocation}
          onBoundsChange={handleBoundsChange}
          theme={theme}
        />
      </div>

      <RoadstrReportDialog
        open={reportDialogOpen}
        onOpenChange={setReportDialogOpen}
        location={userLocation}
      />
    </main>
  );
}

export default RoadstrPage;
