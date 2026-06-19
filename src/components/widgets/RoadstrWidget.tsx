import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, MapPin, Navigation, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useRoadstrEvents } from '@/hooks/useRoadstrEvents';
import { ROADSTR_EVENT_TYPES } from '@/components/roadstr/roadstrTypes';
import { encodeGeohash, getGeohashNeighbors } from '@/lib/geohash';
import { isRoadstrReportActive } from '@/lib/roadstr';
import { timeAgo } from '@/lib/timeAgo';
import { cn } from '@/lib/utils';

const WIDGET_GEOHASH_PRECISION = 6;

export function RoadstrWidget(): React.JSX.Element {
  const { user } = useCurrentUser();
  const { mutate: publishEvent } = useNostrPublish();
  const { toast } = useToast();

  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [permissionState, setPermissionState] = useState<'idle' | 'loading' | 'denied' | 'error'>('idle');

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setPermissionState('error');
      return;
    }
    setPermissionState('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setPermissionState('idle');
      },
      () => {
        setPermissionState('denied');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const geohashes = useMemo(() => {
    if (!location) return undefined;
    const center = encodeGeohash(location.lat, location.lon, WIDGET_GEOHASH_PRECISION);
    return getGeohashNeighbors(center);
  }, [location]);

  const { data, isLoading, error } = useRoadstrEvents(geohashes);

  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  const activeReports = useMemo(() => {
    if (!data) return [];
    return data.reports
      .filter((report) => isRoadstrReportActive(report, data.confirmations, now))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
  }, [data, now]);

  const handleConfirm = useCallback(
    (report: typeof activeReports[number], status: 'still_there' | 'no_longer_there') => {
      const typeLabel = ROADSTR_EVENT_TYPES[report.type].label.toLowerCase();
      const tags = [
        ['e', report.id],
        ['status', status],
        ['lat', report.lat.toFixed(7)],
        ['lon', report.lon.toFixed(7)],
        ...report.geohashes.map((g) => ['g', g] as [string, string]),
        ['alt', `Roadstr: ${status === 'still_there' ? 'confirmed' : 'dismissed'} ${typeLabel} report`],
      ];

      publishEvent(
        { kind: 1316, content: '', tags },
        {
          onSuccess: () => {
            toast({
              title: status === 'still_there' ? 'Report confirmed' : 'Report dismissed',
              description: 'Your confirmation has been published.',
            });
          },
          onError: () => {
            toast({
              title: 'Publication failed',
              description: 'Could not publish the confirmation. Please try again.',
              variant: 'destructive',
            });
          },
        },
      );
    },
    [publishEvent, toast],
  );

  if (permissionState === 'loading' || isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-xs gap-2">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading nearby alerts…</span>
      </div>
    );
  }

  if (permissionState === 'denied' || permissionState === 'error') {
    return (
      <div className="space-y-3 p-1">
        <div className="flex items-center gap-2">
          <Navigation className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Roadstr alerts</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Location access is needed to show nearby road alerts.
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={requestLocation}>
            <MapPin className="size-3 mr-1" />
            Use my location
          </Button>
          <Link to="/roadstr" className="inline-flex items-center h-8 px-3 rounded-md border border-border bg-background text-xs hover:bg-accent hover:text-accent-foreground transition-colors">
            Open map
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-1 text-xs text-destructive">
        Could not load Roadstr alerts: {error.message}
      </div>
    );
  }

  if (activeReports.length === 0) {
    return (
      <div className="space-y-3 p-1">
        <div className="flex items-center gap-2">
          <Navigation className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Roadstr alerts</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          No active road alerts nearby. You can still report something from the map.
        </p>
        <Link to="/roadstr" className="text-xs text-primary hover:underline">
          Open Roadstr map
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center gap-2">
        <Navigation className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Roadstr alerts</h3>
      </div>

      <div className="space-y-2">
        {activeReports.map((report) => {
          const cfg = ROADSTR_EVENT_TYPES[report.type];
          const Icon = cfg.icon;
          const stillThere = data?.confirmations.filter(
            (c) => c.reportId === report.id && c.status === 'still_there',
          ).length ?? 0;
          const noLongerThere = data?.confirmations.filter(
            (c) => c.reportId === report.id && c.status === 'no_longer_there',
          ).length ?? 0;

          return (
            <div
              key={report.id}
              className="rounded-lg border border-border bg-background/50 p-2.5 space-y-2"
            >
              <div className="flex items-start gap-2">
                <div
                  className="mt-0.5 shrink-0 rounded-full p-1"
                  style={{ backgroundColor: `${cfg.color}20`, color: cfg.color }}
                >
                  <Icon className="size-3" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold truncate">{cfg.label}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {timeAgo(report.createdAt)}
                    </span>
                  </div>
                  {report.comment && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {report.comment}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-0.5">
                    <Check className="size-3 text-emerald-500" />
                    {stillThere}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <X className="size-3 text-rose-500" />
                    {noLongerThere}
                  </span>
                </div>

                {user ? (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-1.5 text-[10px] gap-0.5"
                      onClick={() => handleConfirm(report, 'still_there')}
                    >
                      <Check className="size-3" />
                      Still
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn(
                        'h-6 px-1.5 text-[10px] gap-0.5',
                        'hover:text-rose-500 hover:border-rose-500/30',
                      )}
                      onClick={() => handleConfirm(report, 'no_longer_there')}
                    >
                      <X className="size-3" />
                      Gone
                    </Button>
                  </div>
                ) : (
                  <span className="text-[10px] text-muted-foreground italic">Log in to confirm</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Link to="/roadstr" className="text-xs text-primary hover:underline">
        Open Roadstr map
      </Link>
    </div>
  );
}
